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
- **pukul mob** otomatis (cari mob terdekat, pilih senjata terbaik, serang sampai knock)
- **beli shop otomatis** — GUI atau perintah, dan **buang seluruh isi inventory saat penuh**
- **lihat isi inventory** dari console (`inv`), lengkap dengan filter nama item
- **panen lahan** (wortel/gandum/kentang) + ambil drop + tanam ulang
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
| `stats` | jumlah aksi anti-AFK, lompat, makan, penyelamatan, pukul mob, beli, panen |
| `look [yaw] [pitch]` | putar kepala (derajat) |
| `idle` | faksa satu aksi anti-AFK sekarang |
| `eat` | faksa makan sekarang |
| `rescue` | cek bahaya lalu selamatkan bot |
| `attack [on\|off\|stop]` | lihat/nyalakan/matikan pukul mob otomatis |
| `buy` | beli daftar item shop sekarang |
| `dump` | buang semua isi inventory (kecuali `shop.keep`) |
| `inv [filter] [max]` | lihat isi inventory: jumlah slot terpakai, item di tangan, daftar tumpukan (filter = nama item, max = jumlah baris) |
| `harvest` | panen lahan di `farm.area` sekarang |
| `harvest stop` | batalkan panen yang sedang jalan (auto-panen tetap menyala) |
| `farm [on\|off]` | lihat/nyalakan/matikan auto-panen |
| `stop` | berhenti total: batalkan panen, matikan auto-panen + pukul mob, hentikan gerakan |
| `say <pesan>` | kirim chat |
| `restart` | keluar lalu sambung ulang |
| `quit` | matikan bot |

`npm run multi`:

| Perintah | Fungsi |
| --- | --- |
| `status` | tabel status semua bot |
| `status <nama>` | detail satu bot (posisi, HP, food, register) |
| `stats <nama>` | statistik AFK + pukul mob + beli + panen satu bot |
| `attack [nama] [on\|off\|stop]` | pukul mob satu bot (`off`/`stop` = berhenti menyerang) |
| `buy <nama>` | beli item shop di satu bot |
| `dump <nama>` | buang isi inventory satu bot |
| `inv <nama> [filter] [max]` | lihat isi inventory satu bot |
| `invall [filter] [max]` | lihat isi inventory semua bot aktif |
| `harvest <nama>` | panen lahan satu bot |
| `harvest <nama> stop` | batalkan panen satu bot yang sedang jalan |
| `farm <nama> [on\|off]` | lihat/nyalakan/matikan auto-panen satu bot |
| `stopall` | hentikan panen + pukul mob semua bot |
| `restart <nama>` | paksa sambung ulang satu bot |
| `stop <nama>` | hentikan satu bot |
| `help` | daftar perintah |
| `quit` | hentikan semua bot lalu keluar |

Bot yang sudah di-`stop` perlu jalankan ulang `npm run multi`.

## Kontrol dari Discord

Bot Minecraft yang sudah jalan di hosting bisa dikontrol dari Discord tanpa menyentuh
terminal. Discord bot **tidak** bicara langsung ke server Minecraft; dia mengirim
request ke HTTP control API kecil milik proses bot, jadi proses Minecraft tidak perlu
tahu apa-apa soal Discord dan tidak ikut mati kalau Discord-nya error.

```
Discord -> discord-bot (discord.js) -> HTTP + token -> lib/api.js -> lib/control.js -> bot Minecraft
```

Nyalakan API di config.json:

```json
"api": { "enabled": true, "host": "127.0.0.1", "port": 8787, "token": "token-acak-panjang", "logRequests": true }
```

`api.enabled=true` tanpa `api.token` akan **menolak start** — API ini bisa menyalakan,
memanen, dan mematikan bot, jadi tidak boleh dibuka tanpa token. Kalau Discord bot
berjalan di mesin lain, pakai SSH tunnel supaya API tidak terekspos:

```bash
ssh -N -L 8787:127.0.0.1:8787 user@host-bot
```

Lalu service Discord-nya:

```bash
cd discord-bot
npm install
copy .env.example .env   # isi DISCORD_TOKEN + MC_API_TOKEN
npm start
```

Panduan lengkap (buat bot di Developer Portal, izin role, daftar perintahnya) ada di
[`discord-bot/README.md`](discord-bot/README.md). Ringkasnya:

| Perintah Discord | Fungsi |
| --- | --- |
| `!status` / `!status <nama>` | status semua bot / satu bot |
| `!pos`, `!stats`, `!inv [nama] [filter]`, `!invall` | posisi, statistik, isi inventory |
| `!attack [nama\|all] [on\|off]`, `!buy`, `!dump` | pukul mob, beli shop, buang tas |
| `!harvest`, `!harveststop`, `!farm`, `!farmon`, `!farmoff` | panen lahan dan auto-panen |
| `!say <nama> <pesan>`, `!sayall <pesan>` | chat dari bot |
| `!walk`, `!look`, `!halts`, `!idle`, `!eat`, `!rescue` | kendali gerak dan survival |
| `!stop`, `!restart`, `!shutdown <nama> confirm` | hentikan/sambung ulang/matikan |

