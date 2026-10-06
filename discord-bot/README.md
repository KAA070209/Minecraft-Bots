# discord-bot — kendali bot Minecraft dari Discord

Jembatan (bridge) antara Discord dan proses `mc-afk-bot` yang sudah berjalan di hosting.
Discord bot **tidak** bicara langsung ke server Minecraft: dia mengirim request ke
HTTP control API milik proses bot (`lib/api.js`), dan proses itu yang menjalankan
perintahnya ke bot Minecraft.

Jadi cara kerjanya:

```
Discord  ->  discord-bot (discord.js)  ->  HTTP + token  ->  lib/api.js  ->  lib/control.js  ->  bot Minecraft
```

Keuntungannya: proses Minecraft tidak perlu tahu apa-apa soal Discord, dan service
Discord boleh dijalankan di mesin lain (PC lokal, VPS kedua) selama bisa menjangkau
port API.

## 1. Nyalakan API di proses bot Minecraft

Di `config.json` (proses yang berjalan di hosting):

```json
"api": { "enabled": true, "host": "127.0.0.1", "port": 8787, "token": "token-acak-panjang", "logRequests": true }
```

Atau lewat env/CLI tanpa mengubah file:

```bash
MC_API=1 MC_API_TOKEN=token-acak-panjang node multi.js
node index.js --api --apiPort 8787 --apiToken token-acak-panjang
```

Kalau `api.enabled=true` tapi `api.token` kosong, proses **menolak start** dengan
pesan jelas — API ini bisa menyalakan, memanen, dan mematikan bot, jadi tidak boleh
dibuka tanpa token.

Restart proses bot Minecraft setelah mengubah config.

## 2. Siapkan bot Discord

1. Buka https://discord.com/developers/applications → **New Application**
2. Menu **Bot** → **Reset Token** → salin tokennya
3. Menu **OAuth2 → URL Generator** → centang `bot` + `applications.commands`,
   lalu **Copy URL** dan buka di browser untuk menginvite bot ke server kamu
4. Di server Discord: **Server Settings → Roles** buat role baru (misal
   `Minecraft Admin`), lalu **Server Settings → Roles → Minecraft Admin** →
   aktifkan **View Channel**, **Send Messages**, **Read Message History**, dan
   **Embed Links**

Bot ini memakai perintah prefix (`!status`), jadi intent `Message Content` harus
aktif — dan harus dinyalakan juga di **Bot → Privileged Gateway Intents**. Kalau
Discord tidak membalas sama sekali, cek situ dulu.

## 3. Isi `.env`

```bash
cd discord-bot
npm install
copy .env.example .env
```

Isi minimal:

```dotenv
DISCORD_TOKEN=token-bot-dari-step-2
MC_API_URL=http://127.0.0.1:8787
MC_API_TOKEN=token-acak-panjang
```

`MC_API_TOKEN` **harus sama** dengan `api.token` di config.json proses bot.

Kalau service Discord jalan di mesin lain, buka firewall-nya:

```bash
sudo ufw allow from <IP-kamu> to any port 8787 proto tcp
```

Sebaiknya tetap pakai SSH tunnel supaya API tidak terekspos ke internet:

```bash
ssh -N -L 8787:127.0.0.1:8787 user@host-bot
```

lalu di `.env` pakai `MC_API_URL=http://127.0.0.1:8787`.

## 4. Jalankan

```bash
npm start
```

Kalau Discord login tapi jawabannya "tidak bisa menghubungi API", berarti proses bot
Minecraft belum jalan dengan `api.enabled=true` atau `MC_API_URL` salah.

## Deploy ke Railway (repo sendiri)

Kalau folder ini di-push sebagai repo sendiri (mis. `KAA070209/discord-bot-mc`), isi
folder ini menjadi root repo, jadi `railway.json` memakai path relatif ke folder ini:

```
buildCommand  : npm ci --omit=dev
startCommand  : node index.js
```

Jangan set **Root Directory** ke `discord-bot` di dashboard — untuk repo standalone
folder itu sudah root-nya, dan mengisinya jadi `discord-bot/discord-bot` yang tidak ada
lalu deploy gagal.

Semua config lewat **environment variable** di dashboard, bukan `.env` (file `.env`
di-ignore git dan tidak ikut ke image):

