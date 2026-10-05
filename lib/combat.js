'use strict';

const { findPath } = require('./pathing');

// entity.type dari mineflayer juga dipakai untuk blok, item, panah, dan lain-lain.
// Semua itu tidak boleh dipukul walau namanya kebetulan mirip nama mob.
const NON_MOB_TYPES = new Set([
  'object', 'orb', 'projectile', 'player', 'global', 'other', 'unknown', 'lightning_bolt', 'firework_rocket'
]);

// Daftar cadangan untuk versi lama / server tanpa registry. Nama dinormalisasi
// (huruf kecil, tanpa garis bawah) supaya satu entri berlaku untuk semua versi.
const HOSTILE_MOBS = new Set([
  'zombie', 'zombie_villager', 'zombified_piglin', 'pigzombie', 'zombiepigman', 'husk', 'drowned', 'skeleton', 'stray',
  'wither_skeleton', 'spider', 'cave_spider', 'silverfish', 'creeper', 'enderman', 'endermite',
  'witch', 'slime', 'magma_cube', 'blaze', 'ghast', 'hoglin', 'lavaslime',
  'vex', 'vindicator', 'vindicationillager', 'evoker', 'evocationillager', 'illusioner', 'illusionillager',
  'pillager', 'ravager', 'shulker', 'phantom'
]);

// Tidak akan pernah jadi target tanpa whitelist eksplisit: sekutu, hewan, item,
// dan bos yang bisa mengorbankan nyawa.
const NEVER_TARGET = new Set([
  'warden', 'end_crystal', 'ender_dragon', 'wither', 'witherboss', 'giant',
  'item', 'item_stack', 'xp_orb', 'experience_orb', 'arrow', 'tnt', 'minecart', 'armor_stand', 'item_frame', 'painting',
  'villager', 'wandering_trader', 'horse', 'donkey', 'mule', 'llama', 'trader_llama', 'cat', 'wolf', 'parrot',
  'bat', 'rabbit', 'polar_bear', 'fox', 'bee', 'axolotl', 'goat', 'mooshroom', 'pig', 'sheep',
  'cow', 'chicken', 'allay', 'camel', 'sniffer', 'armadillo', 'skeleton_horse', 'zombie_horse',
  'snow_golem', 'iron_golem', 'strider', 'piglin', 'squid', 'glow_squid', 'glowsquid',
  'guardian', 'elder_guardian', 'cod', 'salmon', 'tropical_fish', 'pufferfish', 'tadpole',
  'dolphin', 'panda', 'ocelot', 'turtle', 'frog', 'leech'
]);

const WEAPON_TIERS = [
  { pattern: /^netherite_/, bonus: 40 },
  { pattern: /^diamond_/, bonus: 30 },
  { pattern: /^iron_/, bonus: 20 },
  { pattern: /^stone_/, bonus: 14 },
  { pattern: /^golden_|^gold_/, bonus: 10 },
  { pattern: /^wooden_|^wood_/, bonus: 6 }
];

const WEAPON_KINDS = [
  { suffix: '_sword', base: 100, label: 'pedang' },
  { suffix: '_axe', base: 80, label: 'kapak' },
  { suffix: '_pickaxe', base: 70, label: 'beliung' },
  { suffix: '_shovel', base: 60, label: 'sekop' },
  { suffix: '_hoe', base: 20, label: 'cangkul' }
];

const FIST_SCORE = 10;

// Jeda antarayunan (cooldown klik) saat mob sudah dalam jangkauan.
// 25 ms = 40 klik/detik, cukup cepat supaya terasa seperti mod auto clicker
// tanpa membuat process spinning 100% CPU. Pada bot sungguhan ayunan dipicu
// physics tick (20 tick/detik), jadi angka di atas 50 ms tetap yang berlaku.
const MIN_ATTACK_INTERVAL = 25;
const MAX_ATTACK_INTERVAL = 2000;
const DEFAULT_ATTACK_INTERVAL = 100;
const DEFAULT_SCAN_INTERVAL = 500;

// Jeda minimum sebelum equip dicoba ulang ketika tangan bot ternyata tidak
// berisi senjata yang baru saja dipegang (server menolak diam-diam).
const EQUIP_RETRY_MS = 1000;