Nama bot boleh diisi `all` untuk semua bot, dan perintah tanpa nama tetap berlaku untuk
semua bot (`!attack on` = nyalakan pukul mob di semua bot). `npm run multi` membuka satu
API saja untuk semua profil, jadi `all` berarti semua akun di `profiles.json`.

### Endpoint API

| Method | Endpoint | Isi |
| --- | --- | --- |
| `GET` | `/health` | hidup/mati API (tanpa token, buat cek koneksi) |
| `GET` | `/api/status` | status semua bot |
| `GET` | `/api/commands` | daftar perintah yang tersedia |
| `POST` | `/api/command` | `{ "line": "attack jack01 on" }` — satu baris perintah console |

Semua endpoint selain `/health` wajib kirim `Authorization: Bearer <api.token>` (atau
`?token=`). Ada rate limit 60 request per 10 detik per IP, dan setiap request dicatat di
log kalau `api.logRequests=true`.

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

### `combat` (pukul mob)

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `enabled` | `false` | `true` = pukul mob hostile secara otomatis |
| `range` | `12` | jangkauan cari target (blok) |
| `attackRange` | `3` | jarak mulai mengayun pedang |
| `approach` | `true` | `false` = bot tidak pernah bergerak: mob yang terlihat langsung dipukul dari posisi bot sekarang, bahkan kalau belum masuk jangkauan, dan tidak pernah masuk daftar target yang dicoret karena "tidak bisa didekati" |
| `holdStill` | `["warden"]` | mob yang **tidak boleh didekati**: bot diam di posisinya (mis. di atas spawner) dan hanya memukul saat mob masuk jangkauan. Berlaku per jenis mob, jadi mob lain tetap didekati. `[]` = semua mob didekati. Kalau bot berdiri di atas blok spawner, lihat catatan di bawah |
| `intervalMs` | `500` | jeda scan keputusan (cari target / mendekat). Ini tetap periode loop, bukan jeda ayunan |
| `attackCooldownMs` | `100` | jeda antarayunan (`100` = 10 CPS, `0` = spam tanpa jeda, dibatasi 40 CPS) |
| `cpsMin` / `cpsMax` | `null` | `null` = click rate tetap dari `attackCooldownMs`. Kalau diisi, jeda tiap klik **diacak** di antara `cpsMin` dan `cpsMax` (persis seperti mod auto clicker), jadi pola ayunan tidak terlihat tetap: `{ "cpsMin": 8, "cpsMax": 14 }` = acak 8-14 klik/detik. Batas tersirat 0,5-40 CPS |
| `attackDelayMs` | `2000` | jeda **minimum** antar serangan (ms): pukulan berikutnya ditahan sampai nilai ini lewat supaya damage penuh sempat masuk ke server (tidak ada spam yang damage-nya terbuang). Menang atas `attackCooldownMs`/`cpsMin`-`cpsMax`; `0` = tanpa patokan |
| `aimHeight` | `0.8` | tinggi bidikan di atas kaki mob (blok): `0` = kaki, `0.8` = bagian bawah badan. Nilai ini selalu dijepit supaya tidak keluar dari hitbox mob |
| `equipRetryMs` | `1000` | jeda sebelum equip diulang kalau server tidak menaruh senjata di tangan |
| `retreatBelowHealth` | `6` | HP <= nilai ini → berhenti menyerang untuk regen; `0` = nonaktif |
| `jumpWhenBlocked` | `true` | target yang belum bisa didekati dan jaraknya tidak mengecil → coba lompat sekali sebelum menyerah |
| `stuckTimeoutMs` | `3000` | jarak ke target tidak mengecil selama nilai ini → dicoret dari daftar target |
| `giveUpMs` | `15000` | total target yang tidak bisa didekati selama nilai ini → menyerah, cari mob lain |
| `attackPlayers` | `false` | `true` = boleh menyerang player (default tidak) |
| `whitelist` | `[]` | kalau diisi, **hanya** mob dalam daftar ini yang diserang |
| `ignore` | `[]` | mob yang tidak boleh diserang (mis. `["creeper"]`) |

**Diam di atas spawner (anchor warden):** setiap kali target yang dilawan ada di
`holdStill` (default `warden`) **dan** bot sedang berdiri di atas blok spawner
(nama block memuat kata `spawner`, termasuk spawner kustom server), bot dibekukan
total di titik itu: tidak maju, tidak mundur — termasuk saat `retreatBelowHealth`
terpicu. Jadi posisi bot di atas spawner tidak pernah bergeser selama fight warden.
Begitu targetnya bukan warden lagi, atau bot sudah tidak di atas spawner, aturan
normal (termasuk mundur saat HP rendah) berlaku kembali. Kalau chunk belum dimuat
atai `blockAt` tidak tersedia, bot dianggap tidak di atas spawner dan perilaku
lama dipakai.

