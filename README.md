# DO Manager Bot

A production-ready Telegram bot for managing **DigitalOcean** accounts, droplets, billing, and SSH keys, built with **Node.js**, **Telegraf**, and **MongoDB**.

Bot ini dirancang untuk penggunaan multi-user dengan pembatasan limit akun, masa tenggang (grace period) VPS, perlindungan anti-spam, serta Panel Admin yang lengkap.

---

## Fitur Utama

- **Multi-Account & Multi-User:** Setiap pengguna Telegram dapat menghubungkan akun DigitalOcean (DO) mereka sendiri.
- **Role & Pembatasan Akun (Tiers):**
  - **Standard:** Limit maksimal 1 akun DO terhubung.
  - **Premium:** Limit maksimal 10 akun DO terhubung.
  - **Admin:** Akses penuh tanpa batas.
- **Panel Dashboard Admin (`/admin`):**
  - **Statistik Sistem:** Total user terdaftar, total user premium, total akun terhubung, total VPS aktif, dan status pemeliharaan.
  - **Manajemen User:** Ubah role user (Standard / Premium), ubah limit akun kustom, serta melakukan Ban/Unban user.
  - **Mode Maintenance:** Kunci akses bot untuk semua pengguna non-admin (menampilkan pemberitahuan pemeliharaan).
  - **Sistem Broadcast:** Kirim pengumuman ke seluruh pengguna bot secara langsung dengan status report.
  - **Perintah Cepat Admin:** `/premium <id/username>` dan `/standard <id/username>`.
- **Power Control Dinamis & Masa Aktif:**
  - Status aktif/mati otomatis diwakili oleh satu tombol dinamis (`📴 Power off` / `⚡️ Power on`).
  - Info VPS lengkap berbahasa Indonesia dengan WIB timezone, bendera negara region, dan masa aktif mendetail.
  - **Grace Period Expiry:** VPS yang kedaluwarsa **tidak langsung didelete**, melainkan di-_power off_ secara otomatis dan diberikan masa tenggang **7 hari** untuk diperpanjang. Jika tidak diperpanjang dalam 7 hari, VPS akan dihapus otomatis dari DigitalOcean.
- **Anti-Spam / Rate-Limiter:** Membatasi input pengguna maksimal 3 pesan dalam 3 detik untuk melindungi bot dari spamming.
- **Keamanan Tinggi:**
  - Token API disimpan dalam enkripsi **AES-256-GCM** sebelum masuk database.
  - Pesan yang berisi token atau password root akan dihapus otomatis dari riwayat chat demi keamanan.

---

## Quick Start

### 1. Prerequisites

- **Node.js** 20+
- **MongoDB** Atlas atau local MongoDB instance
- Telegram Bot Token dari [@BotFather](https://t.me/BotFather)

### 2. Konfigurasi

```bash
cp .env.example .env
# Isi variabel di dalam file .env.
# Generate ENCRYPTION_KEY menggunakan:
openssl rand -hex 32
```

### 3. Menjalankan Bot secara Lokal

```bash
npm install
npm run dev      # Hot-reload ketika kode berubah
# atau
npm start
```

### 4. Deployment Production

Bot ini dilengkapi dengan `Dockerfile` dan `docker-compose.yml` untuk deployment container sekali jalan:

```bash
docker compose up -d --build
```

---

## Environment Variables

| Variable           | Wajib | Keterangan                                                              |
| ------------------ | ----- | ----------------------------------------------------------------------- |
| `BOT_TOKEN`        | Ya    | Token Telegram Bot dari BotFather                                       |
| `MONGODB_URI`      | Ya    | URI koneksi MongoDB                                                     |
| `ENCRYPTION_KEY`   | Ya    | 32-byte hex (64 karakter) untuk enkripsi token DO                       |
| `ADMIN_USER_IDS`   | Tidak | Comma-separated list ID Telegram Admin yang didaftarkan (Pangkat Admin) |
| `ALLOWED_USER_IDS` | Tidak | Whitelist user yang boleh menggunakan bot. Kosongkan untuk mode publik  |
| `LOG_LEVEL`        | Tidak | Level logging Pino (`info` secara default)                              |
| `NODE_ENV`         | Tidak | Set `production` untuk menonaktifkan pretty logging                     |
| `EXPIRY_CRON`      | Tidak | Jadwal cron pengecekan VPS expired (`*/1 * * * *` secara default)       |

---

## Daftar Perintah (Commands)

| Command          | Akses | Fungsi                                              |
| ---------------- | ----- | --------------------------------------------------- |
| `/start`         | Semua | Membuka Dashboard Utama / registrasi awal           |
| `/accounts`      | Semua | Pindah atau kelola akun DigitalOcean yang terhubung |
| `/cancel`        | Semua | Membatalkan alur/flow aktif saat ini                |
| `/help`          | Semua | Menampilkan panduan & tutorial bot lengkap          |
| `/admin`         | Admin | Membuka Panel Dashboard Admin                       |
| `/premium <id>`  | Admin | Mengubah tipe akun user menjadi Premium             |
| `/standard <id>` | Admin | Mengubah tipe akun user menjadi Standard            |

---

## Struktur File Project

```text
src/
  index.js              # Entry point: koneksi database, cron, & start bot
  bot.js                # Inisialisasi Telegraf & registrasi middleware/handlers
  config.js             # Validasi variabel env menggunakan Zod
  logger.js             # Logger menggunakan Pino
  db.js                 # Koneksi Mongoose
  handlers/
    start.js            # Handler perintah /start & /help
    addAccount.js       # Capturing & registrasi token DO baru
    dashboard.js        # Dashboard utama (Email & Droplets)
    createVps.js        # Wizard interaktif pembuatan VPS
    manageVps.js        # Detail VPS, power control, perpanjangan, rebuild, & delete
    admin.js            # Panel Admin, statistik, kelola user, maintenance, & broadcast
  middleware/
    antiSpam.js         # Rate limiting anti-spam
    auth.js             # Sinkronisasi user profile, role, & pemeliharaan
    errorHandler.js     # Handler error Telegraf global
  models/
    Account.js          # Skema akun DO terenkripsi
    Droplet.js          # Skema droplet (pembuatan & expiresAt)
    Session.js          # Skema sesi Mongo Telegraf
    SystemSettings.js   # Skema pengaturan sistem (seperti status maintenance)
    User.js             # Skema profil user, role, & limit kustom
  services/
    crypto.js           # Utilitas enkripsi/dekripsi AES-256-GCM
    digitalocean.js     # Wrapper API DigitalOcean
    accountService.js   # Sinkronisasi data & status akun DO
    session.js          # Mongo session provider
    expirySweeper.js    # Cron job pembersihan & grace period VPS kedaluwarsa
  utils/
    callbacks.js        # Helper packing/unpacking callback_data
    format.js           # Formatting data, rupiah, & escape Markdown V2
```

---

## Lisensi

MIT