// "Zombie Villager", "ZombieVillager", dan "zombie_villager" -> zombievillager.
// Di 1.8 nama mob huruf kapital, di versi baru memakai garis bawah, jadi tanpa
// normalisasi nama daftar di bawah tidak akan pernah cocok.
function normalizeName(name) {
  if (name === undefined || name === null) return '';
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const HOSTILE_NAMES = new Set([...HOSTILE_MOBS].map(normalizeName));
const NEVER_TARGET_NAMES = new Set([...NEVER_TARGET].map(normalizeName));

function entityKind(entity) {
  if (!entity) return null;
  if (typeof entity.name === 'string' && entity.name) return entity.name;
  const type = entity.entityType;
  if (typeof type === 'string' && type) return type;
  if (type && typeof type.name === 'string' && type.name) return type.name;
  return null;
}

function isPlayerEntity(entity) {
  if (!entity) return false;
  return entity.type === 'player' || typeof entity.username === 'string' || normalizeName(entity.name) === 'player';
}

// Registry mineflayer sudah menandai mob hostility: type "hostile" (1.18+) dan
// kind/category "Hostile mobs" (versi lama). Ini yang membuat mob versi baru
// atau mob dari plugin server tetap dikenali tanpa daftar manual.
function isDeclaredHostile(entity) {
  if (!entity) return false;
  if (entity.hostile === true || entity.type === 'hostile') return true;
  return /hostile/i.test(String(entity.kind || entity.category || ''));
}

function isHostile(entity, options = {}) {
  const kind = entityKind(entity);
  if (!kind) return false;
  if (entity.type && NON_MOB_TYPES.has(entity.type)) return false;
  if (entity.isValid === false) return false;
  if (typeof entity.health === 'number' && entity.health <= 0) return false;
  if (isPlayerEntity(entity)) return options.attackPlayers === true;

  const name = normalizeName(kind);
  if (!name) return false;
  if (Array.isArray(options.ignore) && options.ignore.some((entry) => normalizeName(entry) === name)) return false;

  // whitelist = pilihan eksplisit pemilik bot, jadi boleh menembus daftar hitam.
  if (Array.isArray(options.whitelist) && options.whitelist.length) {
    return options.whitelist.some((entry) => normalizeName(entry) === name);
  }
  if (NEVER_TARGET_NAMES.has(name)) return false;
  return HOSTILE_NAMES.has(name) || isDeclaredHostile(entity);
}

function distanceTo(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Jarak mendatar dipakai untuk decides "sudah dalam jangkauan": jarak 3D kaki
// ke kaki membuat mob yang berdiri 2 blok di atas terlihat sedekat 2 blok, lalu
// bot mengayun tanpa pernah benar-benar sampai.
function flatDistanceTo(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function eyeOf(bot) {
  const position = bot && bot.entity ? bot.entity.position : null;
  if (!position) return null;
  const eyeHeight = bot.entity.eyeHeight || 1.62;
  return position.offset(0, eyeHeight, 0);
}

// Titik tengah tubuh mob, tempat pedang harus menghantam.
function bodyCenter(entity) {
  if (!entity || !entity.position) return null;
  const height = typeof entity.height === 'number' && entity.height > 0 ? entity.height : 1.8;
  return entity.position.offset(0, height * 0.5, 0);
}

// Server hanya menerima pukulan jika arah pandang memotong hitbox. Arahkan
// ke badan mob, bukan ke kaki yang membuat bot tampak terus menunduk.
// 0,8 blok dari kaki: cukup rendah supaya crosshair tetap di dalam hitbox mob
// kecil (slime, tupai), cukup tinggi supaya tidak menusuk tanah. Nilai
// `aimHeight` dari config boleh mengaturnya, asal tidak keluar dari hitbox.
const DEFAULT_AIM_HEIGHT = 0.8;

function feetAimPoint(entity, options = {}) {
  if (!entity || !entity.position) return null;
  const raw = Number(options.aimHeight);
  const h = heightOf(entity);
  const wanted = Number.isFinite(raw) ? raw : DEFAULT_AIM_HEIGHT;
  const height = Math.max(0, Math.min(wanted, h - 0.1));
  return entity.position.offset(0, height, 0);
}

function heightOf(entity) {
  return entity && typeof entity.height === 'number' && entity.height > 0 ? entity.height : 1.8;
}

function toIdSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

function findNearestTarget(bot, options = {}) {
  const range = Number(options.range) || 12;
  const origin = bot && bot.entity ? bot.entity.position : null;
  if (!origin || !bot || !bot.entities) return null;
  const excluded = toIdSet(options.excludeIds);
  let best = null;
  for (const entity of Object.values(bot.entities)) {
    if (!entity || entity === bot.entity) continue;
    if (excluded.has(entity.id)) continue;
    if (!isHostile(entity, options)) continue;
    const distance = distanceTo(origin, entity.position);
    if (distance > range) continue;
    if (!best || distance < best.distance) {
      best = { entity, kind: entityKind(entity), distance };
    }
  }
  return best;
}

function weaponScore(name) {
  if (!name) return null;
  const kind = WEAPON_KINDS.find((entry) => name.endsWith(entry.suffix) || name === entry.suffix.replace(/^_/, ''));
  if (!kind) return null;
  const tier = WEAPON_TIERS.find((entry) => entry.pattern.test(name));
  return { score: kind.base + (tier ? tier.bonus : 0), label: kind.label, tier: tier ? tier.pattern.source : 'custom' };
}

function pickWeapon(bot, options = {}) {
  const empty = { item: null, score: FIST_SCORE, name: null, label: 'tangan kosong' };
  if (!bot || !bot.inventory || typeof bot.inventory.items !== 'function') return empty;
  const excluded = new Set(Array.isArray(options.ignore) ? options.ignore.map(String) : []);
  let best = null;
  for (const item of bot.inventory.items()) {
    if (!item || excluded.has(String(item.name))) continue;
    const scored = weaponScore(item.name);
    if (!scored) continue;
    if (!best || scored.score > best.score) {
      best = { item, score: scored.score, name: item.name, label: scored.label };
    }
  }
  return best || empty;
}

// Jeda antarayunan / cooldown klik (ms). Inilah yang menentukan kecepatan bot
// saat mengayun: pendek = auto clicker, panjang = ayunan pelan seperti human.
function attackInterval(settings = {}) {
  const raw = Number(settings.attackCooldownMs);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_ATTACK_INTERVAL;
  return clampInterval(raw);
}

function clampInterval(raw) {
  return Math.min(MAX_ATTACK_INTERVAL, Math.max(MIN_ATTACK_INTERVAL, raw));
}

// Mod auto clicker tidak mengklik dengan kecepatan tetap: click rate-nya diacak
// di antara batas bawah dan batas atas tiap klik. cpsMin/cpsMax meniru itu, jadi
// pola ayunan bot tidak terlihat persis mesin. Kosongkan (atau null) untuk
// kembali ke jeda tetap attackCooldownMs.
function cpsRange(settings = {}) {
  const rawMin = Number(settings.cpsMin);
  if (!Number.isFinite(rawMin) || rawMin <= 0) return null;
  const rawMax = Number(settings.cpsMax);
  const max = Number.isFinite(rawMax) && rawMax > 0 ? Math.max(rawMax, rawMin) : rawMin;
  return { min: rawMin, max };
}

// Jeda antarayunan yang sudah diacak (ms), dipakai sebagai cooldown klik:
// satu undian per klik, jadi pola ayunan tetapacak seperti mod auto clicker.
function clickInterval(settings = {}, random = Math.random) {
  const range = cpsRange(settings);
  if (!range) return attackInterval(settings);
  const slowest = clampInterval(1000 / range.min);
  const fastest = clampInterval(1000 / range.max);
  // random() yang dipakai, bukan random-nya: Number(fungsi) = NaN, jadi angka
  // acak selalu dianggap 0 dan hasilnya cuma jeda tercepat saja.
  const ratio = Number(random());
  const value = fastest + (slowest - fastest) * (Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0);
  return clampInterval(value);
}

// "10-14 CPS" atau "10 CPS" untuk log.
function cpsLabel(settings = {}) {
  const range = cpsRange(settings);
  if (!range) return `${Math.round(1000 / attackInterval(settings))} CPS`;
  const min = Math.round(1000 / clickInterval({ ...settings, cpsMin: range.min, cpsMax: range.min }));
  const max = Math.round(1000 / clickInterval({ ...settings, cpsMin: range.max, cpsMax: range.max }));
  return min === max ? `${min} CPS` : `${min}-${max} CPS`;
}

// Jeda scan mob: dipakai sebagai periode loop untuk mencari target /
// mendekati. Kecepatan ayunan tidak dari sini, tapi dari physics tick.
function scanInterval(settings = {}) {
  const raw = Number(settings.intervalMs);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SCAN_INTERVAL;
  return raw;
}

function shouldRetreat(bot, config = {}) {
  const threshold = Number(config.retreatBelowHealth) || 0;
  if (threshold <= 0) return false;
  const health = typeof bot.health === 'number' ? bot.health : (bot.entity && bot.entity.health);
  if (typeof health !== 'number') return false;
  return health <= threshold;
}

// HP 0 berarti bot sudah mati atau sedang respawn: jangan bergerak, jangan pukul.
function isIncapacitated(bot) {
  if (!bot || !bot.entity) return true;
  if (bot.entity.isValid === false) return true;
  const health = typeof bot.health === 'number' ? bot.health : bot.entity.health;
  return typeof health === 'number' && health <= 0;
}

// Jangkauan pedang di Minecraft memakai kotak di sekitar pemain, jadi jarak
// mendatar dan jarak vertikal sama-sama harus di dalam jangkauan. Mob 4 blok
// di atas kepala tidak bisa dipukul aunque jaraknya mendatar nol.
function withinReach(bot, entity, reach) {
  if (!bot || !bot.entity || !entity || !entity.position) return false;
  const flat = flatDistanceTo(bot.entity.position, entity.position);
  const center = bodyCenter(entity);
  const aim = eyeOf(bot);
  if (!center || !aim) return flat <= reach;
  const vertical = Math.abs(center.y - aim.y);
  if (vertical > reach) return false;
  const distance = distanceTo(aim, center);
  return distance <= reach || flat <= reach;
}

// context.holdId: target yang sedang dilawan tetap dikejar sampai mati atau
// keluar jangkauan, jadi bot tidak berpindah-pindah target tiap tick.
// context.excludeIds: target yang tadi gagal didekati tidak langsung dicoba lagi.
function planCombat(bot, options = {}, context = {}) {
  if (!bot || !bot.entity) return { action: 'wait', reason: 'bot belum spawn' };
  if (shouldRetreat(bot, options)) return { action: 'retreat', reason: 'darurat' };

  const excluded = toIdSet(context.excludeIds);
  const holdId = context.holdId;
  const range = (Number(options.range) || 12) * 1.25;
  let target = null;
  if (holdId !== undefined && holdId !== null && !excluded.has(holdId)) {
    const held = bot.entities[holdId];
    if (held && held !== bot.entity && isHostile(held, options)) {
      const distance = distanceTo(bot.entity.position, held.position);
      if (distance <= range) target = { entity: held, kind: entityKind(held), distance };
    }
  }
  if (!target) target = findNearestTarget(bot, { ...options, excludeIds: excluded });

  if (!target) return { action: 'idle', reason: 'tidak ada mob' };
  const reach = Number(options.attackRange) || 3;
  // approach=false: bot tidak pernah bergerak, jadi target dipukul dari posisi
  // bot sekarang — bahkan kalau belum masuk jangkauan. Ayunan yang masih di luar
  // jangkauan memang ditolak server, tapi begitu mob masuk jangkauan (mis. ia
  // sendiri mendekat) ayunan berikutnya langsung kena tanpa nunggu bot bergerak,
  // dan target tidak pernah masuk daftar yang dicoret karena "tidak bisa didekati".
  const inReach = withinReach(bot, target.entity, reach);
  if (options.approach === false) {
    return { action: 'attack', target, distance: target.distance, inReach, stand: true };
  }
  if (!inReach) {
    return { action: 'approach', target, distance: target.distance, inReach };
  }
  return { action: 'attack', target, distance: target.distance, inReach };
}

function attachCombat(bot, config, logger) {
  // Hormati pengaturan combat dari config/profil. Nilai default sudah
  // disediakan oleh config.js, sehingga approach dan attackRange tidak perlu
  // dipatok di sini.
  const settings = { ...(config.combat || {}) };
  const stats = {
    kills: 0,
    attacks: 0,
    targets: 0,
    approaches: 0,
    retreats: 0,
    stuck: 0,
    lastTarget: null,
    lastAttackAt: 0,
    weapon: null,
    // Rencana terakhir + jarak ke mob, buat diagnosa dari console/log.
    action: 'idle',
    distance: null,
    // Tinggi bidikan di atas kaki mob (0.1 = kaki).
    aimHeight: null
  };

  let started = false;
  let currentId = null;
  let lastAttackAt = 0;
  let equippedName = null;
  let equipPending = null;
  let equippedAt = 0;
  let loopTimer = null;
  let jumpTimer = null;
  let lastJumpAt = 0;
  let lastProgressAt = Date.now();
  let lastProgressPos = null;
  // Jarak terdekat ke target sejauh ini; hanya ini yang dihitung sebagai progres.
  let bestDistance = Infinity;
  let retreating = false;
  let approaching = false;
  // true selama bot sedang mengayun (target sudah dipilih): pemicu ayunan
  // dari physics tick.
  let swinging = false;
  // true sementara attack menunggu paket look tick ini keluar, supaya dua
  // physics tick beruntun tidak mengirim dua pukulan untuk rotasi yang sama.
  let aimPending = false;
  // Supaya log "mengayun ..." hanya sekali per target, bukan tiap tick.
  let announcedSwing = false;
  let loggedAttackTarget = null;
  const blacklist = new Map();

  const log = logger || { debug() {}, info() {}, warn() {}, success() {} };

  function safeControl(state, value) {
    try {
      bot.setControlState(state, value);
    } catch {
      /* bot sudah tertutup */
    }
  }

  function clearMovement() {
    try {
      bot.stop('forward');
      bot.stop('back');
      bot.stop('sprint');
      bot.setControlState('sneak', false);
    } catch {
      /* bot sudah tertutup */
    }
  }

  // Memindahkan item ke tangan butuh beberapa klik window ke server, jadi harus
  // dimulai begitu mob terlihat, bukan menunggu mob sampai dalam jangkauan.
  // Kalau ditunggu, semua ayunan pertama sampai dengan tangan kosong.
  function equipRetryMs() {
    const raw = Number(settings.equipRetryMs);
    if (!Number.isFinite(raw) || raw < 0) return EQUIP_RETRY_MS;
    return Math.min(EQUIP_RETRY_MS, raw);
  }

  function chooseWeapon() {
    const weapon = pickWeapon(bot, settings);
    if (!weapon.item) {
      equippedName = null;
      equipPending = null;
      stats.weapon = null;
      return null;
    }
    // Equip yang sama tidak boleh ditumpuki (dua rangkaian klik window
    // beruntun = inventory kacau), jadi yang masih jalan dilewati.
    if (weapon.name === equipPending) return null;

    // Acuan yang benar isi tangan bot sekarang, bukan nama yang kita kira
    // sudah dipegang: server yang menolak equip tanpa error akan membuat bot
    // memakai tangan kosong selamanya kalau catatan lokal tidak pernah dicek
    // ulang. heldItem undefined = tidak bisa diketahui, jadi catatan dipakai.
    const heldItem = bot.heldItem;
    const held = heldItem && heldItem.name ? String(heldItem.name) : '';
    const settled = weapon.name === equippedName;
    if (heldItem !== undefined && held === weapon.name) {
      if (!settled) log.info(`sudah memegang ${weapon.label} ${weapon.name}`);
      equippedName = weapon.name;
      equippedAt = Date.now();
      stats.weapon = weapon.name;
      return weapon.name;
    }
    if (settled && (heldItem === undefined || Date.now() - equippedAt < equipRetryMs())) return null;
    if (settled) {
      log.debug(`tangan masih ${held || 'kosong'}, coba pegang ${weapon.name} lagi`);
    }

    equipPending = weapon.name;
    const settle = (name) => {
      equipPending = null;
      equippedName = name;
      equippedAt = Date.now();
      stats.weapon = name;
      log.info(`pegang ${weapon.label} ${name} untuk fight`);
    };
    try {
      const pending = bot.equip(weapon.item, 'hand');
      if (!pending || typeof pending.then !== 'function') {
        settle(weapon.name);
        return weapon.name;
      }
      Promise.resolve(pending)
        .then(() => settle(weapon.name))
        .catch((err) => {
          equipPending = null;
          equippedName = null;
          log.debug(`gagal pegang senjata: ${err.message}`);
        });
    } catch (err) {
      equipPending = null;
      equippedName = null;
      log.debug(`gagal pegang senjata: ${err.message}`);
    }
    return null;
  }

  function forgetTarget() {
    if (currentId === null) return;
    currentId = null;
    swinging = false;
    lastProgressPos = null;
    bestDistance = Infinity;
    clearMovement();
  }

  function blacklistTarget(id, kind, reason) {
    const ms = Number(settings.giveUpMs) || 15000;
    blacklist.set(id, Date.now() + ms);
    stats.stuck += 1;
    const detail = reason ? ` (${reason})` : '';
    log.warn(`tidak bisa mendekati ${kind || '?'} (#${id})${detail}, dilewati ${Math.round(ms / 1000)} detik`);
  }

  function activeBlacklist() {
    const now = Date.now();
    const alive = new Set();
    for (const [id, until] of blacklist) {
      if (until > now) alive.add(id);
      else blacklist.delete(id);
    }
    return alive;
  }

  function onEntityDead(entity) {
    // Hanya target yang sedang dilawan yang dihitung sebagai knock, supaya
    // mob yang dibunuh creeper atau player lain tidak ikut terhitung.
    if (currentId === null) return;
    if (entity && entity.id !== undefined && entity.id !== currentId) return;
    stats.kills += 1;
    stats.lastTarget = entityKind(entity);
    stats.action = 'idle';
    stats.distance = null;
    log.success(`mob knock: ${entityKind(entity) || '?'} (total ${stats.kills})`);
    forgetTarget();
  }

  function onEntityGone(entity) {
    if (currentId !== null && entity && entity.id === currentId) forgetTarget();
  }

  function onDeath() {
    forgetTarget();
    stats.lastTarget = null;
    stats.weapon = null;
    equippedName = null;
    equippedAt = 0;
  }

  function onRespawn() {
    currentId = null;
    swinging = false;
    lastProgressPos = null;
    bestDistance = Infinity;
    equippedName = null;
    equipPending = null;
    equippedAt = 0;
    lastAttackAt = 0;
    // Respawn mengosongkan tangan, jadi statistik senjata juga harus diulang.
    stats.weapon = null;
  }

  function jumpOnce() {
    const now = Date.now();
    if (now - lastJumpAt < 1000) return;
    lastJumpAt = now;
    if (jumpTimer) clearTimeout(jumpTimer);
    safeControl('jump', true);
    jumpTimer = setTimeout(() => {
      jumpTimer = null;
      safeControl('jump', false);
    }, 250);
    if (jumpTimer.unref) jumpTimer.unref();
  }

  // Mob di balik tembok atau di atas kolom tinggi membuat bot berjalan ke sana
  // selamanya tanpa pernah mengayun. Kalau tidak ada progres: coba lompat dulu,
  // lalu menyerah pada target itu supaya tidak membeku.
  //
  // "Progres" diukur dari jarak ke mob, bukan dari gerak bot. Bot yang mondar-
  // mondar (tarik-ulur fitur lain, mentok di tepi, berputar) tetap bergerak
  // plenty tapi tidak pernah mendekat, jadi kalau progres dihitung dari movement,
  // timeout tidak pernah kepicu dan bot hanya diam di tempat.
  function chaseIfStuck(entity, kind) {
    const position = bot.entity.position;
    const distance = flatDistanceTo(position, entity.position);
    if (!lastProgressPos) {
      lastProgressPos = position.clone();
      lastProgressAt = Date.now();
      bestDistance = distance;
      return;
    }
    // Jarak yang benar-benar mengecil = maju. Selain itu apa pun (belok,
    // mundur, terpental) bukan progres.
    if (distance < bestDistance - 0.1) {
      bestDistance = distance;
      lastProgressAt = Date.now();
    }
    lastProgressPos = position.clone();

    const idleMs = Date.now() - lastProgressAt;
    const stuckMs = Math.max(600, Number(settings.stuckTimeoutMs) || 3000);
    if (idleMs < 600) return;

    // Mob lebih tinggi artinya ada jurang/tembok yang tidak bisa dilalui jalan
    // lurus, jadi lompat lebih awal lalu menyerah, bukan bergetar di tempat.
    const higher = entity.position.y > bot.entity.position.y + 0.6;
    if (settings.jumpWhenBlocked !== false && (higher || idleMs >= stuckMs / 3)) jumpOnce();
    if (idleMs < stuckMs) return;

    blacklistTarget(
      entity.id,
      kind,
      `jarak macet di ${bestDistance.toFixed(1)} blok${higher ? ', mob lebih tinggi dari bot' : ''}`
    );
    lastProgressAt = Date.now();
    lastProgressPos = null;
    bestDistance = Infinity;
    forgetTarget();
  }

  function tick(clickGap) {
    if (!started || !bot.entity) {
      swinging = false;
      return;
    }
    // Bot mati/loading: jangan biarkan loop tetap berputar pada jeda ayunan.
    if (isIncapacitated(bot)) {
      swinging = false;
      return;
    }

    const excluded = activeBlacklist();
    const holdId = excluded.has(currentId) ? null : currentId;
    const plan = planCombat(bot, settings, { holdId, excludeIds: excluded });

    if (plan.action === 'retreat') {
      if (!retreating) {
        retreating = true;
        stats.retreats += 1;
        equippedName = null;
        equippedAt = 0;
        swinging = false;
        stats.action = 'retreat';
        // Target yang sedang dilawan ikut disebut supaya jelas retreat-nya
        // karena apa, bukan sekadar "HP rendah".
        const held = findNearestTarget(bot, { ...settings, excludeIds: excluded });
        const detail = held ? `, target ${held.kind} jarak ${Number(held.distance.toFixed(1))}` : '';
        log.warn(`HP rendah (hp=${bot.health}), berhenti menyerang dan mundur sampai HP pulih${detail}`);
      }
      // Hadap mob, lalu jalan mundur supaya HP sempat regen.
      const target = findNearestTarget(bot, { ...settings, excludeIds: excluded });
      if (target) {
        void bot.lookAt(bodyCenter(target.entity) || target.entity.position, true);
      }
      clearMovement();
      safeControl('back', true);
      return;
    }
    if (retreating) {
      retreating = false;
      safeControl('back', false);
    }

    if (plan.action !== 'approach' && plan.action !== 'attack') {
      approaching = false;
      swinging = false;
      stats.action = plan.action;
      stats.distance = plan.target ? Number(plan.distance.toFixed(1)) : null;
      stats.lastTarget = null;
      forgetTarget();
      return;
    }

    const { entity } = plan.target;
    swinging = plan.action === 'attack';
    // Rencana dan jaraknya disimpan supaya `!attack` bisa.show apa yang bot
    // lakukan: "dekati" yang tidak pernah selesai jauh lebih gampang
    // diagnosable daripada "tidak ada inflicted damage".
    stats.action = plan.action;
    stats.distance = Number(plan.target.distance.toFixed(1));
    if (entity.id !== currentId) {
      currentId = entity.id;
      stats.targets += 1;
      announcedSwing = false;
      loggedAttackTarget = null;
      const mode = plan.stand
        ? 'pukul dari tempat, tidak mendekat'
        : plan.action === 'attack'
          ? 'sudah di jangkauan'
          : `dekati, adult ${settings.attackRange || 3} blok`;
      log.info(`target baru: ${plan.target.kind} pada jarak ${plan.target.distance.toFixed(1)} (${mode})`);
    }

    // Perbarui status tangan sebelum menulis log target. Sebelumnya log
    // "mengayun" memakai equippedName lama, sehingga bisa salah menyebut
    // tangan kosong walau bot sudah memegang senjata.
    chooseWeapon();
    const justStartedSwinging = swinging && !announcedSwing;
    if (justStartedSwinging) {
      announcedSwing = true;
      const heldName = bot.heldItem && bot.heldItem.name;
      log.info(
        `mengayun ${plan.target.kind} #${entity.id} jarak ${stats.distance} ` +
        `senjata=${heldName || equippedName || 'tangan kosong'}` +
        `${plan.stand && plan.inReach === false ? ' (belum jangkauan, tunggu mob mendekat)' : ''}`
      );
      approaching = false;
      bot.stop('forward');
      bot.stop('sprint');
    }

    // Bidikan diarahkan ke badan mob, bukan kaki terjauh: server hanya
    // menerima pukulan kalau arah pandang memotong hitbox.
    const aim = feetAimPoint(entity, settings) || bodyCenter(entity) || entity.position;

    if (plan.action === 'approach') {
      // Cari jalur mengitari blok agar bot tidak terus berjalan lurus
      // menabrak dinding. Jika jalur gagal dihitung, tetap coba arah target.
      let route = null;
      let movementAim = aim;
      if (typeof bot.blockAt === 'function') {
        try {
          route = findPath(bot, bot.entity.position, entity.position, {
            radius: settings.pathRadius || 12,
            reach: Math.max(1.5, (Number(settings.attackRange) || 3) - 0.35),
            jump: settings.jumpWhenBlocked !== false,
            maxNodes: 2500
          });
          if (route && route.length) movementAim = route[0];
        } catch (err) {
          log.debug(`gagal mencari jalur ke ${plan.target.kind}: ${err.message}`);
        }
      }
      // Navigasi boleh memakai waypoint di dekat kaki, tetapi pitch tetap
      // diarahkan ke badan target agar bot tidak terus melihat tanah saat mengejar.
      const dx = movementAim.x - bot.entity.position.x;
      const dz = movementAim.z - bot.entity.position.z;
      const aimDx = aim.x - bot.entity.position.x;
      const aimDy = aim.y - (bot.entity.position.y + (bot.entity.eyeHeight || 1.62));
      const aimDz = aim.z - bot.entity.position.z;
      const yaw = Math.atan2(-dx, -dz);
      // Mineflayer memakai pitch negatif untuk melihat ke bawah dan positif
      // untuk melihat ke atas (sama seperti rumus internal lookAt).
      const pitch = Math.atan2(aimDy, Math.hypot(aimDx, aimDz));
      void bot.look(yaw, pitch, true);
      if (!approaching) {
        approaching = true;
        stats.approaches += 1;
      }
      stats.lastTarget = `${plan.target.kind} (dekati)`;
      if (route && route.length && route[0].y > bot.entity.position.y + 0.3) jumpOnce();
      bot.setControlState('forward', true);
      bot.setControlState('sprint', plan.target.distance > (Number(settings.attackRange) || 3) * 2);
      chaseIfStuck(entity, plan.target.kind);
      return;
    }

    approaching = false;
    bot.stop('forward');
    bot.stop('sprint');
    // Ayunan pertama langsung dikirim begitu target terkunci, jadi bot tidak
    // diam di depan mob yang sudah di jangkauan. Ayunan berikutnya tetap datang
    // dari physics tick (lihat onPhysicsTick) supaya rotasi selalu didahului
    // paket yang sudah diterima server.
    //
    // Pengecualiannya mode diam (approach=false) dengan mob yang justru sudah
    // di jangkauan: bot tidak bergerak sama sekali di mode itu, jadi ayunan
    // pertama cukup dititipkan ke physics tick yang rotasinya sudah keluar.
    // Ayunan berikutnya tetap langsung jalan supaya tempo ayunan tidak ikut
    // melambat.
    if (plan.stand && plan.inReach === true && justStartedSwinging) {
      aimAt(entity);
      return;
    }
    dispatchAttack(entity, aimAt(entity), clickGap);
  }

  // Arahkan kepala ke badan target. Rotasi baru sampai ke server lewat paket
  // look pada physics tick, jadi attack tidak boleh dikirim sebelum paket itu
  // keluar: kalau duluan, server masih memakai arah pandang yang lama dan
  // pukulan ditolak (animasi mengayun tapi damage 0).
  function aimAt(entity) {
    const aim = feetAimPoint(entity, settings) || bodyCenter(entity) || entity.position;
    try {
      void bot.lookAt(aim, true);
    } catch {
      /* bot sudah tertutup */
    }
    return aim;
  }

  // Jeda sebelum attack berikutnya. Kalau pemicunya physics tick, jeda diundi
  // di sini supaya pola acak cpsMin/cpsMax tetap satu undian per klik.
  function swingCooldown(gap) {
    if (Number.isFinite(gap) && gap > 0) return gap;
    if (cpsRange(settings)) return clickInterval(settings);
    return Math.max(0, Number(settings.attackCooldownMs) || 0);
  }

  function dispatchAttack(entity, aim, gap) {
    if (!started || currentId === null || entity.id !== currentId) return;
    if (isIncapacitated(bot)) return;
    const now = Date.now();
    if (now - lastAttackAt < swingCooldown(gap)) return;
    const botName = bot.username || 'bot';
    const targetName = entity.name || entityKind(entity) || 'target';
    const firstAttackOnTarget = loggedAttackTarget !== entity.id;
    const beforeAttack = `[${botName}] ATTACK -> ${targetName} (#${entity.id})`;
    if (firstAttackOnTarget) log.info(beforeAttack);
    else log.debug(beforeAttack);
    try {
      // Gunakan jalur Mineflayer standar: attack() mengirim packet serang
      // beserta ayunan tangan.
      bot.attack(entity);
      if (firstAttackOnTarget) {
        loggedAttackTarget = entity.id;
        log.info(`[${botName}] attack() dipanggil`);
      } else {
        log.debug(`[${botName}] attack() dipanggil`);
      }
    } catch (err) {
      log.warn(`[${botName}] attack error: ${err && err.stack ? err.stack : err}`);
      return;
    }
    lastAttackAt = now;
    stats.attacks += 1;
    stats.lastAttackAt = now;
    stats.lastTarget = entityKind(entity);
    stats.aimHeight = Number((aim.y - entity.position.y).toFixed(2));
  }

  // Ayunan dijalankan dari physics tick, bukan dari timer biasa: paket look
  // untuk arah pandang yang baru diarahkan dikirim di akhir tick tersebut, jadi
  // attack yang menyusul di tick berikutnya memakai rotasi yang sudah diterima
  // server. Kalau attack dikirim dari timer, rotasi yang dipakai server masih
  // yang dari tick sebelumnya (selisih satu tick) dan pukulan sering meleset.
  // setImmediate dipakai supaya paket look tick ini keluar lebih dulu.
  function onPhysicsTick() {
    if (!started || !swinging || aimPending) return;
    const entity = currentId === null ? null : bot.entities[currentId];
    if (!entity || entity === bot.entity || !entity.position) return;
    if (!isHostile(entity, settings)) return;
    const aim = aimAt(entity);
    aimPending = true;
    setImmediate(() => {
      aimPending = false;
      if (!started || !swinging) return;
      dispatchAttack(entity, aim, 0);
    });
  }

  async function loop() {
    if (!started) return;
    // Jeda klik diundi sekali per siklus lalu dipakai sebagai cooldown di tick.
    // Diundi terpisah-sendiri, jeda efektif jadi penjumlahan dua undian dan
    // CPS asli tidak pernah tercapai.
    const gap = swinging ? clickInterval(settings) : 0;
    try {
      tick(gap);
    } catch (err) {
      log.debug(`tick combat gagal: ${err.message}`);
    }
    // Periode loop tetap jeda scan: yang menentukan kecepatan ayunan bukan
    // timer ini tapi physics tick (lihat onPhysicsTick), jadi setiap ayunan
    // selalu menyusul rotasi yang baru dikirim dan tidak bisa mendahului
    // rotasi hanya karena timer cepat.
    loopTimer = setTimeout(loop, scanInterval(settings));
    if (loopTimer.unref) loopTimer.unref();
  }

  function start(force) {
    if (started) return;
    if (!settings.enabled && !force) return;
    started = true;
    swinging = false;
    safeControl('sneak', false);
    bot.on('entityDead', onEntityDead);
    bot.on('entityGone', onEntityGone);
    bot.on('death', onDeath);
    bot.on('spawn', onRespawn);
    bot.on('physicsTick', onPhysicsTick);
    loop();
    log.info(
      `auto-combat aktif [attack-dispatch=aim-confirmed, target-lock=on] (cari mob sampai ${settings.range || 12} blok, ` +
      `${settings.approach === false ? 'pukul dari tempat tanpa mendekat' : `pukul sampai ${settings.attackRange || 3} blok`}, ` +
      `${cpsLabel(settings)}` +
      `${cpsRange(settings) ? ' acak' : ''})`
    );
  }

  function stop() {
    started = false;
    currentId = null;
    approaching = false;
    retreating = false;
    swinging = false;
    aimPending = false;
    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = null;
    }
    if (jumpTimer) {
      clearTimeout(jumpTimer);
      jumpTimer = null;
    }
    // lepas semua listener, kalau tidak tiap start() menambah knock dobel
    try {
      bot.removeListener('entityDead', onEntityDead);
      bot.removeListener('entityGone', onEntityGone);
      bot.removeListener('death', onDeath);
      bot.removeListener('spawn', onRespawn);
      bot.removeListener('physicsTick', onPhysicsTick);
    } catch {
      /* bot sudah tertutup */
    }
    equippedName = null;
    equipPending = null;
    equippedAt = 0;
    lastAttackAt = 0;
    lastProgressPos = null;
    bestDistance = Infinity;
    blacklist.clear();
    clearMovement();
  }

  function setEnabled(value) {
    if (value) start(true);
    else stop();
  }

  return {
    stats,
    start,
    stop,
    tick,
    setEnabled,
    get enabled() { return started; },
    get fighting() { return started && currentId !== null; },
    get targetId() { return currentId; },
    get weapon() {
      const held = bot.heldItem && bot.heldItem.name;
      return held ? String(held) : equippedName;
    },
    get interval() { return swinging ? clickInterval(settings) : scanInterval(settings); },
    get blacklisted() { return [...blacklist.keys()]; }
  };
}

module.exports = {
  attachCombat,
  findNearestTarget,
  isHostile,
  pickWeapon,
  weaponScore,
  planCombat,
  shouldRetreat,
  entityKind,
  normalizeName,
  distanceTo,
  flatDistanceTo,
  withinReach,
  bodyCenter,
  feetAimPoint,
  isIncapacitated,
  attackInterval,
  clickInterval,
  cpsRange,
  cpsLabel,
  scanInterval,
MIN_ATTACK_INTERVAL,
  MAX_ATTACK_INTERVAL,
  HOSTILE_MOBS,
  NEVER_TARGET
};