Bot hanya menyerang mob hostil (zombie, skeleton, spider, creeper, slime, dll). Player,
villager, hewan, item, `armor_stand`, dan naga tidak pernah jadi target kecuali
`whitelist` diisi eksplisit. `ignore` menang atas `whitelist`. Deteksi hostile memakai nama
mob, `entity.type/kind/category`, dan registry vanilla (jadi mob dari mod yang dikenal
ikut dipukul).

Urutan kerjanya: begitu mob terlihat, senjata terbaik di tas langsung dipegang di tangan
(pedang > kapak > beliung > sekop, lapis tertinggi dulu), baru bot menyusul dan mengayun.
Senjata tidak menunggu sampai mob dalam jangkauan, karena memindahkan item butuh beberapa
klik ke server dan kalau ditunggu, ayunan pertama sampai dengan tangan kosong. Kalau
`equip` gagal, pukulan tetap jalan dan senjata dicoba lagi; kalau server menerima equip
tanpa benar-benar menaruh senjata di tangan, `equipRetryMs` mengatur kapan percobaan
berikutnya dilakukan. `!attack` menampilkan senjata yang sedang dipegang.

Periode loop combat tetap `intervalMs`; yang menentukan kecepatan ayunan bukan timer
itu tapi physics tick Mineflayer (sekitar 50 ms), jadi `attackCooldownMs`/`cpsMin`-
`cpsMax` mengatur selisih antarayunan tanpa ikut mengubah jeda scan (`100` ms =
10 CPS, `0` = tanpa jeda, dibatasi 40 CPS). Mob yang jaraknya masih jauh dikejar
sambil berlari; target yang tidak bisa didekati (terhalang, atau beda tinggi/jauh)
dilompati lalu dicoret supaya bot tidak nyangkut.

Ayunan tidak boleh mendahului rotasi. Tiap ayunan arahkan dulu kepala ke
`aimHeight` di atas kaki mob, lalu paket `look` dikirim di physics tick itu juga
dan ayunan menyusul setelah paket itu keluar. Kalau ayunan dikirim duluan, server
masih memakai arah pandang dari tick sebelumnya dan damage-nya 0 padahal animasi mengayun.
Karena itu `combat.interval` (yang ditampilkan `!attack`) adalah jeda acak
sekaligus periode loop, bukan jeda ayunan. Ayunan pertama begitu target terkunci
tetap langsung dikirim, kecuali `approach: false` dengan mob yang sudah di
jangkauan: di mode diam itu ayunan pertama dititipkan ke physics tick berikutnya, dan
ayunan setelahnya tetap jalan di tick biasa supaya tempo mengayun tidak melambat.

`cpsMin`/`cpsMax` mengubah jeda tetap jadi jeda acak, persis seperti mod auto clicker
yang tidak mengklik dengan kecepatan selalu sama: setiap klik ambil angka random antara
`1000/cpsMax` dan `1000/cpsMin` ms. Satu undian dipakai sebagai cooldown pukul yang
diperiksa saat ayunan berikutnya mau dikirim, bukan diundi ulang, supaya CPS yang ditulis
memang yang terjadi — kalau dihitung dua kali, jeda efektifnya jadi penjumlahan dua
undian dan click rate asli selalu lebih rendah dari yang diminta. Yang diacak hanya jeda
antarayunan; bergerak, lari, dan lompat tidak ikut berubah.

`attackDelayMs` (default `2000`) adalah patokan keras di atas semua itu: pukulan berikutnya
tidak pernah dikirim sebelum jeda ini lewat, jadi damage penuh dari serangan sebelumnya
sempat masuk ke server dan tidak ada spam yang damage-nya terbuang. Kalau `attackCooldownMs`
atau `cpsMin`/`cpsMax` meminta jeda lebih pendek, yang dipakai tetap `attackDelayMs`;
set `0` untuk melepas patokan ini.

Auto-panen dan pukul mob sama-sama menggerakkan bot, jadi hanya boleh satu yang memegang
kontrol gerak. Begitu ada target, auto-panen berhenti jalan dan siklus panennya ditunda sampai
duel selesai. Kalau tidak, keduanya saling membalik arah tiap tick: bot terlihat jalan,
tapi tidak pernah sampai ke mob.

Deteksi "macet" memakai jarak ke target, bukan sekadar "bot bergerak". Bot yang mondar-
mandar atau berputar di tempat tetap dihitung macet setelah `stuckTimeoutMs`, jadi tidak
lagi dikejar tanpa henti. `!attack` menampilkan aksi terakhir (`dekati`/`serang`) dan jarak
terakhir ke mob, jadi langsung kelihatan apakah bot "tidak sampai" atau "sudah sampai tapi
tidak kena".

