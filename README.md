# 🎙️ TikVoice – TikTok Live Comment Reader

Pembaca komentar live TikTok dengan Text-to-Speech otomatis.
Bisa dijalankan **lokal** maupun di-deploy ke **Railway**.

---

## ⚡ Jalankan Lokal (Recommended)

```bash
npm install
node server.js
# Buka: http://localhost:3000
```

---

## 🚂 Deploy ke Railway

### 1. Push ke GitHub
```bash
git init && git add . && git commit -m 'init'
# Buat repo di GitHub lalu push
```

### 2. Deploy
1. Buka railway.app → New Project → Deploy from GitHub
2. Pilih repo ini → Railway auto-detect Node.js
3. Klik Generate Domain → dapat URL publik

### 3. Set Environment Variable (PENTING!)
Di Railway → Variables, tambahkan:
- Key: TIKTOK_SESSION_ID
- Value: (session cookie dari browser kamu, lihat di bawah)

---

## 🔑 Cara Dapat sessionId TikTok

TikTok blokir IP datacenter. Solusi: pakai sessionId akun sendiri.

1. Buka tiktok.com di browser, login
2. DevTools (F12) → Application → Cookies → tiktok.com
3. Cari cookie bernama 'sessionid'
4. Copy value → paste ke Railway variable TIKTOK_SESSION_ID

JANGAN share sessionId ke siapapun!

---

## ⚠️ Lokal vs Railway

| | Lokal | Railway |
|--|-------|---------|
| Koneksi TikTok | Selalu works | Butuh sessionId |
| TTS suara | Browser | Browser (client) |
| Akses | Hanya PC | Dari mana saja |

Rekomendasi: Untuk live streaming, jalankan LOKAL lebih stabil.

---

## 🔧 Environment Variables

| Variable | Keterangan |
|----------|-----------|
| PORT | Auto di-set Railway |
| TIKTOK_SESSION_ID | Cookie session TikTok |