```
DISCORD_TOKEN=token-dari-tab-Bot-di-developer-portal
MC_API_TOKEN=token-yang-sama-dengan-service-bot-minecraft
MC_API_URL=https://domain-publik-bot-minecraft.up.railway.app
DISCORD_ALLOWED_CHANNELS=1556713848944201828
```

Kalau `railway.json` di repo ternyata masih `node discord-bot/index.js`, itu sisa
setting untuk repo monorepo dan deploy akan gagal dengan `Cannot find module`.

## Perintah

`nama` = nama bot di server Minecraft (`jack01`, `AzkaSaadi`, ...), `all` = semua bot.

| Perintah | Fungsi |
| --- | --- |
| `!help` | daftar perintah |
| `!status` | tabel status semua bot |
| `!status <nama>` | detail satu bot |
| `!pos [nama]` | posisi, health, food |
| `!stats [nama]` | statistik AFK, pukul mob, beli, panen |
| `!inv [nama] [filter] [max]` | isi inventory (nama bot boleh dihilangkan, jadi semua bot) |
| `!invall [filter] [max]` | isi inventory semua bot |
| `!attack [nama\|all] [on\|off]` | pukul mob otomatis |
| `!buy [nama\|all]` | beli item shop sekarang |
| `!dump [nama\|all]` | buang isi inventory |
| `!harvest [nama\|all]` | panen lahan sekarang |
| `!harveststop [nama\|all]` | batalkan siklus panen |
| `!farm [nama\|all] [on\|off]` | status/nyalakan auto-panen |
| `!farmon [nama\|all]` | nyalakan auto-panen |
| `!farmoff [nama\|all]` | matikan auto-panen |
| `!stop [nama\|all]` | berhenti total (panen, pukul mob, gerak) |
| `!say <nama> <pesan>` | chat dari satu bot |
| `!sayall <pesan>` | chat dari semua bot |
| `!solve [nama] <soal>` | jawab soal lewat solver/AI (tidak dikirim ke server) |
| `!look [nama] <yaw> [pitch]` | putar kepala |
| `!walk [nama] <arah> [ms]` | gerakkan bot (`forward`, `back`, `left`, `right`, `jump`, `sneak`, `sprint`) |
| `!halts [nama]` | hentikan semua gerakan |
| `!idle [nama]` | faksa aksi anti-AFK |
| `!eat [nama]` | faksa makan |
| `!rescue [nama]` | selamatkan dari lava/air/jatuh |
| `!restart [nama\|all]` | paksa sambung ulang |
| `!shutdown <nama> confirm` | matikan satu bot (perlu start ulang proses) |

Semua perintah yang tidak butuh nama bot bisa dikosongkan, artinya berlaku untuk
semua bot: `!attack on` = nyalakan pukul mob di semua bot.

`!inv` tanpa nama bot membaca daftar bot dari API, jadi `!inv carrot` tetap berarti
filter nama item, bukan nama bot.

## Keamanan

| Opsi | Default | Fungsi |
| --- | --- | --- |
| `DISCORD_ALLOWED_USERS` | kosong (semua boleh) | ID user Discord yang boleh memakai perintah |
| `DISCORD_ALLOWED_ROLES` | kosong (semua boleh) | ID role yang boleh memakai perintah |
| `DISCORD_ALLOWED_CHANNELS` | kosong (semua channel) | ID channel yang boleh dipakai |
| `DISCORD_ALLOWED_GUILDS` | kosong (semua server) | ID guild yang boleh dipakai |
| `DISCORD_REQUIRE_CONFIRM` | `false` | perintah berbahaya (`shutdown`) minta tambahan kata `confirm` |
| `DISCORD_PREFIX` | `!` | prefix perintah |

Sangat disarankan mengisi minimal `DISCORD_ALLOWED_USERS`, karena siapa pun yang bisa
mengirim pesan di channel itu bisa menyuruh bot Minecraft berchat, menyerang, atau
mematikan bot.

API-nya sendiri dibatasi 60 request per 10 detik per IP, dan menolak request tanpa
token yang cocok.

## Test

```bash
npm test
```

Menguji parsing perintah, pemetaan ke baris API, dan pemotongan embed tanpa perlu
koneksi Discord maupun server Minecraft.