### `shop` (beli otomatis + buang inventory)

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `enabled` | `false` | `true` = beli otomatis sesuai `items` |
| `mode` | `"gui"` | `gui` = klik GUI shop, `command` = kirim perintah chat |
| `command` | `"/shop"` | perintah untuk membuka GUI shop |
| `items` | `["carrot","wheat","cooked_beef"]` | daftar nama item yang dibeli |
| `amount` | `64` | jumlah default per item |
| `amounts` | `{}` | jumlah per item, contoh `{ "carrot": 64, "cooked_beef": 32 }` |
| `intervalMs` | `300000` | jeda antar siklus belanja (5 menit) |
| `buyIntervalMs` | `1500` | jeda antar klik/purchase |
| `maxBuyPerCycle` | `8` | batas item per siklus; `0` = tanpa batas |
| `dumpWhenFull` | `true` | inventory penuh → **buang semua isi** dulu |
| `reserveSlots` | `1` | sisakan N slot kosong (tidak ikut dibuang) |
| `keep` | `["shield","elytra","totem_of_undying"]` | item yang tidak pernah dibuang |
| `shiftBuy` | `false` | `true` = shift-klik (beli satu stack) |
| `closeAfter` | `true` | tutup GUI setelah selesai belanja |
| `buyCommandTemplate` | `"/shop buy {item} {amount}"` | template untuk `mode: command` |

Cara kerja: bot kirim `command` → GUI terbuka → klik slot yang namanya ada di `items` → kalau
inventory sudah penuh, bot **membuang seluruh isi tas** (kecuali `keep`), lalu lanjut belanja.
Slot yang tidak muat dilewati supaya pembelian tidak gagal. Kalau `mode: command`, bot memakai
`buyCommandTemplate` per item (`/shop buy carrot 64`).

### `farm` (panen lahan)

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `enabled` | `false` | `true` = auto-panen |
| `autoDiscover` | `true` | bot mencari lahan sendiri di sekitar posisinya, jadi `farm.area` boleh dibiarkan kosong |
| `searchRadius` | `32` | radius pencarian lahan dari posisi bot (maks 64) |
| `searchIntervalMs` | `30000` | jeda antar pencarian lahan baru (min 5000) |
| `area.x` / `area.y` / `area.z` | `0` / `64` / `0` | titik tengah lahan; kalau diisi, dipakai duluan sebelum cari sendiri |
| `area.radius` | `8` | radius scan (maks 32) |
| `area.bounds` | `null` | lahan berbentuk **kotak**: `{ "minX": .., "maxX": .., "minZ": .., "maxZ": .. }`. Dipakai duluan daripada `x/z/radius`, dan boleh jauh lebih lebar dari radius 32 (maks 256 blok per sisi) |
| `crops` | `["carrots","wheat","potatoes"]` | nama tanaman; blok (`carrots`) atau item (`carrot`) sama-sama diterima |
| `scanHeight` | `2` | tinggi scan di atas `area.y` (1-6) supaya Zamora/terrace tetap kena |
| `scanIntervalMs` | `15000` | jeda antar scan lahan, sekaligus masa berlaku cache scan |
| `harvestIntervalMs` | `400` | jeda setelah selesai jalan ke sekumpulan tanaman, bukan jeda tiap tanaman |
| `reach` | `3.2` | jangkauan memotong; semua tanaman dalam jangkauan dipotong sekaligus sebelum bot jalan lagi |
| `walkToRadius` | `24` | kalau lahan kosong tapi jaraknya lebih dari ini, bot jalan ke lahan lalu tunggu chunk termuat; `0` = tidak pernah jalan |
| `maxWalkDistance` | `64` | pengaman: kalau lahan lebih jauh dari ini, bot tidak jalan dan lapor koordinat area yang kelihatan salah |
| `walkTimeoutMs` / `walkStepMs` | `8000` / `250` | batas waktu dan jeda antar langkah jalan |
| `cropWalkSteps` | `0` | maksimal langkah jalan mengejar satu tanaman; `0` = tanpa batas (berhenti hanya kalau benar-benar macet) |
| `chaseRange` | `0` | jarak maksimal satu tanaman boleh dikejar dalam blok; `0` = tanpa batas. Dengan nilai > 0, tanaman yang lebih jauh tidak dikejar ke pojok lahan: bot memotong yang terjangkau lalu menyusun rencana ulang |
| `pathRadius` | `24` | setengah sisi kotak pencarian rute memutar (A*) saat jalan terhalang; rentang 4-48 |
| `betweenCycleMs` | `600` | jeda cepat antar siklus panen ketika tidak ada tanaman siap dipanen (min 200) |
| `jumpToClimb` | `false` | `true` = boleh melompat untuk lewat obstacle; default jalan biasa |
| `jumpCooldownMs` | `1500` | jeda minimal antar lompatan |
| `sprint` | `false` | `true` = lari (Shift) saat mengejar tanaman jauh |
| `dropWaitMs` / `dropStepMs` | `1500` / `150` | menunggu item jatuh muncul sebelum diambil |
| `pickupRadius` / `pickupAttempts` | `12` / `14` | radius dan jumlah percobaan ambulance drop |
| `pickupStepMs` | `150` | jeda antar langkah saat mengejar item jatuh |
| `sweepDrops` | `true` | di akhir siklus, keliling ambil sisa hasil panen yang gagal terambil |
| `sweepLimit` | `8` | maksimal item yang dicoba ambil dalam satu sapuan akhir siklus |
| `dropMemoryMs` | `120000` | berapa lama hasil panen dianggap milik bot (mencegah bot mengejar drop orang lain) |
| `useTool` | `true` | pakai cangkul terbaik sebelum memanen |
| `maxPerCycle` | `0` | batas tanaman per siklus; `0` = tanpa batas, panen berjalan terus sampai di-stop |
| `harvestCooldownMs` | `60000` | tanaman yang sudah dipanen (lokasi sama) tidak dihitung lagi sampai jeda ini habis, jadi bot tidak memanen ulang tanaman yang baru ia tanam sendiri; `0` = nonaktif |
| `replant` | `true` | tanam ulang setelah panen |
| `replantItem` | `null` | item untuk tanam ulang; default ikut tanaman (wortel → wortel) |

