# AFK Bot + Orkestrator 8 Akun (server cracked)

Bot Minecraft berbasis [mineflayer](https://github.com/PrismarineJS/mineflayer) untuk server
**cracked / offline-mode**. Dua mode:

| Perintah | Isi |
| --- | --- |
| `npm start` | satu bot (`index.js`) |
| `npm run multi` | 8 bot dalam satu proses (`multi.js`), masing-masing daftar sendiri |

Fitur utama:

- **auto-register / auto-login** — bot kirim `/register` atau `/login` sendiri setelah spawn
- 8 akun `jack01`–`jack08` dalam satu proses Node (hemat RAM, cepat start)
- AFK: putar kepala, ayun lengan, lompat, jalan ke blok aman
- auto-makan, penyelamatan otomatis dari lava/air/jatuh
- auto-reconnect dengan exponential backoff + jitter
- deteksi kick AFK (jeda diperpanjang) vs kick auth (coba daftar ulang)
- heartbeat status, log terpisah per bot, console interaktif

Tidak ada kode login Microsoft sama sekali. Bot selalu masuk sebagai username biasa (offline-mode).

## Auto-register

Setelah bot spawn, `lib/register.js` mengirim perintah otomatis:

| `register.mode` | Yang dikirim |
| --- | --- |
| `auto` (default) | `/login <pw>`, dan kalau server bilang belum terdaftar → `/register <pw> <pw>` |
| `register` | langsung `/register <pw> <pw>` |
| `login` | hanya `/login <pw>` |
| `off` | tidak mengirim apa pun |

Alurnya (mode `auto`):

```
spawn  ->  /login jack01
             server: "You are not registered"     ->  /register jack01 jack01
             server: "Successfully registered!"   ->  status: authenticated
rejoin ->  /login jack01
             server: "Welcome back"                ->  status: authenticated
```

Kalau server membalas `That name is already registered`, bot otomatis pivot ke `/login`.
Kalau gagal autentikasi 3x berturut (`register.maxAuthFailures`), bot berhenti dengan pesan
jelas, bukan reconnect terus-menerus.

Password:

- `register.password: null` (default) → password = nama username, jadi tiap akun punya password sendiri
- isi string untuk memakai satu password yang sama untuk semua bot

> Pastikan perintah `/register` dan `/login` tersedia di server (plugin AuthMe/Elypso, dll.) dan
> chat tidak diblokir sebelum login.

## Cara pakai

```bash
npm install
```

### 1. Satu bot

Edit `config.json`:

```json
"server": { "host": "server-cracked-anda.com", "port": 25565 },
"account": { "username": "jack01" }
```

```bash
npm start
```

### 2. Delapan bot

`profiles.json` sudah berisi `jack01`–`jack08`. Ganti `defaults.server`:

```json
{
  "defaults": {
    "server": { "host": "server-cracked-anda.com", "port": 25565 },
    "register": { "enabled": true, "mode": "auto" },
    "logging": { "file": "./logs/{name}.log" }
  },
  "profiles": [
    { "name": "jack01" },
    { "name": "jack02" }
  ]
}
```

`{name}` di `logging.file` diganti nama profil, jadi tiap bot punya log sendiri.
Opsional per profil: `"password": "rahasia"` atau `"enabled": false` untuk melewati bot.

```bash
npm run multi
```

keluaran:

```
memuat 8 profil dari profiles.json | register mode: auto | jeda join: 3000ms
password: <username>

[2026-10-01 23:11:15] INFO  [jack01] menghubungkan ke server-cracked-anda.com:25565 sebagai "jack01" ...
[2026-10-01 23:11:16] OK    [jack01] login berhasil - versi 1.16, protocol 735
[2026-10-01 23:11:18] INFO  [jack01] auto-register (2x): /register <password> <password>
[2026-10-01 23:11:19] OK    [jack01] spawn di overworld (15, 101, 15) - AFK bot aktif (mode safe)

BOT      STATE          REGISTER     JOIN      UPTIME
---------------------------------------------------------
jack01   online         authenticated    1       2m 10s
jack02   online         authenticated    1       2m 10s
...
8/8 online | 8 terautentikasi | proses uptime 5m 3s
```

Kolom `REGISTER`: `pending` → `logging-in` → `registering` → `authenticated` (atau `disabled`).
Bot dengan status paling bermasalah tampil paling atas.

Opsi:

```bash
npm run multi -- --profiles ./profiles.json   # file profil lain
npm run multi -- --stagger 8000               # jeda join antar bot (ms)
npm run multi -- --statusEvery 30000          # interval tabel status (ms)
```

## Perintah console

`npm start`:

| Perintah | Fungsi |
| --- | --- |
| `help` | daftar perintah |
| `status` | status koneksi, versi, uptime, posisi |
| `pos` | posisi, HP, food, block atas/bawah |
| `stats` | jumlah aksi anti-AFK, lompat, makan, penyelamatan |
| `look [yaw] [pitch]` | putar kepala (derajat) |
| `idle` | paksa satu aksi anti-AFK sekarang |
| `eat` | paksa makan sekarang |
| `rescue` | cek bahaya lalu selamatkan bot |
| `say <pesan>` | kirim chat |
| `restart` | keluar lalu sambung ulang |
| `quit` | matikan bot |

`npm run multi`:

| Perintah | Fungsi |
| --- | --- |
| `status` | tabel status semua bot |
| `status <nama>` | detail satu bot (posisi, HP, food, register) |
| `stats <nama>` | statistik aksi AFK satu bot |
| `restart <nama>` | paksa sambung ulang satu bot |
| `stop <nama>` | hentikan satu bot |
| `help` | daftar perintah |
| `quit` | hentikan semua bot lalu keluar |

Bot yang sudah di-`stop` perlu jalankan ulang `npm run multi`.

## Konfigurasi

### `account`

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `username` | `"jack01"` | username bot di server |

### `register`

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `enabled` | `true` | `false` = tidak kirim apa pun |
| `mode` | `"auto"` | `auto` \| `login` \| `register` \| `off` |
| `password` | `null` | `null` = sama dengan username |
| `delayMs` | `1500` | jeda setelah spawn sebelum perintah pertama |
| `retryMs` | `6000` | jeda antar percobaan ulang |
| `maxAttempts` | `3` | batas percobaan per sesi |
| `maxAuthFailures` | `3` | batas kick auth berturut-turut sebelum bot berhenti |

### `afk`

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `mode` | `"safe"` | `look` \| `safe` \| `wander` |
| `minIntervalMs` | `25000` | jeda minimum antar aksi |
| `maxIntervalMs` | `55000` | jeda maksimum antar aksi |
| `yawStepDeg` | `70` | besar putaran kepala (derajat) |
| `pitchMinDeg` / `pitchMaxDeg` | `-25` / `15` | rentang kemiringan kepala |
| `swingArm` | `true` | ayunkan lengan tiap aksi |
| `jumpChance` | `0.45` | peluang melompat tiap aksi |

| Mode | Yang dilakukan |
| --- | --- |
| `look` | putar kepala + ayun lengan saja (paling aman) |
| `safe` | `look` + lompat pelan (default) |
| `wander` | `safe` + jalan 1 langkah ke blok aman terdekat lalu diam |

Naikkan ke `"wander"` kalau plugin AFK server hanya menghitung perpindahan posisi, bukan rotasi
kepala. Bot hanya melangkah ke blok yang di atasnya ada block solid, jadi tidak jatuh.

### `survival`

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `autoEat` | `true` | makan otomatis saat lapar / HP rendah |
| `eatBelowFood` | `18` | makan kalau food < 18 |
| `eatBelowHealth` | `17` | makan kalau HP < 17 (untuk regen) |
| `rescue` | `true` | keluar dari lava / air, kembali ke blok aman |
| `lowHealthQuit` | `0` | keluar kalau HP <= nilai ini; `0` = nonaktif |

### `reconnect`

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `baseMs` | `6000` | jeda awal sebelum coba ulang |
| `maxMs` | `180000` | batas jeda maksimum |
| `factor` | `1.8` | pengali exponential backoff |
| `jitter` | `0.3` | acak ±30% supaya tidak menumpuk |
| `maxAttempts` | `0` | batas percobaan gagal; `0` = tak terbatas |
| `afkKickExtraMs` | `90000` | jeda tambahan kalau dikick karena AFK |

Kick akibat AFK dikenali dari isi pesannya lalu jeda diperpanjang 90 detik. Kick akibat
autentikasi/registrasi dicoba ulang sampai `maxAuthFailures`.

### `join` dan `logging`

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `join.spawnTimeoutMs` | `90000` | belum spawn dalam ini → sambung ulang |
| `join.autoReconnect` | `true` | `false` = berhenti saat putus |
| `logging.level` | `"info"` | `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `logging.file` | `"./logs/afk-bot.log"` | `null` = matikan file log |
| `logging.logChat` | `true` | tampilkan chat di terminal |
| `logging.maxLogFileBytes` | `5242880` | rotasi jadi `.log.1` |

## CLI dan environment variable

```bash
node index.js --host server.com --port 25565 --username jack01 --afk wander
node index.js --register register --registerPassword rahasia
node index.js --noRegister --log debug --noFile
```

```
MC_HOST, MC_PORT, MC_USERNAME, MC_VERSION, MC_REGISTER_MODE, MC_REGISTER_PASSWORD,
MC_NO_REGISTER, MC_LOG_LEVEL, MC_AFK_MODE, MC_AFK_INTERVAL, MC_CONFIG, MC_CONFIG_JSON
```

`MC_CONFIG` menunjuk file JSON lain; `MC_CONFIG_JSON` menerima objek JSON langsung (dipakai
orkestrator untuk menimpa config per profil).

## Struktur file

```
index.js            satu bot: bootstrap, console, sinyal
multi.js            orkestrator multi-bot dalam satu proses
config.json         konfigurasi utama (mode satu bot)
profiles.json       8 profil jack01-jack08 (mode multi-bot)
libping.js          cek versi/status server
lib/config.js       load config + merge CLI/env
lib/runner.js       logika satu bot: koneksi, event, reconnect, shutdown
lib/register.js     auto-register / auto-login
lib/profiles.js     load + validasi file profil
lib/behaviors.js    anti-AFK, auto-makan, penyelamatan
lib/backoff.js      exponential backoff + jitter
lib/console.js      perintah console interaktif
lib/logger.js       log bertimestamp ke terminal + file
```

## Test

```bash
npm test                 # unit + integration
npm run test:units       # fungsi murni
npm run test:register    # logika auto-register (47 test)
npm run test:integration # reconnect + mode AFK
npm run test:register-live # register sungguhan lewat server lokal (17 test)
npm run test:multi       # 8 bot + shutdown bersih (37 test)
```

Semua test memakai server Minecraft lokal palsu (`test/local-server.js`) dengan simulasi
AuthMe (`TEST_REQUIRE_AUTH=1`), tidak menyentuh server nyata.

## Troubleshooting

**Bot tidak daftar dan langsung kicked**
`register.mode` mungkin salah, atau perintah `/register` tidak ada di server. Cek log: akan ada
`kick autentikasi: ...`. Jalankan manual dari dalam game untuk memastikan formatnya.

**`register mode` tidak dikenal saat start**
Pakai `auto`, `login`, `register`, atau `off`.

**Akun sudah dipakai orang lain**
Server membalas `That name is already registered` / `The name is already taken`. Ganti username
di `profiles.json`.

**Wrong password saat login**
Password profil tidak cocok dengan password saat pendaftaran. Isi `"password"` per profil, atau
pakai `mode: "register"` untuk account baru saja.

**Langsung kena kick AFK**
Naikkan `afk.mode` ke `"wander"`, turunkan interval ke `10000`/`20000`. Kalau masih kena,
kemungkinan plugin server hanya memeriksa packet gerak.

**8 bot lambat start / kicked karena burst**
Naikkan `--stagger` (misal `8000`) supaya join tidak berbarengan.

**8 bot start lambat padahal `--stagger` kecil**
Semua bot share satu proses Node, jadi bottleneck-nya di CPU/RAM mesin, bukan jaringan. Kurangi
jumlah profil atau jalankan di mesin yang lebih ringan.