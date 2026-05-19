/**
 * TikVoice – TikTok Live Comment Reader
 * Backend: Express + WebSocket + tiktok-live-connector + Google TTS
 *
 * npm install && node server.js
 * Buka: http://localhost:3000
 */

const { WebcastPushConnection } = require('tiktok-live-connector');
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const gtts      = require('node-gtts');
const path      = require('path');

/* ─────────────── Setup Server ─────────────── */
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const PORT   = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

/* ─────────────── TTS Endpoint ─────────────── */
// Browser fetch ke /api/tts?text=...&lang=id → dapat file MP3
// Audio element bisa jalan di background Android ✅
app.get('/api/tts', (req, res) => {
  const text = req.query.text || '';
  const lang = req.query.lang || 'id';

  if (!text.trim()) return res.status(400).send('No text');

  try {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    // stream langsung MP3 ke browser
    gtts(lang).stream(text).pipe(res);
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).send('TTS error');
  }
});

app.get('/api/status', (req, res) => {
  res.json({ ok: true, clients: wss.clients.size });
});

/* ─────────────── State ─────────────── */
let tiktokConn     = null;
let currentUser    = null;
let reconnectTimer = null;
let isConnecting   = false;

/* ─────────────── Helpers ─────────────── */
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}
function log(...args) {
  console.log(`[${new Date().toLocaleTimeString('id-ID')}]`, ...args);
}

/* ─────────────── TikTok Connect ─────────────── */
async function connectTikTok(username) {
  if (isConnecting) return;
  isConnecting = true;
  if (tiktokConn) { try { tiktokConn.disconnect(); } catch (_) {} tiktokConn = null; }

  currentUser = username.replace('@', '').trim();
  log(`Menghubungkan ke @${currentUser} ...`);

  const sessionId = process.env.TIKTOK_SESSION_ID || undefined;

  tiktokConn = new WebcastPushConnection(currentUser, {
    processInitialData: true,
    fetchRoomInfoOnConnect: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
    sessionId,
    requestHeaders: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  tiktokConn.on('connected', (state) => {
    isConnecting = false;
    log(`✅ Terhubung @${currentUser} | Viewers: ${state.roomInfo?.userCount || '?'}`);
    broadcast({ type: 'connected', username: currentUser, viewerCount: state.roomInfo?.userCount || 0 });
  });

  tiktokConn.on('chat', (data) => {
    log(`💬 @${data.uniqueId}: ${data.comment}`);
    broadcast({ type: 'comment', user: data.uniqueId, nick: data.nickname || data.uniqueId, text: data.comment, avatar: data.profilePictureUrl || '', ts: Date.now() });
  });

  tiktokConn.on('gift', (data) => {
    if (data.giftType === 1 && !data.repeatEnd) return;
    const msg = `mengirim ${data.repeatCount} ${data.giftName}`;
    log(`🎁 @${data.uniqueId}: ${msg}`);
    broadcast({ type: 'gift', user: data.uniqueId, nick: data.nickname || data.uniqueId, text: msg, avatar: data.profilePictureUrl || '', ts: Date.now() });
  });

  tiktokConn.on('member', (data) => {
    broadcast({ type: 'join', user: data.uniqueId, nick: data.nickname || data.uniqueId, text: 'bergabung ke live', avatar: data.profilePictureUrl || '', ts: Date.now() });
  });

  tiktokConn.on('roomUser', (data) => {
    broadcast({ type: 'viewers', count: data.viewerCount });
  });

  tiktokConn.on('like', (data) => {
    if (data.totalLikeCount % 100 === 0)
      broadcast({ type: 'like', user: data.uniqueId, nick: data.nickname || data.uniqueId, totalLikes: data.totalLikeCount, ts: Date.now() });
  });

  tiktokConn.on('share', (data) => {
    broadcast({ type: 'share', user: data.uniqueId, nick: data.nickname || data.uniqueId, text: 'membagikan live ini', ts: Date.now() });
  });

  tiktokConn.on('error', (err) => {
    isConnecting = false;
    log(`❌ Error: ${err.message}`);
    broadcast({ type: 'error', message: err.message || 'Koneksi error' });
  });

  tiktokConn.on('disconnected', () => {
    isConnecting = false;
    log(`🔌 Terputus dari @${currentUser}`);
    broadcast({ type: 'disconnected', username: currentUser });
    if (currentUser) {
      log('🔄 Reconnect dalam 5 detik...');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { if (currentUser) connectTikTok(currentUser); }, 5000);
    }
  });

  try {
    await tiktokConn.connect();
  } catch (err) {
    isConnecting = false;
    log(`❌ Gagal: ${err.message}`);
    broadcast({ type: 'error', message: `Gagal konek ke @${currentUser}: ${err.message}` });
  }
}

function disconnectTikTok() {
  clearTimeout(reconnectTimer);
  currentUser = null;
  if (tiktokConn) { try { tiktokConn.disconnect(); } catch (_) {} tiktokConn = null; }
  isConnecting = false;
  broadcast({ type: 'disconnected', username: null, manual: true });
}

/* ─────────────── WebSocket ─────────────── */
wss.on('connection', (ws, req) => {
  log(`🌐 Client terhubung | Total: ${wss.clients.size}`);
  ws.send(JSON.stringify({ type: 'init', connected: !!tiktokConn, username: currentUser }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.action === 'connect' && msg.username) connectTikTok(msg.username);
    else if (msg.action === 'disconnect') disconnectTikTok();
    else if (msg.action === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
  });

  ws.on('close', () => log(`❌ Client pergi | Sisa: ${wss.clients.size}`));
});

/* ─────────────── Start ─────────────── */
server.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════╗');
  console.log(`║  TikVoice Server running            ║`);
  console.log(`║  http://localhost:${PORT}              ║`);
  console.log('╚════════════════════════════════════╝\n');
});

process.on('SIGINT', () => { disconnectTikTok(); server.close(() => process.exit(0)); });