Cara kerja: bot scan kotak `area` (termasuk `scanHeight` tinggi di atas `area.y`), ambil tanaman yang
berdiri di atas tanah sawah (`farmland`/`dirt`), lalu jalan biasa menuju tanaman terdekat sambil
memotong semua tanaman yang sudah dijangkau di jalur jalan. Setiap tanaman dipatah → tunggu drop
muncul → ambil → tanam ulang, tapi tidak satu per satu berdiri diam.

Bisa juga diisi empat sudut (harus 4 titik, urut bebas) atau dua titik `{x, z}`, hasilnya sama persis
dengan `bounds` di atas:

```json
"area": {
  "y": 62,
  "corners": [
    { "x": 7986, "z": 7507 }, { "x": 8084, "z": 7507 },
    { "x": 8084, "z": 7572 }, { "x": 7986, "z": 7572 }
  ]
}
```

atau dengan `bounds` (lebih ringkas):

```json
"area": {
  "y": 62,
  "bounds": { "minX": 7986, "maxX": 8084, "minZ": 7507, "maxZ": 7572 }
}
```

Untuk kotak besar, jarak dihitung ke tepi kotak, bukan ke titik tengah: begitu bot berdiri di dalam
lahan, `jarak 0` dan bot tidak mondar-mondar ke tengah lahan. Kalau bot di luar kotak, bot jalan ke
titik terdekat di tepi kotak (bukan ke pojok terjauh). `area.x/z/radius` boleh tetap ada di config,
kotak yang menang dipakai.

Hasil panen yang jatuh **ikut diambil**, dan hanya itu. Bot mencatat entity `item` yang muncul di dekat
tanaman yang baru saja dipotong, jadi carrot/wheat/biji yang dijatuhkan panen sendiri masuk tas tanpa
mengambil stack milik pemain lain atau loot dari mob. Satu tanaman bisa menjatuhkan lebih dari satu
stack (gandum + benih, wortel dengan Fortune) dan semuanya diambil. Kalau ada yang gagal terambil -
misalnya tas sudah penuh atau ada yang menghalangi - sisanya dicoba lagi di sapuan akhir siklus
(`sweepDrops`), sebelum bot pindah ke tanaman berikutnya.

Kalau ada tanaman yang **sudah masuk daftar panen** tapi persis menghalangi jalan, bot memotongnya
untuk membuka jalan lalu menunda tanam ulangnya sampai bot sudah melangkah lewat (berlubang sebentar di
tengah siklus, ditutup lagi sebelum siklus selesai atau saat `harvest stop`). Tidak ada lompatan dan
tidak lari kecuali `farm.jumpToClimb` / `farm.sprint` diaktifkan.

Bot cuma menyentuh apa yang ada di daftar panen siklus itu. Tanaman di luar `farm.crops`, di luar
`area`, atau yang type-nya tidak cocok tidak akan digali walaupun menghalangi jalan. Sebelum menggali
setiap tanaman dicek ulang lewat `blockAt`, jadi kalau bloknya sudah hilang (dipanen orang lain,
dihapus, atau sudah dipanen siklus ini) tanaman itu langsung dibuang dari daftar dan tidak dikejar.
Kalau `chaseRange` diisi, tanaman yang lebih jauh dari itu tidak dikejar: bot memotong yang terjangkau
lalu menyusun rencana ulang, jadi tidak nyangkut di pojok lahan. Dengan `chaseRange: 0` (default)
panen berjalan terus tanpa batas jarak sampai di-stop.

### Jalan terhalang → cari jalan lain

