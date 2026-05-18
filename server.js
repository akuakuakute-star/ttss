/**
 * TikVoice – TikTok Live Comment Reader
 * Backend: Express + WebSocket + tiktok-live-connector
 *
 * Cara pakai:
 *   npm install
 *   node server.js
 * Buka: http://localhost:3000
 */

const { WebcastPushConnection } = require('tiktok-live-connector');
const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const path     = require('path');

/* ─────────────── Setup Server ─────────────── */
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve file HTML dari folder public/
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/status', (req, res) => {
  res.json({ ok: true, clients: wss.clients.size });
});

/* ─────────────── State ─────────────── */
let tiktokConn    = null;   // instance WebcastPushConnection
let currentUser   = null;   // username yang sedang dimonitor
let reconnectTimer = null;
let isConnecting  = false;

/* ─────────────── Helpers ─────────────── */
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function log(...args) {
  const ts = new Date().toLocaleTimeString('id-ID');
  console.log(`[${ts}]`, ...args);
}

/* ─────────────── TikTok Connect ─────────────── */
async function connectTikTok(username) {
  if (isConnecting) return;
  isConnecting = true;

  // Putus koneksi lama
  if (tiktokConn) {
    try { tiktokConn.disconnect(); } catch (_) {}
    tiktokConn = null;
  }

  currentUser = username.replace('@', '').trim();
  log(`Menghubungkan ke @${currentUser} ...`);

  // SESSION_ID bisa di-set via Railway env variable untuk bypass IP block cloud
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

  /* ── Events ── */

  tiktokConn.on('connected', (state) => {
    isConnecting = false;
    log(`✅ Terhubung ke @${currentUser} | Viewers: ${state.roomInfo?.userCount || '?'}`);
    broadcast({
      type: 'connected',
      username: currentUser,
      viewerCount: state.roomInfo?.userCount || 0,
      roomId: state.roomInfo?.roomId || ''
    });
  });

  // Komentar chat
  tiktokConn.on('chat', (data) => {
    log(`💬 @${data.uniqueId}: ${data.comment}`);
    broadcast({
      type: 'comment',
      user:    data.uniqueId,
      nick:    data.nickname || data.uniqueId,
      text:    data.comment,
      avatar:  data.profilePictureUrl || '',
      likes:   data.userDetails?.bioDescription || '',
      ts:      Date.now()
    });
  });

  // Gift
  tiktokConn.on('gift', (data) => {
    if (data.giftType === 1 && !data.repeatEnd) return; // skip streak intermediate
    const msg = `mengirim ${data.repeatCount}x ${data.giftName} 🎁`;
    log(`🎁 @${data.uniqueId}: ${msg}`);
    broadcast({
      type: 'gift',
      user:      data.uniqueId,
      nick:      data.nickname || data.uniqueId,
      text:      msg,
      giftName:  data.giftName,
      giftCount: data.repeatCount,
      avatar:    data.profilePictureUrl || '',
      ts:        Date.now()
    });
  });

  // Like
  tiktokConn.on('like', (data) => {
    // throttle – hanya kirim tiap total kelipatan 100
    if (data.totalLikeCount % 100 === 0) {
      broadcast({
        type: 'like',
        user:       data.uniqueId,
        nick:       data.nickname || data.uniqueId,
        likeCount:  data.likeCount,
        totalLikes: data.totalLikeCount,
        ts:         Date.now()
      });
    }
  });

  // Member join
  tiktokConn.on('member', (data) => {
    broadcast({
      type: 'join',
      user:   data.uniqueId,
      nick:   data.nickname || data.uniqueId,
      text:   'bergabung ke live 👋',
      avatar: data.profilePictureUrl || '',
      ts:     Date.now()
    });
  });

  // Viewer count update
  tiktokConn.on('roomUser', (data) => {
    broadcast({ type: 'viewers', count: data.viewerCount });
  });

  // Share
  tiktokConn.on('share', (data) => {
    broadcast({
      type: 'share',
      user: data.uniqueId,
      nick: data.nickname || data.uniqueId,
      text: 'membagikan live ini 🔗',
      ts:   Date.now()
    });
  });

  // Error
  tiktokConn.on('error', (err) => {
    isConnecting = false;
    log(`❌ Error: ${err.message}`);
    broadcast({ type: 'error', message: err.message || 'Koneksi error' });
  });

  // Disconnect
  tiktokConn.on('disconnected', () => {
    isConnecting = false;
    log(`🔌 Terputus dari @${currentUser}`);
    broadcast({ type: 'disconnected', username: currentUser });

    // Auto reconnect setelah 5 detik
    if (currentUser) {
      log('🔄 Mencoba reconnect dalam 5 detik...');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (currentUser) connectTikTok(currentUser);
      }, 5000);
    }
  });

  // Mulai koneksi
  try {
    await tiktokConn.connect();
  } catch (err) {
    isConnecting = false;
    log(`❌ Gagal konek: ${err.message}`);
    broadcast({
      type: 'error',
      message: `Gagal konek ke @${currentUser}: ${err.message}`
    });
  }
}

function disconnectTikTok() {
  clearTimeout(reconnectTimer);
  currentUser = null;
  if (tiktokConn) {
    try { tiktokConn.disconnect(); } catch (_) {}
    tiktokConn = null;
  }
  isConnecting = false;
  log('🔌 Koneksi diputus secara manual.');
  broadcast({ type: 'disconnected', username: null, manual: true });
}

/* ─────────────── WebSocket Messages dari Browser ─────────────── */
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  log(`🌐 Client terhubung dari ${ip} | Total: ${wss.clients.size}`);

  // Kirim status sekarang
  ws.send(JSON.stringify({
    type: 'init',
    connected: !!tiktokConn,
    username:  currentUser
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.action) {
      case 'connect':
        if (!msg.username) return ws.send(JSON.stringify({ type: 'error', message: 'Username kosong' }));
        connectTikTok(msg.username);
        break;

      case 'disconnect':
        disconnectTikTok();
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      default:
        log(`Unknown action: ${msg.action}`);
    }
  });

  ws.on('close', () => {
    log(`❌ Client terputus | Sisa: ${wss.clients.size}`);
  });
});

/* ─────────────── Start ─────────────── */
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════╗');
  console.log(`║  TikVoice Server - Port ${PORT}      ║`);
  console.log('╠══════════════════════════════════╣');
  console.log(`║  Buka: http://localhost:${PORT}      ║`);
  console.log('╚══════════════════════════════════╝\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Server dimatikan...');
  disconnectTikTok();
  server.close(() => process.exit(0));
});