Tiap langkah jalan, dua hal dicek: tanaman di depan dipotong lebih dulu, lalu blok/mob/pemain yang
menghalangi jalur lewat `blockAt` dan posisi entity di sekitar (cek kamera). Kalau jalur ketutup,
bot mencari **rute memutar** dengan A* dalam kotak selebar `pathRadius` dan mengikutinya selangkah
demi selangkah; kalau tidak ada rute yang ketemu, bot kembali ke jalan biasa. Rute yang dipakai
tercatat di `stats.detours`, jadi bisa dilihat lewat `farm` di console. Penghalang yang cuma satu
blok tinggi tetap dilewati dengan cara memotong tanaman yang memang masuk daftar panen, tanpa
melompat (kecuali `jumpToClimb` aktif).

Scan penuh itu mahal (ribuan `blockAt`), jadi hasilnya disimpan sebentar (`scanIntervalMs`) dan
dipakai ulang: scan susulan dijadwalkan di jeda antar tanaman, bukan di tengah pemotongan. Efeknya
siklus berikutnya langsung bisa memotong tanpa scan dari nol, dan biaya scan turun drastis di lahan
besar. Kalau satu siklus tidak berhasil memotong apa pun, cache ditandai basi dan siklus berikutnya
scan ulang dari nol.

Kalau `area` kosong atau tidak ada tanaman di situ, `autoDiscover` aktif: bot mencari lahan sendiri
mulai dari posisi sekarang, melingkar ke luar (cincin 1, 2, 3, ... sampai `searchRadius`), berhenti di
lahan pertama yang berisi tanaman, lalu remembers area-nya untuk discan ulang sampai habis — baru cari
lahan berikutnya. Bot juga berjalan ke lahan yang ditemukan (dibatasi `maxWalkDistance`), jadi simpan
bot di dekat lahan. Contoh config paling sederhana:

```json
"farm": {
  "enabled": true,
  "crops": ["carrots"],
  "scanHeight": 3,
  "autoDiscover": true,
  "searchRadius": 48
}
```

Kalau ternyata ada lahan yang lebih dekat, isi `area` untuk memprioritaskan titik itu. Cek cepat dengan
perintah `farm` di console: area yang dipakai, jarak bot ke lahan, jumlah tanaman per tipe, filter
`crops`, lahan yang ditemukan, dan error terakhir. Kalau muncul "tidak ada tanaman", naikkan
`farm.scanHeight` atau `farm.searchRadius`, atau cek koordinat `area.y` dengan `pos`.

### `api` (kontrol dari Discord)

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `enabled` | `false` | `true` = buka HTTP control API untuk `discord-bot` |
| `host` | `"127.0.0.1"` | alamat listen; pakai `0.0.0.0` hanya kalau API dipasang di belakang reverse proxy + firewall |
| `port` | `8787` | port API |
| `token` | `null` | token bearer wajib; `enabled=true` tanpa token membuat proses menolak start |
| `logRequests` | `true` | catat tiap request (method, path, IP, kode, durasi) |

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
node index.js --combat --shop /shop --farm
node index.js --api --apiPort 8787 --apiToken token-acak-panjang
```

```
MC_HOST, MC_PORT, MC_USERNAME, MC_VERSION, MC_REGISTER_MODE, MC_REGISTER_PASSWORD,
MC_NO_REGISTER, MC_LOG_LEVEL, MC_AFK_MODE, MC_AFK_INTERVAL, MC_COMBAT, MC_SHOP,
MC_SHOP_COMMAND, MC_FARM, MC_CONFIG, MC_CONFIG_JSON, MC_API, MC_API_HOST, MC_API_PORT,
MC_API_TOKEN
```

`MC_CONFIG` menunjuk file JSON lain; `MC_CONFIG_JSON` menerima objek JSON langsung (dipakai
orkestrator untuk menimpa config per profil). `--combat`, `--shop <perintah>`, dan `--farm`
menyalakan fitur tanpa mengubah file config. `MC_API*`/`--api*` menyalakan HTTP control
API tanpa mengubah file config juga.

`MC_PROFILES_JSON` menerima isi `profiles.json` langsung sebagai JSON, jadi di hosting
tidak perlu file profil sama sekali dan password tidak pernah masuk git.

## Deploy ke Railway

Dua service terpisah dari repo yang sama: satu untuk bot Minecraft, satu untuk bridge
Discord. Satu service tidak cukup karena masing-masing proses menahan koneksi ke luar
sendiri (bot ke server Minecraft, bridge ke gateway Discord) tanpa batas waktu.

### 1. Deploy bot Minecraft

`New Project → Deploy from GitHub repo`, lalu **tambahkan service kedua** dari repo yang
sama untuk bridge Discord (lihat langkah 2).

Environment variables untuk service bot Minecraft:

```
MC_PROFILES_JSON={"profiles":[{"name":"AzkaSaadi","password":"..."},{"name":"TharXz","password":"..."},{"name":"VBIFERSS","password":"..."}]}
MC_API=1
MC_API_TOKEN=token-acak-panjang-kau-pilih
MC_HOST=minesive.com
MC_PORT=25565
```

`railway.json` di root sudah mengurus build, start command, dan healthcheck. API
otomatis bind ke `0.0.0.0` dan memakai `PORT` yang diberikan Railway kalau
`RAILWAY_ENVIRONMENT` terdeteksi, jadi `MC_API_HOST`/`MC_API_PORT` tidak perlu diisi.

`api.host=0.0.0.0` tanpa `MC_API_TOKEN` akan ditolak saat start, supaya API yang bisa
menyalakan/mematikan bot tidak pernah terbuka ke internet tanpa token.

Generate domain publik di tab **Settings → Networking → Generate Domain** supaya service
bot Minecraft bisa dijangkau dari luar. Railway memutus koneksi yang idle di plan trial,
jadi kalau proses bot terlalu lama diam, Railway menutup sesi TCP-nya, dan bot baru
menyambung kembali setelah fase reconnect.

### 2. Konfigurasi bridge Discord

Tambahkan service baru dari repo yang sama, lalu set **Root Directory** ke
`discord-bot` dan **Start Command** ke `node discord-bot/index.js` (atau pakai
`discord-bot/railway.json`). Railway membaca `railway.json` di root service, jadi kalau
root directory-nya `discord-bot`, file itu ikut terbaca.

Environment variables untuk service Discord:

```
DISCORD_TOKEN=token-dari-tab-Bot-di-developer-portal
MC_API_TOKEN=token-yang-sama-pakai-dengan-service-bot-minecraft
MC_API_URL=https://domain-publik-bot-minecraft.up.railway.app
DISCORD_ALLOWED_CHANNELS=1556713848944201828
```

`MC_API_TOKEN` harus identik dengan milik service bot Minecraft. Kalau berbeda, bridge
dapat `401` dan setiap perintah dibalas "token tidak valid".

Railway hanya menjangkau service lewat HTTP, bukan folder, jadi env var adalah satu-satunya
cara mengonfigurasi bridge di sana. `.env` tetap dipakai untuk pemakaian lokal.

### 3. Checklist setelah deploy

```
[service bot]     log: api kontrol listen di http://0.0.0.0:xxxx
[service bot]     curl domain-publik/health            -> {"ok":true,...}
[service Discord] log: discord login sebagai bot-mineflayer#0371
[service Discord] log:   server: <nama server>
[service Discord] log:   channel diizinkan: 1556713848944201828
[service Discord] log: api bot Minecraft hidup di https://... (3 bot: ...)
```

Kalau service Discord mencetak "bot belum masuk ke server Discord mana pun", berarti bot
belum diundang ke server kamu — lihat bagian Kontrol dari Discord untuk cara invite-nya.

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
lib/control.js      satu mesin perintah untuk semua bot (dipakai API kontrol + Discord)
lib/api.js          HTTP control API untuk discord-bot (token + rate limit)
lib/behaviors.js    anti-AFK, auto-makan, penyelamatan
lib/combat.js       pukul mob otomatis + pilih senjata
lib/shop.js         beli shop otomatis + buang inventory saat penuh
lib/inventory.js    baca + format isi inventory (filter, ringkasan slot, item tangan)
lib/farm.js         panen lahan + ambil drop + tanam ulang
lib/backoff.js      exponential backoff + jitter
lib/console.js      perintah console interaktif
lib/logger.js       log bertimestamp ke terminal + file
discord-bot/        service Discord.js terpisah (prefix commands -> HTTP API)
```

## Test

```bash
npm test                 # unit + features + control/API + integration
npm run test:units       # fungsi murni
npm run test:features    # pukul mob, shop, inventory, panen, config (425 test)
npm run test:control     # lib/control.js + lib/api.js (54 test, HTTP lokal)
npm run test:discord     # parsing perintah + embed discord-bot (89 test)
npm run test:register    # logika auto-register (53 test)
npm run test:integration # reconnect + mode AFK
npm run test:register-live # register sungguhan lewat server lokal (17 test)
npm run test:multi       # 8 bot + shutdown bersih (44 test)
```

Semua test memakai server Minecraft lokal palsu (`test/local-server.js`) dengan simulasi
AuthMe (`TEST_REQUIRE_AUTH=1`), tidak menyentuh server nyata.

## Troubleshooting

**Discord tidak menjawab sama sekali**
Bot Discord butuh intent `Message Content` aktif (**Bot → Privileged Gateway Intents**),
dan role-nya harus punya izin View Channel, Send Messages, Read Message History, dan
Embed Links.

**Discord jawab "tidak bisa menghubungi API"**
Proses bot Minecraft belum jalan dengan `api.enabled=true`, atau `MC_API_URL` di
`discord-bot/.env` tidak cocok dengan `api.host`/`api.port`. Cek cepat dari mesin Discord:

```bash
curl http://127.0.0.1:8787/health
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8787/api/status
```

**Discord jawab "token tidak valid"**
`MC_API_TOKEN` di `discord-bot/.env` harus sama persis dengan `api.token` di
`config.json` proses bot.

**API tidak mau start**
`api.enabled=true` tanpa `api.token` sengaja ditolak (proses berhenti dengan pesan jelas),
dan port yang sudah dipakai proses lain akan muncul sebagai
`api kontrol gagal listen: EADDRINUSE`.

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

**Bot tidak menyerang mob**
Cek `combat.enabled = true`, naikkan `combat.range` (default 12 blok), dan pastikan mob-nya
memang tipe hostile. Kalau hanya ingin jenis tertentu, pakai `combat.whitelist`.
Kalau mobnya muncul tapi tidak dipukul: jalankan `!attack` dan baca kolom `aksi`/`jarak`.
`aksi=dekati` dengan `jarak` yang tidak pernah turun berarti bot tidak bergerak maju (mis.
lokasi terhalang atau fitur lain sedang merebut kontrol gerak), sedangkan `aksi=serang`
berarti bot sudah mengayun dan masalahnya di senjata/server.
`stats` menampilkan jumlah target yang dicoret (`stuck`) karena jaraknya tidak pernah
mendekati — naikkan `combat.jumpWhenBlocked`, atau naikkan `combat.stuckTimeoutMs`/
`combat.giveUpMs` kalau sering terhalang. Log `debug` menyebut alasan target dilewati
(jarak, whitelist, `ignore`, atau blacklist).

**Bot menyerang tapi tangan kosong / damage-nya kecil**
Jalankan `!attack`: kolom `senjata` harus berisi nama pedang. Kalau `tangan kosong`, berarti
tidak ada senjata sama sekali di tas (`!inv` untuk cek isi tas) atau `combat.ignore` menutup
nama senjata itu. Kalau `senjata` sudah benar tapi damage tetap kecil, kemungkinan tangan
kemudian disita barang lain (bot juga memakai tangan untuk makan/panen) — tunggu sampai
`combat` selesai. Kalau nama senjata di `!attack` tidak pernah muncul padahal ada di tas,
turunkan `logging.level` ke `debug`: log `tangan masih ... coba pegang ... lagi` muncul
kalau server menolak equip tanpa error. Kalau ayunan terasa jalan tapi mobnya jarang
kena, cek `combat.aimHeight` (`0.8` = bagian bawah badan, selalu dijepit di dalam
hitbox) — bidikan terlalu tinggi membuat crosshair keluar dari mob kecil seperti slime
atau tupai.

**Lama banget kill mob**
Jeda antar serangan dikunci `combat.attackDelayMs` (default `2000` ms) supaya damage penuh
masuk sebelum pukulan berikutnya; turunkan atau set `0` kalau mau lebih agresif. Setelah itu,
turunkan `combat.attackCooldownMs` (default `100` = 10 CPS, `0` = spam tanpa jeda). Nilai ini
hanya mengatur selisih antarayunan, jadi `intervalMs` (jeda scan) tidak perlu disentuh.
Kalau mau click rate-nya diacak seperti mod auto clicker, isi `combat.cpsMin`/`combat.cpsMax`
(misal `8`/`14`) — satu menimpa jeda tetap, jadi `attackCooldownMs` boleh dipakai lagi
begitu `cpsMin` dikosongkan lagi.

**Bot tidak membeli apa-apa di shop**
Cek nama item di `shop.items` sama persis dengan nama item Minecraft (`carrot`, bukan ` Wortel`).
Kalau shop-nya berbasis perintah, ganti `shop.mode` ke `"command"`; kalau berbasis GUI, pastikan
`shop.command` (mis. `/shop`) benar. Log level `debug` menampilkan alasan melewatinya slot.

**Bot membuang barang penting**
`shop.keep` adalah daftar nama item yang tidak pernah dibuang. Tambahkan barang yang mau
disimpan, atau set `shop.dumpWhenFull = false` kalau inventory tidak boleh dikosongkan.

**Bot tidak memanen lahan**
Default bot mencari lahan sendiri di sekitar posisinya (`autoDiscover`, radius `searchRadius`). Kalau
`farm.crops` tidak cocok, tidak ada apa-apa yang ketemu — filter menerima nama blok **atau** item
tanaman (`carrots`/`carrot`, `wheat`/`wheat_seeds`). Naikkan `farm.searchRadius` kalau lahan jauh dari
tempat bot berdiri, atau isi `farm.area` dengan koordinat lahan (bisa pakai titik tengah + radius, atau
`bounds`/`corners` berbentuk kotak) supaya bot prioritas ke titik itu. `scanHeight` (default 2) mengatur
tinggi scan; naikkan kalau lahannya ada di bawah atau bertingkat. Kalau bot harus berjalan ke lahan,
`maxWalkDistance` (default `64`) membatasi perjalanan supaya tidak lari ke koordinat yang salah.
Perintah `farm` di console menampilkan ringkasan scan terakhir, lahan yang ditemukan, dan pesan errornya.