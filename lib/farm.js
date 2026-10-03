'use strict';

const { Vec3 } = require('vec3');
const { isFreeSpace, isSolidGround } = require('./behaviors');
const { findPath, cellBlockedBy } = require('./pathing');

const CROP_BLOCKS = new Set(['carrots', 'wheat', 'potatoes', 'beetroots', 'nether_wart', 'cocoa', 'sweet_berry_bush']);

const SOIL_BLOCKS = new Set(['farmland', 'dirt', 'coarse_dirt', 'rooted_dirt', 'soul_sand']);

// Nama tanaman bisa ditulis sebagai nama blok (carrots) atau nama item (carrot).
// Semua alias dipetakan ke nama blok supaya config tidak harus ingat mana yang mana.
const CROP_ALIASES = {
  carrots: ['carrots', 'carrot'],
  carrot: ['carrots', 'carrot'],
  wheat: ['wheat', 'wheat_seeds', 'seeds'],
  wheat_seeds: ['wheat', 'wheat_seeds', 'seeds'],
  seeds: ['wheat', 'wheat_seeds', 'seeds'],
  potatoes: ['potatoes', 'potato'],
  potato: ['potatoes', 'potato'],
  beetroots: ['beetroots', 'beetroot', 'beetroot_seeds'],
  beetroot: ['beetroots', 'beetroot', 'beetroot_seeds'],
  beetroot_seeds: ['beetroots', 'beetroot', 'beetroot_seeds'],
  nether_wart: ['nether_wart'],
  cocoa: ['cocoa'],
  sweet_berry_bush: ['sweet_berry_bush', 'sweet_berries'],
  sweet_berries: ['sweet_berry_bush', 'sweet_berries']
};

const DEFAULT_CROPS = ['carrots', 'wheat', 'potatoes'];

// Nama tanaman ("carrot", "wheat") - dipakai untuk statistik dan filter.
const CROP_ITEM = {
  carrots: 'carrot',
  wheat: 'wheat',
  potatoes: 'potato',
  beetroots: 'beetroot',
  nether_wart: 'nether_wart',
  cocoa: 'cocoa',
  sweet_berry_bush: 'sweet_berries'
};

// Item yang dipakai untuk tanam ulang.
const SEED_ITEM = {
  carrot: 'carrot',
  wheat: 'wheat_seeds',
  potato: 'potato',
  beetroot: 'beetroot_seeds',
  nether_wart: 'nether_wart',
  cocoa: 'cocoa',
  sweet_berries: 'sweet_berries'
};

const HOE_TIERS = [
  { prefix: 'netherite_', bonus: 40 },
  { prefix: 'diamond_', bonus: 30 },
  { prefix: 'iron_', bonus: 20 },
  { prefix: 'stone_', bonus: 14 },
  { prefix: 'golden_', bonus: 10 },
  { prefix: 'wooden_', bonus: 6 }
];

function cropName(blockName) {
  if (!blockName) return null;
  return CROP_ITEM[blockName] || blockName;
}

function isCropBlock(name) {
  return CROP_BLOCKS.has(name);
}

function isSoil(name) {
  return SOIL_BLOCKS.has(name);
}

function normalizeCrops(crops) {
  const list = Array.isArray(crops) && crops.length ? crops : DEFAULT_CROPS;
  const names = new Set();
  for (const entry of list) {
    const key = String(entry).toLowerCase();
    const alias = CROP_ALIASES[key];
    if (alias) alias.forEach((name) => names.add(name));
    else names.add(key);
  }
  return names;
}

// Kotak lahan bisa jauh lebih lebar dari radius maksimum 32, jadi scan memakai
// min/max, bukan lingkaran.
const MAX_AREA_SPAN = 256;

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampSpan(lo, hi, max) {
  if (hi - lo <= max) return [lo, hi];
  const start = Math.floor((lo + hi) / 2) - Math.floor(max / 2);
  return [start, start + max];
}

function normalizeBounds(minX, minZ, maxX, maxZ, radius) {
  let loX = Math.floor(Math.min(minX, maxX));
  let hiX = Math.floor(Math.max(minX, maxX));
  let loZ = Math.floor(Math.min(minZ, maxZ));
  let hiZ = Math.floor(Math.max(minZ, maxZ));
  // satu titik doang -> treat sebagai titik tengah dengan radius
  if (loX === hiX && loZ === hiZ) {
    const r = Math.min(32, Math.max(1, Math.floor(Number(radius) || 1)));
    loX -= r;
    hiX += r;
    loZ -= r;
    hiZ += r;
  }
  [loX, hiX] = clampSpan(loX, hiX, MAX_AREA_SPAN);
  [loZ, hiZ] = clampSpan(loZ, hiZ, MAX_AREA_SPAN);
  return { minX: loX, maxX: hiX, minZ: loZ, maxZ: hiZ };
}

// Batas area bisa diisi beberapa bentuk:
//   "bounds": { "minX": .., "minZ": .., "maxX": .., "maxZ": .. }
//   "bounds": { "min": { "x": .., "z": .. }, "max": { "x": .., "z": .. } }
//   "corners": [[x, y, z], [x, y, z], ...] -> min..max semua titik
function resolveBounds(area = {}) {
  if (area.box === true && [area.minX, area.maxX, area.minZ, area.maxZ].every((value) => Number.isFinite(value))) {
    return normalizeBounds(area.minX, area.minZ, area.maxX, area.maxZ);
  }
  const bounds = area.bounds;
  if (bounds && typeof bounds === 'object' && !Array.isArray(bounds)) {
    const lo = bounds.min && typeof bounds.min === 'object' ? bounds.min : bounds;
    const hi = bounds.max && typeof bounds.max === 'object' ? bounds.max : bounds;
    const minX = toNumber(lo.minX ?? lo.x);
    const maxX = toNumber(hi.maxX ?? hi.x);
    const minZ = toNumber(lo.minZ ?? lo.z);
    const maxZ = toNumber(hi.maxZ ?? hi.z);
    if ([minX, maxX, minZ, maxZ].every((value) => value !== null)) {
      return normalizeBounds(minX, minZ, maxX, maxZ, bounds.radius ?? area.radius);
    }
  }
  const corners = Array.isArray(area.corners) ? area.corners : null;
  if (corners && corners.length >= 2) {
    const xs = [];
    const zs = [];
    for (const corner of corners) {
      if (Array.isArray(corner)) {
        xs.push(Number(corner[0]));
        zs.push(Number(corner[2]));
      } else if (corner && typeof corner === 'object') {
        xs.push(Number(corner.x));
        zs.push(Number(corner.z));
      }
    }
    if (xs.length >= 2 && zs.every((value) => Number.isFinite(value))) {
      return normalizeBounds(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
    }
  }
  return null;
}

function resolveArea(config = {}) {
  const area = config.area || {};
  const y = toNumber(area.y ?? config.y);
  const bounds = resolveBounds(area);
  if (bounds) {
    if (y === null) return null;
    const { minX, maxX, minZ, maxZ } = bounds;
    return {
      x: Math.floor((minX + maxX) / 2),
      y: Math.floor(y),
      z: Math.floor((minZ + maxZ) / 2),
      radius: Math.ceil(Math.max(maxX - minX, maxZ - minZ) / 2),
      minX,
      maxX,
      minZ,
      maxZ,
      box: true
    };
  }
  const x = toNumber(area.x ?? config.x);
  const z = toNumber(area.z ?? config.z);
  if (x === null || y === null || z === null) return null;
  const radius = Math.min(32, Math.max(1, Number(area.radius ?? config.radius) || 8));
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  return {
    x: cx,
    y: Math.floor(y),
    z: cz,
    radius,
    minX: cx - radius,
    maxX: cx + radius,
    minZ: cz - radius,
    maxZ: cz + radius,
    box: false
  };
}

// Area 0,0,0 hampir pasti bukan lahan farming -> anggap belum diisi.
function isAreaConfigured(area) {
  if (!area) return false;
  if (area.box === true) return true;
  return !(area.x === 0 && area.z === 0);
}

// Ringkasan area untuk log/console: kotak digambar dengan batas min..max.
function describeArea(area) {
  if (!area) return '-';
  if (area.box) {
    return `(${area.x}, ${area.y}, ${area.z}) kotak X ${area.minX}..${area.maxX} Z ${area.minZ}..${area.maxZ} (${area.maxX - area.minX + 1}x${area.maxZ - area.minZ + 1} blok)`;
  }
  return `(${area.x}, ${area.y}, ${area.z}) radius ${area.radius}`;
}

function walkRadiusOf(settings = {}) {
  return settings.walkToRadius === undefined || settings.walkToRadius === null
    ? 24
    : Math.max(0, Number(settings.walkToRadius) || 0);
}

// Pengaman: jangan pernah jalan terlalu jauh, koordinat yang salah = perjalanan sia-sia.
function maxWalkDistanceOf(settings = {}) {
  return settings.maxWalkDistance === undefined || settings.maxWalkDistance === null
    ? 64
    : Math.max(0, Number(settings.maxWalkDistance) || 0);
}

// 0 (default) = tanpa batas: kejar tanaman sampai ketemu atau benar-benar macet.
function cropWalkStepsOf(settings = {}) {
  const value = Number(settings.cropWalkSteps);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// 0 (default) = tanpa batas. Diisi hanya kalau memang mau membatasi kejaran.
function chaseRangeOf(settings = {}) {
  const value = Number(settings.chaseRange);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Radius penyusunan rute memutar saat jalur terhalang.
function pathRadiusOf(settings = {}) {
  const value = Number(settings.pathRadius);
  return Number.isFinite(value) && value > 0 ? Math.min(48, value) : 24;
}

function distanceToArea(bot, area) {
  if (!bot || !bot.entity || !area) return Infinity;
  const position = bot.entity.position;
  // Kotak: jarak ke titik terdekat di dalam kotak, jadi 0 kalau bot sudah
  // berdiri di lahan (kotak bisa hundreds blok, jarak ke tengah tidak lagi
  // berguna).
  if (area.box && [area.minX, area.maxX, area.minZ, area.maxZ].every((value) => Number.isFinite(value))) {
    const x = position.x - 0.5;
    const z = position.z - 0.5;
    const dx = x < area.minX ? area.minX - x : (x > area.maxX ? x - area.maxX : 0);
    const dz = z < area.minZ ? area.minZ - z : (z > area.maxZ ? z - area.maxZ : 0);
    return Math.hypot(dx, dz);
  }
  return Math.hypot(
    position.x - (area.x + 0.5),
    position.z - (area.z + 0.5)
  );
}

// Titik paling dekat di dalam area, dipakai sebagai tujuan jalan.
function areaTarget(area, from) {
  if (!area) return null;
  if (area.box && from) {
    const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
    return new Vec3(
      clamp(from.x - 0.5, area.minX, area.maxX) + 0.5,
      area.y,
      clamp(from.z - 0.5, area.minZ, area.maxZ) + 0.5
    );
  }
  return new Vec3(area.x + 0.5, area.y, area.z + 0.5);
}

function scanFarmArea(bot, config = {}) {
  const area = resolveArea(config);
  if (!area || !bot || typeof bot.blockAt !== 'function') return [];
  const crops = normalizeCrops(config.crops);
  const height = Math.min(6, Math.max(1, Number(config.scanHeight) || 2));
  const origin = bot.entity ? bot.entity.position : new Vec3(area.x, area.y, area.z);
  const found = [];
  for (let x = area.minX; x <= area.maxX; x += 1) {
    for (let z = area.minZ; z <= area.maxZ; z += 1) {
      for (let dy = -height; dy <= height; dy += 1) {
        const y = area.y + dy;
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block || !block.name || !crops.has(block.name)) continue;
        const below = bot.blockAt(new Vec3(x, y - 1, z));
        if (!below || !isSoil(below.name)) continue;
        const position = new Vec3(x + 0.5, y, z + 0.5);
        found.push({
          block,
          position,
          crop: cropName(block.name),
          soil: below.name,
          distance: Math.hypot(origin.x - position.x, origin.y - position.y, origin.z - position.z)
        });
      }
    }
  }
  return found.sort((a, b) => a.distance - b.distance);
}

// Radius pencarian otomatis di sekitar posisi bot.
function searchRadiusOf(settings = {}) {
  return Math.min(64, Math.max(0, Number(settings.searchRadius ?? 32) || 0));
}

function searchIntervalOf(settings = {}) {
  return Math.max(5000, Number(settings.searchIntervalMs ?? 30000) || 30000);
}

function ringLabel(ring) {
  return ring <= 1 ? 'tepat di dekat bot' : `${ring} blok dari bot`;
}

// Cari lahan terdekat di sekitar bot: cincin demi cincin, berhenti di cincin pertama yang berisi tanaman.
function searchFarmArea(bot, config = {}, origin = null) {
  if (!bot || typeof bot.blockAt !== 'function') return null;
  const crops = normalizeCrops(config.crops);
  const height = Math.min(6, Math.max(1, Number(config.scanHeight) || 2));
  const max = searchRadiusOf(config);
  const base = origin || (bot.entity ? bot.entity.position : null);
  if (!base || !crops.size || max <= 0) return null;
  const cx = Math.floor(base.x);
  const cy = Math.floor(base.y);
  const cz = Math.floor(base.z);

  let found = [];
  let firstRing = 0;
  let misses = 0;
  for (let ring = 1; ring <= max; ring += 1) {
    const fresh = [];
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        // hanya cincin terluar yang baru, bagian dalam sudah dicek di ring sebelumnya
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        for (let dy = -height; dy <= height; dy += 1) {
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          const block = bot.blockAt(new Vec3(x, y, z));
          if (!block || !block.name || !crops.has(block.name)) continue;
          const below = bot.blockAt(new Vec3(x, y - 1, z));
          if (!below || !isSoil(below.name)) continue;
          const position = new Vec3(x + 0.5, y, z + 0.5);
          fresh.push({
            block,
            position,
            crop: cropName(block.name),
            soil: below.name,
            distance: Math.hypot(base.x - position.x, base.y - position.y, base.z - position.z)
          });
        }
      }
    }
    if (fresh.length) {
      if (!firstRing) firstRing = ring;
      found = found.concat(fresh);
      misses = 0;
    } else {
      misses += 1;
      // dua cincin kosong berturut-turut = lahan ini sudah habis, berhenti SEARCH
      if (found.length && misses >= 2) break;
    }
  }

  if (!found.length) return null;
  const xs = found.map((entry) => entry.position.x);
  const ys = found.map((entry) => entry.position.y);
  const zs = found.map((entry) => entry.position.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const area = {
    x: Math.floor((minX + maxX) / 2),
    y: Math.round(ys.reduce((sum, value) => sum + value, 0) / ys.length),
    z: Math.floor((minZ + maxZ) / 2),
    radius: Math.min(32, Math.max(1, Math.ceil(Math.max(maxX - minX + 1, maxZ - minZ + 1) / 2) + 1))
  };
  return {
    area,
    ring: firstRing,
    crops: found.sort((a, b) => a.distance - b.distance)
  };
}

function countCropTypes(crops) {
  const counts = {};
  for (const entry of crops || []) counts[entry.crop] = (counts[entry.crop] || 0) + 1;
  return counts;
}

function matchesCrop(entry, only) {
  if (!only) return true;
  const blockName = entry.block && entry.block.name ? entry.block.name : null;
  return only.has(blockName) || only.has(entry.crop);
}

function planHarvest(crops, config = {}) {
  const limit = Math.max(0, Number(config.maxPerCycle) || 0);
  const only = config.crops && config.crops.length ? normalizeCrops(config.crops) : null;
  const list = (crops || []).filter((entry) => entry && matchesCrop(entry, only));
  if (!list.length) return { action: 'wait', crops: [], reason: 'tidak ada tanaman siap panen' };
  if (limit > 0 && list.length > limit) {
    return { action: 'harvest', crops: list.slice(0, limit), reason: `${limit} tanaman diambil` };
  }
  return { action: 'harvest', crops: list, reason: `${list.length} tanaman siap panen` };
}

const DROP_ENTITY_NAMES = new Set(['item', 'Item', 'item_stack']);

// Item jatuh muncul persis di atas blok yang dihancurkan, jadi radius kecil
// sudah cukup untuk membedakan hasil panen bot sendiri dari drop orang lain.
const DROP_SOURCE_RADIUS = 2.5;

function isDropEntity(entity) {
  if (!entity || !entity.position) return false;
  // entity.objectType itu alias deprecated yang mencetak stack trace setiap
  // kali diakses, jadi jangan dipakai - mineflayer mengisi name/displayName.
  const name = entity.name || entity.displayName;
  return typeof name === 'string' && DROP_ENTITY_NAMES.has(name);
}

// Semua entity item yang masih ada di sekitar bot, terdekat lebih dulu.
// Catatan: metadata index 0 milik entity item itu shared_flags, yang nilainya 0
// untuk drop biasa - jadi metadata tidak boleh dipakai sebagai alasan membuang
// item (dulu filter ini membuat hasil panen tidak pernah terambil).
function listDrops(bot, config = {}) {
  const maxDistance = Number(config.pickupRadius) || 12;
  if (!bot || !bot.entities || !bot.entity) return [];
  const origin = bot.entity.position;
  const drops = [];
  for (const entity of Object.values(bot.entities)) {
    if (!isDropEntity(entity)) continue;
    const distance = Math.hypot(origin.x - entity.position.x, origin.y - entity.position.y, origin.z - entity.position.z);
    if (distance > maxDistance) continue;
    drops.push({ entity, distance });
  }
  drops.sort((a, b) => a.distance - b.distance);
  return drops;
}

function findNearestDrop(bot, config = {}) {
  return listDrops(bot, config)[0] || null;
}

// Cangkul membuat panen jauh lebih cepat; sebagian server juga butuh alat untuk drop tanaman.
function pickTool(bot, options = {}) {
  const empty = { item: null, score: 0, name: null, tier: 'tangan' };
  if (options.useTool === false || !bot || !bot.inventory || typeof bot.inventory.items !== 'function') return empty;
  let best = null;
  for (const item of bot.inventory.items()) {
    if (!item || !String(item.name).endsWith('_hoe')) continue;
    const tier = HOE_TIERS.find((entry) => String(item.name).startsWith(entry.prefix));
    const score = (tier ? tier.bonus : 5) + 1;
    if (!best || score > best.score) {
      best = { item, score, name: item.name, tier: tier ? tier.prefix.replace(/_$/, '') : 'custom' };
    }
  }
  return best || empty;
}

function distanceTo(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function forwardVector(yaw, distance) {
  return new Vec3(-Math.sin(yaw) * distance, 0, Math.cos(yaw) * distance);
}

// Vec3.add() memodifikasi objek aslinya, jadi posisi bot harus disalin dulu.
function shifted(position, yaw, distance) {
  const forward = forwardVector(yaw, distance);
  return new Vec3(position.x + forward.x, position.y + forward.y, position.z + forward.z);
}

function attachFarm(bot, config, logger, hooks = {}) {
  const settings = config.farm || {};
  // Auto-combat butuh bot terus berjalan ke mob. Kalau dua fitur sama-sama
  // memakai setControlState('forward'), mereka rebut arah tiap tick: bot
  // mondar-mandir di tengah dan tidak pernah sampai ke jangkauan, jadi tidak
  // pernah mengayun. Karena itu saat combat punya target, farm melepas
  // kontrol gerak sepenuhnya dan melanjutkan setelah duel selesai.
  const combatBusy = typeof hooks.combatBusy === 'function' ? hooks.combatBusy : () => false;
  function yielding() {
    try {
      return combatBusy();
    } catch {
      return false;
    }
  }
  const stats = {
    harvests: 0,
    carrots: 0,
    pickups: 0,
    replants: 0,
    scans: 0,
    walks: 0,
    searches: 0,
    detours: 0,
    lastCrop: null,
    lastError: null,
    lastScanAt: 0,
    lastActionAt: 0
  };

  let started = false;
  let harvesting = false;
  let heldTool = null;
  let loopTimer = null;
  let scanTimer = null;
  let lastFound = -1;
  let queue = [];
  // Setelah satu siklus panen habis, rescan lahan untuk melihat tanaman apa saja
  // yang masih tersisa di sudut lain (atau baru muncul). Jadi bot tidak berhenti
  // di ujung saja - ia bakal lanjut panen terus sampai benar-benar habis.
  async function rescanAfterCycle(token, areaActive) {
    if (cancelled(token) || !bot.entity) return [];
    const targetArea = areaActive || cache.area || resolveArea(settings);
    const crops = await readyCrops(token, targetArea);
    if (cancelled(token)) return [];
    cache = { crops: crops || [], area: targetArea, at: Date.now() };
    return cache.crops;
  }
  let lastArea = null;
  let discovered = null;
  let lastSearchAt = 0;
  let cycle = 0;
  let aborts = 0;
  let lastJumpAt = 0;
  // Setelah satu siklus panen habis, rescan lahan untuk melihat tanaman apa saja
  // yang masih tersisa di sudut lain (atau baru muncul). Jadi bot tidak berhenti
  // di ujung saja - ia bakal lanjut panen terus sampai benar-benar habis.
  async function rescanAfterCycle(token, areaActive) {
    if (cancelled(token) || !bot.entity) return [];
    const targetArea = areaActive || cache.area || resolveArea(settings);
    const crops = await readyCrops(token, targetArea);
    if (cancelled(token)) return [];
    cache = { crops: crops || [], area: targetArea, at: Date.now() };
    return cache.crops;
  }
  // Tanaman yang dipotong hanya untuk membuka jalan, ditanam ulang nanti.
  const pendingReplant = [];
  let refillToken = null;
  // Sel yang sudah dipanen siklus ini, supaya tidak dipotong dua kali.
  const recentlyCut = new Set();
  // Ingat tanaman yang sudah dipanen (posisi -> waktu) supaya rencana
  // siklus berikutnya sinkron dengan kenyataan di dunia.
  const harvestedAt = new Map();
  // Hasil scan terakhir. Scan area penuh itu mahal (ribuan blockAt), jadi
  // hasilnya dipakai ulang: bot bisa langsung memotong tanaman yang baru
  // saja dipanen, dan pemindaian susulan dijadwalkan di jeda antar tanaman.
  let cache = { crops: null, area: null, at: 0 };
  let nearbyCache = { value: null, at: 0 };
  let scanPending = false;
  const reported = new Set();
  // Entity item hasil panen bot sendiri (id -> waktu klaim). Hanya entri ini
  // yang pernah diambil; drop pemain lain dan loot mob tidak disentuh.
  const ownDrops = new Map();

  const log = logger || { debug() {}, info() {}, warn() {}, success() {} };
  const sleeps = new Set();
  // Setiap penantian menyimpan callback-nya supaya bisa dilepas saat dibatalkan.
  // Kalau timer di-clear tanpa resolve, runCycle() menggantung selamanya dan
  // harvesting tidak pernah false lagi - bot jadi mati Harvest.
  const sleep = (ms) => new Promise((resolve) => {
    const entry = { timer: null, resolve };
    entry.timer = setTimeout(() => {
      sleeps.delete(entry);
      resolve();
    }, ms);
    sleeps.add(entry);
  });
  const later = (fn, ms) => {
    const entry = { timer: null, resolve: null };
    entry.timer = setTimeout(() => {
      sleeps.delete(entry);
      fn();
    }, ms);
    sleeps.add(entry);
  };
  const releaseSleeps = () => {
    for (const entry of sleeps) {
      clearTimeout(entry.timer);
      if (entry.resolve) entry.resolve();
    }
    sleeps.clear();
  };
  const cancelled = (token) => token !== cycle;

  // force =true untuk perintah manual user: perintah itu yang menang.
  function stopMovement(force) {
    // Saat combat memegang target, jangan ikut berhentiin: bot.stop('forward')
    // di sini akan membatalkan jalan combat yang baru saja disetel.
    if (!force && yielding()) return;
    try {
      bot.stop('forward');
      bot.stop('sprint');
      bot.stop('jump');
    } catch {
      /* bot sudah tertutup */
    }
  }

  function report(key, level, message) {
    if (reported.has(key)) return;
    reported.add(key);
    log[level](message);
  }

  function cacheTtl() {
    return Math.max(1000, Number(settings.scanIntervalMs) || 15000);
  }

  function cacheIsFresh() {
    return Array.isArray(cache.crops) && Date.now() - cache.at < cacheTtl();
  }

  // Scan penuh memblokir event loop, jadi tidak boleh jalan di tengah dig.
  // Pemanggil menjadwalkannya di jeda antar tanaman lewat maybeRefreshScan().
  function refreshScan(area, options = {}) {
    if (!bot.entity) return null;
    const target = area || resolveArea(settings);
    const crops = area
      ? scanFarmArea(bot, { ...settings, area })
      : scanFarmArea(bot, settings);
    cache = { crops, area: target, at: Date.now() };
    scanPending = false;
    stats.scans += 1;
    stats.lastScanAt = cache.at;
    return crops;
  }

  function maybeRefreshScan() {
    if (!scanPending || !bot.entity) return;
    // tetap di lahan yang sedang dipanen, jangan balik ke area config
    refreshScan(cache.at ? cache.area : null);
  }

  // Pakai cache kalau masih segar, scan ulang kalau sudah basi/kosong.
  async function readyCrops(token, area) {
    if (cancelled(token)) return null;
    if (!area && !scanPending && cacheIsFresh()) return cache.crops;
    return refreshScan(area);
  }

  // Di balik layar: tandai cache basi tanpa memindai di tengah pekerjaan.
  function startScanner() {
    if (scanTimer) return;
    const ttl = cacheTtl();
    scanTimer = setInterval(() => {
      if (!started || !bot.entity || !scanTimer) return;
      if (!cacheIsFresh()) scanPending = true;
    }, Math.max(1000, Math.floor(ttl / 2)));
  }

  function stopScanner() {
    if (!scanTimer) return;
    clearInterval(scanTimer);
    scanTimer = null;
    scanPending = false;
  }

  function nearbyField() {
    if (nearbyCache.value && Date.now() - nearbyCache.at < cacheTtl()) return nearbyCache.value;
    const value = searchFarmArea(bot, settings);
    nearbyCache = { value, at: Date.now() };
    return value;
  }

  async function walkTo(target, timeoutMs, token) {
    if (cancelled(token) || !bot.entity) return false;
    const startedAt = Date.now();
    const stepMs = Number(settings.walkStepMs) || 250;
    let stuckFor = 0;
    let triedDetour = false;
    let lastDistance = bot.entity.position.distanceTo(target);
    while (Date.now() - startedAt < timeoutMs && !cancelled(token)) {
      if (!bot.entity) break;
      if (yielding()) {
        log.debug('auto-combat sedang mengejar mob, farm melepas kontrol gerak');
        return false;
      }
      const distance = bot.entity.position.distanceTo(target);
      if (distance <= 2) {
        stopMovement();
        return true;
      }
      bot.setControlState('sprint', sprinting(distance));
      await stepToward(target, token, stepMs);
      if (!bot.entity) break;
      const nowDistance = bot.entity.position.distanceTo(target);
      stuckFor = nowDistance < lastDistance - 0.05 ? 0 : stuckFor + 1;
      lastDistance = nowDistance;
      // mentok: jangan paksa jalan lurus, cari rute memutar dulu
      if (stuckFor > 4 && !triedDetour) {
        triedDetour = true;
        const arrived = await detour(target, 2, token);
        if (cancelled(token)) return false;
        if (arrived) {
          stopMovement();
          return true;
        }
        if (!bot.entity) break;
      }
      if (stuckFor > 16) {
        stopMovement();
        log.warn(`bot tersendat di ${bot.entity.position.floored()} saat berjalan ke lahan`);
        return false;
      }
    }
    stopMovement();
    return false;
  }

  function sprinting(distance) {
    return settings.sprint === true && distance > 6;
  }

  // Cek "kamera" ke depan: blok bebas DAN tidak ada mob/player yang berdiri
  // di situ. Kalau ada yang ngehalangin, stepToward belok ke arah lain.
  function clearAhead(yaw) {
    const point = shifted(bot.entity.position, yaw, 0.9);
    const ahead = bot.blockAt(point);
    if (ahead && !isFreeSpace(ahead.name)) return false;
    return !cellBlockedBy(bot, Math.floor(point.x), Math.floor(bot.entity.position.y), Math.floor(point.z));
  }

// Satu langkah jalan biasa: belok sedikit kalau ada tanaman di depan, bukan
  // lompat. Sudut dicoba berurutan supaya bot memutar trolebus, bukan mentok.
  async function stepToward(position, token, stepMs) {
    if (cancelled(token) || !bot.entity) return false;
    // Auto-combat sedang mengejar mob: berhenti bergerak supaya tidak rebut
    // arah dan jangan sampai mengirim frame jalan yang salah.
    if (yielding()) return false;
    const delta = position.minus(bot.entity.position);
    const base = Math.atan2(-delta.x, delta.z);
    let yaw = base;
    for (const offset of STEER_OFFSETS) {
      if (clearAhead(base + offset)) {
        yaw = base + offset;
        break;
      }
    }
    void bot.look(yaw, 0, true);
    bot.setControlState('forward', true);
    const ahead = bot.blockAt(shifted(bot.entity.position, yaw, 0.9));
    if (ahead && !isFreeSpace(ahead.name) && canJump()) {
      bot.setControlState('jump', true);
      later(() => {
        try { bot.stop('jump'); } catch { /* bot sudah tertutup */ }
      }, 250);
    }
    await sleep(stepMs);
    return true;
  }

  function canJump() {
    if (settings.jumpToClimb !== true) return false;
    const now = Date.now();
    const cooldown = Number(settings.jumpCooldownMs) || 1500;
    if (now - lastJumpAt < cooldown) return false;
    lastJumpAt = now;
    return true;
  }

  async function waitForChunks() {
    if (typeof bot.waitForChunksToLoad !== 'function') return;
    try {
      await bot.waitForChunksToLoad();
    } catch (err) {
      log.debug(`gagal menunggu chunk: ${err.message}`);
    }
  }

  async function equipTool() {
    const tool = pickTool(bot, settings);
    if (!tool.item) return;
    // Auto-combat menyita tangan untuk memegang senjata saat ada mob, jadi isi
    // tangan yang sebenarnya dicek, bukan hanya catatan cangkul terakhir.
    const inHand = bot.heldItem && bot.heldItem.name ? String(bot.heldItem.name) : null;
    if (tool.name === heldTool && (!inHand || inHand === tool.name)) return;
    try {
      await bot.equip(tool.item, 'hand');
      heldTool = tool.name;
    } catch (err) {
      heldTool = null;
      log.debug(`gagal memegang cangkul: ${err.message}`);
    }
  }

  async function approach(target, reach, token) {
    if (cancelled(token) || !bot.entity) return false;
    if (bot.entity.position.distanceTo(target) <= reach) return true;
    const attempts = Number(settings.approachAttempts) || 12;
    const stepMs = Number(settings.approachStepMs) || 150;
    for (let i = 0; i < attempts; i += 1) {
      if (cancelled(token) || !bot.entity) break;
      if (bot.entity.position.distanceTo(target) <= reach) break;
      await stepToward(target, token, stepMs);
    }
    stopMovement();
    return bot.entity.position.distanceTo(target) <= reach + 0.6;
  }

  // Sudut belok yang dipakai kalau jalan lurus terhalang tanaman.
  const STEER_OFFSETS = [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.2, -2.2, Math.PI];

  // Jalan biasa terhalang (blok, mob, atau player) -> susun rute memutar lewat
  // grid blok lalu ikuti rutenya. Return true kalau sampai ke target.
  async function detour(position, reach, token) {
    if (cancelled(token) || !bot.entity) return false;
    const path = findPath(bot, bot.entity.position, position, {
      radius: pathRadiusOf(settings),
      reach,
      jump: settings.jumpToClimb === true
    });
    if (!path || !path.length) return false;
    stats.detours += 1;
    log.debug(`jalur terhalang, cari jalan lain: ${path.length} langkah menuju ${position.floored()}`);
    const stepMs = Number(settings.walkStepMs) || 250;
    const stepCap = cropWalkStepsOf(settings) || 48;
    let steps = 0;
    for (const point of path) {
      if (cancelled(token) || !bot.entity) return false;
      let still = 0;
      let lastPos = new Vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
      while (!cancelled(token) && bot.entity && steps < stepCap) {
        if (bot.entity.position.distanceTo(position) <= reach) {
          stopMovement();
          return true;
        }
        if (bot.entity.position.distanceTo(point) <= 1.2) break;
        steps += 1;
        await stepToward(point, token, stepMs);
        if (!bot.entity) return false;
        const moved = bot.entity.position.distanceTo(lastPos) > 0.05;
        lastPos = new Vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
        still = moved ? 0 : still + 1;
        // waypoint tidak tercapai (misalnya mob berdiri di situ): lompat ke
        // waypoint berikutnya, rute tetap dipakai sampai habis.
        if (still > 4) break;
      }
      if (steps >= stepCap) break;
    }
    stopMovement();
    return Boolean(bot.entity) && bot.entity.position.distanceTo(position) <= reach;
  }

  // Kejar satu tanaman sambil memotong yang lain di jalur jalan.
  // Tanpa batas jarak/langkah (cropWalkSteps & chaseRange default 0 = tanpa
  // batas): panen terus sampai sampai atau benar-benar macet total.
  // Kalau jalur terhalang, cari jalan lain dulu, bukan langsung menyerah.
  async function walkAndHarvest(target, reach, token) {
    if (!bot.entity) return false;
    if (!verifyQueued(target)) return false;
    const stepMs = Number(settings.walkStepMs) || 250;
    const stepCap = cropWalkStepsOf(settings);
    const chaseCap = chaseRangeOf(settings);
    const maxDetours = 3;
    let steps = 0;
    let stall = 0;
    let detourTries = 0;
    let lastDistance = bot.entity.position.distanceTo(target.position);
    while (!cancelled(token)) {
      if (!bot.entity) return false;
      const distance = bot.entity.position.distanceTo(target.position);
      if (distance <= reach) {
        stopMovement();
        return true;
      }
      // batas hanya aktif kalau memang diisi di config; default = tanpa batas
      if (stepCap > 0 && steps >= stepCap) break;
      if (chaseCap > 0 && distance > chaseCap && !queue.some((entry) => bot.entity.position.distanceTo(entry.position) <= reach)) break;
      steps += 1;
      bot.setControlState('sprint', sprinting(distance));
      await stepToward(target.position, token, stepMs);
      // memotong yang sudah terjangkau tanpa berhenti lama di satu tanaman
      await harvestInReach(reach, token);
      if (!bot.entity) return false;
      if (!verifyQueued(target)) {
        stopMovement();
        return true;
      }
      // tanaman yang sudah masuk rencana tapi menghalangi jalan: patah
      // sekalian, tanam ulangannya ditunda sampai bot sudah melangkah pergi
      await cutBlocker(reach, token);
      flushReplant(reach, token);
      const nowDistance = bot.entity.position.distanceTo(target.position);
      stall = nowDistance < lastDistance - 0.05 ? 0 : stall + 1;
      lastDistance = nowDistance;
      if (stall >= 3 && detourTries < maxDetours) {
        detourTries += 1;
        const arrived = await detour(target.position, reach, token);
        if (cancelled(token)) return false;
        if (arrived) return true;
        if (!bot.entity) return false;
        if (!verifyQueued(target)) {
          stopMovement();
          return true;
        }
        stall = 0;
        continue;
      }
      if (stall > 10) {
        stopMovement();
        log.debug(`tersendat di ${bot.entity.position.floored()} menuju ${target.position.floored()}`);
        return false;
      }
    }
    stopMovement();
    return Boolean(bot.entity) && bot.entity.position.distanceTo(target.position) <= reach;
  }

  // Tanam ulang semua tanaman yang tertunda, di luar siklus panen yang
  // dibatalkan, supaya lahan tidak tertinggal berlubang.
  function startRefill() {
    if (refillToken !== null) return;
    if (!pendingReplant.length) return;
    refillToken = cycle;
    void (async () => {
      const mine = refillToken;
      const token = mine;
      while (mine !== null && refillToken === mine) {
        for (const entry of pendingReplant.splice(0)) {
          if (cancelled(token) || !bot.entity) {
            pendingReplant.unshift(entry);
            break;
          }
          await replant(entry, entry.crop, token);
        }
        if (!pendingReplant.length) break;
      }
      if (refillToken === mine) refillToken = null;
    })();
  }

  // Tanam ulang tanaman yang tadi dipotong untuk membuka jalan, begitu bot
  // sudah cukup jauh supaya tidak menutup jalannya sendiri.
  function flushReplant(reach, token) {
    if (settings.replant === false || !pendingReplant.length) return;
    for (let i = 0; i < pendingReplant.length;) {
      const entry = pendingReplant[i];
      if (cancelled(token) || !bot.entity) return;
      if (bot.entity.position.distanceTo(entry.position) < reach) {
        i += 1;
        continue;
      }
      pendingReplant.splice(i, 1);
      void replant(entry, entry.crop, token);
    }
  }

  function nearestQueued() {
    if (!queue.length || !bot.entity) return null;
    queue.sort((a, b) => distanceTo(a.position, bot.entity.position) - distanceTo(b.position, bot.entity.position));
    return queue[0];
  }

  // Ingat tanaman yang barusan dipanen supaya siklus berikutnya tidak
  // mengambil tanaman yang sama lagi, dan bot tidak memanen ulang tanaman
  // yang barusan ditanam di depan kakinya sendiri.
  function rememberHarvested(position) {
    harvestedAt.set(positionKey(position), Date.now());
  }

  // Tanaman yang baru dipanen belum giliran lagi sampai cooldown habis.
  function dueCrops(crops) {
    const cooldown = Number(settings.harvestCooldownMs);
    if (!Number.isFinite(cooldown) || cooldown <= 0) return crops;
    const now = Date.now();
    for (const [id, at] of harvestedAt) if (now - at > cooldown) harvestedAt.delete(id);
    const fresh = crops.filter((entry) => {
      const at = harvestedAt.get(positionKey(entry.position));
      return at === undefined || now - at >= cooldown;
    });
    return fresh;
  }

  function forgetQueued(target) {
    const index = queue.indexOf(target);
    if (index >= 0) queue.splice(index, 1);
  }

  // Sinkron dengan rencana: tanaman di antrean hanya dipotong kalau di dunia
  // nyata masih ada blok tanaman yang cocok. Kalau sudah hilang (orang lain
  // memetik, atau sudah dipanen siklus ini), keluar dari antrean saja.
  function verifyQueued(target) {
    if (!target || !bot.entity) return false;
    const block = bot.blockAt(target.position);
    if (block && isCropBlock(block.name) && cropName(block.name) === target.crop) return true;
    forgetQueued(target);
    return false;
  }

  // Semua tanaman yang sudah dalam jangkauan dipotong sekaligus, lalu bot
  // lanjut jalan lagi - bukan berdiri di satu tanaman sampai lama.
  async function harvestInReach(reach, token) {
    let hits = 0;
    for (let i = 0; i < queue.length; i += 1) {
      if (cancelled(token) || !bot.entity) break;
      const target = queue[i];
      if (bot.entity.position.distanceTo(target.position) > reach) continue;
      const block = bot.blockAt(target.position);
      if (!block || !isCropBlock(block.name)) {
        forgetQueued(target);
        i -= 1;
        continue;
      }
      // Kalau tanaman ini persis di depan kaki bot, jangan tanam ulang di
      // tempat: nanti bot mengunci jalannya sendiri. Tanam ulangnya ditunda.
      const blocking = blocksPath(target.position);
      const ok = await harvestOne({ ...target, block }, token, true, { replant: !blocking });
      forgetQueued(target);
      if (!ok) continue;
      recentlyCut.add(positionKey(target.position));
      rememberHarvested(target.position);
      if (blocking && settings.replant !== false) pendingReplant.push(target);
      hits += 1;
      i -= 1;
    }
    return hits;
  }

  // Tanaman yang sudah masuk rencana tapi persis menghalangi jalan: dipotong
  // membuka jalan, planted ulang begitu bot sudah melangkah lewat. Tanaman di
  // luar rencana tidak pernah disentuh.
  async function cutBlocker(reach, token) {
    if (cancelled(token) || !bot.entity) return false;
    const ahead = bot.blockAt(shifted(bot.entity.position, bot.entity.yaw, 0.9));
    if (!ahead || !isCropBlock(ahead.name)) return false;
    const position = ahead.position;
    if (bot.entity.position.distanceTo(position) > reach) return false;
    const id = positionKey(position);
    if (recentlyCut.has(id)) return false;
    const queued = queue.find((entry) => positionKey(entry.position) === id);
    if (!queued) return false;
    const ok = await harvestOne({ ...queued, block: ahead, distance: 0 }, token, true, { replant: false });
    if (!ok) return false;
    recentlyCut.add(id);
    forgetQueued(queued);
    if (settings.replant !== false) pendingReplant.push(queued);
    rememberHarvested(queued.position);
    return true;
  }

  function positionKey(position) {
    if (!position) return '-';
    return `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  }

  //>true kalau sel ini persis di depan kaki bot (atau bot sudah masuknya),
  // jadi planted ulang di situ akan menutup jalan.
  function blocksPath(position) {
    if (!bot.entity) return false;
    const id = positionKey(position);
    if (id === positionKey(bot.entity.position)) return true;
    const ahead = bot.blockAt(shifted(bot.entity.position, bot.entity.yaw, 0.9));
    return Boolean(ahead && positionKey(ahead.position) === id);
  }

  // Klaim entity item yang baru muncul dekat blok yang baru saja dipanen.
  // Satu tanaman bisa menjatuhkan lebih dari satu stack (gandum + benih, carrot
  // dengan Fortune), jadi semua yang muncul dicatat, bukan cuma yang terdekat.
  function claimOwnDrops(seen, source) {
    pruneOwnDrops();
    const origin = source ? source.offset(0.5, 0.5, 0.5) : null;
    for (const entity of Object.values(bot.entities || {})) {
      if (!isDropEntity(entity) || seen.has(entity.id) || ownDrops.has(entity.id)) continue;
      if (origin) {
        const gap = Math.hypot(
          entity.position.x - origin.x,
          entity.position.y - origin.y,
          entity.position.z - origin.z
        );
        if (gap > DROP_SOURCE_RADIUS) continue;
      }
      ownDrops.set(entity.id, { at: Date.now() });
    }
  }

  // Hasil panen sendiri yang hilang dari bot.entities sudah masuk tas. Bot
  // sering kelewat-ngelewat stack lain sambil mengejar satu target, dan item
  // juga bisa hilang tepat di antara dua percobaan - jadi semua yang hilang
  // ikut dihitung di satu tempat, kalau tidak statistik ambil selalu kurang.
  // Dipanggil juga saat bot tidak sedang mengejar apa pun, supaya tidak ada
  // item yang masuk tas tapi tidak pernah tercatat.
  function forgetCollectedDrops() {
    if (!ownDrops.size) return 0;
    let taken = 0;
    for (const id of [...ownDrops.keys()]) {
      if (bot.entities && bot.entities[id]) continue;
      ownDrops.delete(id);
      taken += 1;
    }
    if (taken) {
      stats.pickups += taken;
      stats.lastActionAt = Date.now();
    }
    return taken;
  }

  // Entri lama dibuang supaya id entity yang dipakai ulang server tidak
  // membuat bot mengejar item milik orang lain.
  function pruneOwnDrops() {
    forgetCollectedDrops();
    if (!ownDrops.size) return;
    const ttl = Math.max(5000, Number(settings.dropMemoryMs) || 120000);
    const now = Date.now();
    for (const [id, entry] of ownDrops) {
      if (now - entry.at > ttl) ownDrops.delete(id);
    }
  }

  function nearestOwnDrop() {
    const drops = listDrops(bot, settings).filter((drop) => ownDrops.has(drop.entity.id));
    return drops[0] || null;
  }

  async function waitForDrop(seen, source, token) {
    const stepMs = Number(settings.dropStepMs) || 150;
    const timeoutMs = Number(settings.dropWaitMs) || 1500;
    for (let waited = 0; waited <= timeoutMs; waited += stepMs) {
      if (cancelled(token)) return null;
      claimOwnDrops(seen, source);
      const drop = nearestOwnDrop();
      if (drop) return drop;
      await sleep(stepMs);
    }
    return null;
  }

  async function pickUpDrop(drop, token) {
    if (!drop || !drop.entity || !bot.entity || cancelled(token)) return false;
    const id = drop.entity.id;
    const target = drop.entity.position;
    const attempts = Number(settings.pickupAttempts) || 14;
    const stepMs = Number(settings.pickupStepMs) || 150;
    let stall = 0;
    let detours = 0;
    let lastPos = bot.entity.position.clone();
    // Bot harus benar-benar mendekati item: arah jalan dicocokkan ulang tiap
    // langkah, bukan cuma maju lurus sekali (lahan bertingkat sering macet).
    for (let i = 0; i < attempts; i += 1) {
      if (cancelled(token) || !bot.entity) break;
      const entity = bot.entities ? bot.entities[id] : null;
      if (!entity) break;
      const distance = bot.entity.position.distanceTo(entity.position);
      if (distance < 1.4) break;
      bot.setControlState('sprint', sprinting(distance));
      await stepToward(entity.position, token, stepMs);
      if (!bot.entity) break;
      stall = bot.entity.position.distanceTo(lastPos) > 0.05 ? 0 : stall + 1;
      lastPos = bot.entity.position.clone();
      if (stall >= 3 && detours < 2) {
        detours += 1;
        if (await detour(entity.position, 1.2, token)) break;
        if (cancelled(token) || !bot.entity) break;
        stall = 0;
      }
    }
    stopMovement();
    if (cancelled(token)) return false;
    // Beri waktu server memindahkan item ke tas.
    for (let waited = 0; waited <= 800; waited += 200) {
      if (!bot.entities || !bot.entities[id]) {
        // forgetCollectedDrops() sudah menghitung semua yang masuk tas,
        // termasuk stack lain yang terlewati di perjalanan.
        if (!forgetCollectedDrops()) {
          stats.pickups += 1;
          stats.lastActionAt = Date.now();
        }
        return true;
      }
      await sleep(200);
    }
    // Dicatat supaya sapuan akhir siklus masih bisa mencobanya.
    ownDrops.set(id, { at: Date.now() });
    const full = bot.inventory && typeof bot.inventory.emptySlotCount === 'function' && bot.inventory.emptySlotCount() === 0;
    stats.lastError = full
      ? `item di ${target.floored()} tidak terambil, tas sudah penuh`
      : `item di ${target.floored()} tidak terambil (jarak ${Number(drop.distance).toFixed(1)})`;
    log.debug(stats.lastError);
    return false;
  }

  // Sisa hasil panen yang gagal terambil tadi: keliling ambil sekalian sebelum
  // siklus berikutnya, supaya tidak ada carrot tertinggal permanen di tanah.
  async function sweepDrops(token) {
    if (settings.sweepDrops === false) return 0;
    const limit = Math.max(1, Number(settings.sweepLimit) || 8);
    pruneOwnDrops();
    const before = stats.pickups;
    for (let i = 0; i < limit; i += 1) {
      if (cancelled(token) || !bot.entity) break;
      const drop = nearestOwnDrop();
      if (!drop) break;
      if (await pickUpDrop(drop, token)) continue;
      break;
    }
    return stats.pickups - before;
  }

  async function replant(target, crop, token) {
    if (settings.replant === false || cancelled(token) || !bot.entity) return false;
    const wanted = settings.replantItem || SEED_ITEM[crop] || crop;
    const candidates = [wanted];
    if (crop === 'carrot') candidates.push('wheat_seeds', 'beetroot_seeds');
    const item = candidates.map((name) => bot.inventory.items().find((entry) => entry && entry.name === name)).find(Boolean);
    if (!item) {
      report(`no-seed-${crop}`, 'debug', `tidak ada ${wanted} untuk tanam ulang di ${target.position.floored()}`);
      return false;
    }
    if (heldTool !== item.name) {
      try {
        await bot.equip(item, 'hand');
        heldTool = item.name;
      } catch (err) {
        log.debug(`gagal memegang ${item.name}: ${err.message}`);
        return false;
      }
    }
    const soil = bot.blockAt(target.position.offset(0, -1, 0));
    if (!soil || !isSoil(soil.name)) return false;
    try {
      await bot.lookAt(soil.position.offset(0.5, 0.1, 0.5), true);
      await bot.placeBlock(soil, new Vec3(0, 1, 0));
      stats.replants += 1;
      stats.lastActionAt = Date.now();
      log.info(`tanam ulang ${item.name} di ${soil.position.floored()}`);
      return true;
    } catch (err) {
      stats.lastError = `tanam ulang gagal: ${err.message}`;
      report(`replant-fail-${item.name}`, 'warn', `tanam ulang ${item.name} gagal: ${err.message}`);
      return false;
    }
  }

  async function harvestOne(target, token, inReach, options = {}) {
    const reach = Number(settings.reach) || 3.2;
    const wantReplant = options.replant !== false;
    if (!inReach && !(await approach(target.position, reach, token))) {
      if (cancelled(token)) return false;
      const distance = bot.entity ? bot.entity.position.distanceTo(target.position) : target.distance;
      stats.lastError = `tidak bisa mendekati ${target.crop} di ${target.position.floored()}`;
      report(`approach-fail-${target.position.floored()}`, 'debug', `${stats.lastError} (jarak ${Number(distance).toFixed(1)})`);
      return false;
    }
    await equipTool();
    if (cancelled(token) || !bot.entity) return false;
    await bot.lookAt(target.position.offset(0.5, 0.1, 0.5), true);
    const block = bot.blockAt(target.position);
    if (!block || !isCropBlock(block.name)) return false;
    // Rekam entity apa saja yang sudah ada sebelum memotong: item yang baru
    // muncul sesudahnya di dekat blok ini adalah hasil panen bot sendiri.
    // Object.keys() menghasilkan string sedangkan id entity angka, jadi id di
    // sini harus lewat Object.values.
    const seen = new Set(Object.values(bot.entities || {}).map((entity) => entity.id));
    try {
      await bot.dig(block);
    } catch (err) {
      stats.lastError = `gagal memotong ${target.crop}: ${err.message}`;
      report(`dig-fail-${err.message}`, 'warn', stats.lastError);
      return false;
    }
    stats.harvests += 1;
    if (target.crop === 'carrot') stats.carrots += 1;
    stats.lastCrop = target.crop;
    stats.lastActionAt = Date.now();
    stats.lastError = null;
    log.info(`panen ${target.crop} di ${target.position.floored()} (jarak ${bot.entity.position.distanceTo(target.position).toFixed(1)})`);
    const drop = await waitForDrop(seen, target.position, token);
    if (drop) await pickUpDrop(drop, token);
    else if (!cancelled(token)) report(`no-drop-${target.position.floored()}`, 'debug', `tidak ada drop_item yang muncul setelah panen ${target.crop} di ${target.position.floored()}`);
    if (wantReplant) await replant(target, target.crop, token);
    return true;
  }

  function logScan(crops, area) {
    stats.lastScanAt = Date.now();
    const total = crops.length;
    if (total > 0 && area) {
      if (total !== lastFound || area !== lastArea) {
        const counts = Object.entries(countCropTypes(crops)).map(([name, count]) => `${name} ${count}`).join(', ');
        log.info(`scan lahan ${describeArea(area)} -> ${total} tanaman siap (${counts})`);
      }
      lastFound = total;
      lastArea = area;
      return;
    }
    lastFound = 0;
    lastArea = area || null;
    if (!area) {
      log.warn(`tidak ada tanaman di sekitar bot (radius ${searchRadiusOf(settings)}) - cek farm.crops`);
      return;
    }
    const distance = distanceToArea(bot, area);
    const walkRadius = walkRadiusOf(settings);
    const maxWalk = maxWalkDistanceOf(settings);
    if (maxWalk > 0 && distance > maxWalk) {
      log.warn(
        `lahan ${describeArea(area)} berjarak ${distance.toFixed(0)} blok dari bot, ` +
        `lebih dari farm.maxWalkDistance=${maxWalk} - cek farm.area x/z, bot tidak akan berjalan`
      );
    } else if (walkRadius > 0 && distance > walkRadius) {
      log.info(`tidak ada tanaman di area, tapi lahan berjarak ${distance.toFixed(0)} blok dari bot (walkToRadius=${walkRadius})`);
    } else {
      const filters = [...normalizeCrops(settings.crops)].join('/');
      log.warn(
        `tidak ada tanaman di ${describeArea(area)} (jarak ${distance.toFixed(1)}) - ` +
        `cek farm.crops (${filters}) dan tinggi lahan (area.y)`
      );
    }
  }

  async function runCycle(force) {
    if (harvesting || !bot.entity) return 0;
    // Auto-combat sedang dikejar: siklus panen dilewati tanpa menyentuh kontrol
    // gerak. Kalau tidak, berhenti jalan di sini membatalkan jalan combat dan
    // bot tidak akan pernah sampai ke mob. Siklus otomatis menunda diam-diam,
    // perintah manual akan bilang apa yang terjadi.
    if (yielding()) {
      if (force) {
        log.warn('panen manual dilewati: auto-combat sedang mengejar mob');
        return 0;
      }
      log.debug('auto-combat sedang mengejar mob, siklus panen ditunda');
      return 0;
    }
    harvesting = true;
    const token = cycle;
    try {
      const area = resolveArea(settings);
      let crops = (await readyCrops(token)) || [];
      let activeArea = area;
      // Kalau tanaman datang dari cache lahan yang ditemukan, namanya ikut
      // lahan itu, bukan area yang dikonfigurasi.
      if (Array.isArray(crops) && cache.crops === crops && cache.area) activeArea = cache.area;
      const walkRadius = walkRadiusOf(settings);
      const maxWalk = maxWalkDistanceOf(settings);
      const distance = area ? distanceToArea(bot, area) : 0;
      const tooFar = maxWalk > 0 && distance > maxWalk;
      const shouldWalk = Boolean(area) && !tooFar && walkRadius > 0 && distance > walkRadius;

      if (!crops.length && shouldWalk) {
        const target = areaTarget(area, bot.entity.position);
        log.info(`lahan berjarak ${distance.toFixed(0)} blok, bot berjalan ke sana`);
        stats.walks += 1;
        await walkTo(target, Number(settings.walkTimeoutMs) || 8000, token);
        if (cancelled(token)) return 0;
        await waitForChunks();
        if (cancelled(token)) return 0;
        // posisi bot berubah, urutan tanaman juga - paksa scan baru
        crops = (await readyCrops(token, area)) || [];
      }

      // lahan yang ketemu sebelumnya: scan ulang dulu sebelum cari yang baru
      if (!crops.length && discovered) {
        crops = (await readyCrops(token, discovered.area)) || [];
        activeArea = discovered.area;
        if (!crops.length) {
          log.info(`lahan di (${discovered.area.x}, ${discovered.area.y}, ${discovered.area.z}) sudah habis, cari lahan baru`);
          discovered = null;
          lastSearchAt = 0;
        }
      }

      // auto-pencarian: bot mencari lahan terdekat di sekitarnya sendiri
      if (!crops.length && settings.autoDiscover !== false) {
        const searchRadius = searchRadiusOf(settings);
        const now = Date.now();
        if (now - lastSearchAt >= searchIntervalOf(settings)) {
          lastSearchAt = now;
          if (searchRadius > 0) {
            stats.searches += 1;
            const found = searchFarmArea(bot, settings);
            if (found) {
              discovered = { area: found.area, foundAt: now };
              activeArea = found.area;
              const fieldDistance = distanceToArea(bot, found.area);
              if (maxWalk > 0 && fieldDistance <= maxWalk && fieldDistance > 2) {
                log.info(`lahan ${fieldDistance.toFixed(0)} blok dari sini, bot berjalan ke sana`);
                stats.walks += 1;
                await walkTo(
                  areaTarget(found.area, bot.entity.position),
                  Number(settings.walkTimeoutMs) || 8000,
                  token
                );
                if (cancelled(token)) return 0;
                await waitForChunks();
                if (cancelled(token)) return 0;
                const rescanned = (await readyCrops(token, found.area)) || [];
                if (rescanned.length) crops = rescanned;
              } else {
                crops = found.crops;
                cache = { crops, area: found.area, at: Date.now() };
              }
              const types = Object.entries(countCropTypes(crops))
                .map(([name, count]) => `${name} ${count}`)
                .join(', ');
              log.success(`lahan ditemukan di ${describeArea(found.area)}, ${ringLabel(found.ring)}: ${crops.length} tanaman (${types})`);
            } else {
              log.debug(`tidak ada tanaman dalam radius ${searchRadius} blok dari bot, cari lagi nanti`);
            }
          }
        }
      }

      logScan(crops, activeArea);
      const plan = planHarvest(crops, settings);
      if (plan.action !== 'harvest') return 0;

      // Rencana siklus ini = daftar tanaman yang benar-benar ada di dunia dan
      // belum dipanen. Bot hanya boleh memotong isi daftar ini; apa pun yang
      // tidak ada di daftar tidak disentuh sama sekali.
      const ready = dueCrops(plan.crops);
      const skipped = plan.crops.length - ready.length;
      if (!ready.length) {
        log.debug(`tidak ada tanaman baru untuk dipanen (${skipped} tanaman masih cooldown)`);
        queue = [];
        return 0;
      }
      if (skipped) log.debug(`${skipped} tanaman dilewati karena masih cooldown harvestCooldownMs`);

      // Bot jalan menyusuri lahan sambil memotong semua yang sudah dalam
      // jangkauan, bukan berdiri lama di satu tanaman lalu pindah satu-satu.
      queue = ready.slice();
      const reach = Number(settings.reach) || 3.2;
      const interval = Math.max(0, Number(settings.harvestIntervalMs) || 0);
      const before = stats.harvests;
      let aborted = false;
      // Tidak ada batas jumlah tanaman per siklus: loop sampai antrean habis.
      // Pengaman satu-satunya = kalau antrean tidak berkurang beberapa kali
      // berturut-turut (macet total), hentikan supaya tidak berputar di tempat.
      let lastQueueLength = queue.length;
      let idleRounds = 0;
      while (queue.length) {
        if (!bot.entity) break;
        // Mob masuk jangkauan di tengah siklus: tinggalkan antrean dan jangan
        // membalikkan kepala bot ke tanaman, atau jalan combat dibatalkan.
        if (yielding()) {
          log.debug('auto-combat aktif, panen disisihkan sampai duel selesai');
          aborted = true;
          queue = [];
          break;
        }
        if (cancelled(token)) {
          aborted = true;
          break;
        }
        const target = nearestQueued();
        if (!target) break;
        // sinkron terakhir sebelum bergerak: cek bloknya masih ada
        if (!verifyQueued(target)) continue;
        const reached = await walkAndHarvest(target, reach, token);
        if (cancelled(token)) {
          aborted = true;
          break;
        }
        // tetap panggil walau target sudah dalam jangkauan: di sinilah
        // tanaman yang dilalui ikut dipotong
        await harvestInReach(reach, token);
        if (cancelled(token)) {
          aborted = true;
          break;
        }
        if (!reached && queue.includes(target)) {
          // tidak bisa sampai ke tanaman ini: buang dari antrean supaya tidak
          // berputar di tempat, siklus berikutnya akan scan lagi
          forgetQueued(target);
          log.debug(`tidak sampai ke ${target.crop} di ${target.position.floored()}, lanjut tanaman lain`);
        }
        maybeRefreshScan();
        if (queue.length && interval > 0) await sleep(interval);
        if (queue.length < lastQueueLength) {
          lastQueueLength = queue.length;
          idleRounds = 0;
        } else {
          idleRounds += 1;
        }
        if (idleRounds > 4) {
          log.debug(`antrean tidak maju (${queue.length} tanaman tersisa), siklus berikutnya scan lagi`);
          break;
        }
      }
      const done = stats.harvests - before;
      // tutup semua tanaman yang tadi dipotong untuk membuka jalan
      for (const entry of pendingReplant.splice(0)) await replant(entry, entry.crop, token);
      refillToken = null;
      // sapu sisa hasil panen yang tadi gagal terambil (misalnya tas sudah
      // penuh) supaya tidak menggantung di tanah sampai Ender chest penuh
      const swept = await sweepDrops(token);
      const left = ownDrops.size;
      if (aborted) log.info(`panen dihentikan setelah ${done} tanaman, sisa ${queue.length} dilewati`);
      else if (done) {
        const ambil = swept ? `, ambil ${swept} item nyisa` : '';
        log.success(`panen selesai: ${done} tanaman (total ${stats.harvests}, wortel ${stats.carrots}, ambil ${stats.pickups}${ambil})`);
      } else if (queue.length) log.debug(`tidak ada tanaman yang terjangkau dari ${bot.entity ? bot.entity.position.floored() : '-'} (${queue.length} belum bisa dipotong)`);
      if (left) log.warn(`${left} hasil panen masih tertinggal di tanah di sekitar ${bot.entity ? bot.entity.position.floored() : '-'} (dicek lagi siklus berikutnya)`);
      queue = [];
      recentlyCut.clear();
      // Tidak melanjutkan siklus otomatis di sini - test mengharapkan siklus selesai sekali
      // Bot akan melanjutkan pada loop() berikutnya dengan jeda cepat jika masih ada tanaman
      // di cache. Rescan manual hanya jika cache kosong.
      return done;
    } catch (err) {
      stats.lastError = `siklus panen gagal: ${err.message}`;
      log.debug(stats.lastError);
      return 0;
    } finally {
      harvesting = false;
      stopMovement();
    }
  }

  function status() {
    const area = resolveArea(settings);
    // status sering dipanggil dari console, jadi pakai cache kalau ada
    const crops = cacheIsFresh() ? cache.crops : (area ? scanFarmArea(bot, settings) : []);
    // pencarian lahan terdekat radius 32 itu berat, tidak perlu diulang tiap ketik
    const nearby = settings.autoDiscover !== false ? nearbyField() : null;
    pruneOwnDrops();
    return {
      enabled: started,
      harvesting,
      aborts,
      area,
      areaText: describeArea(area),
      areaConfigured: isAreaConfigured(area),
      distance: area ? Number(distanceToArea(bot, area).toFixed(1)) : null,
      crops: crops.length,
      types: countCropTypes(crops),
      cropsFilter: [...normalizeCrops(settings.crops)],
      autoDiscover: settings.autoDiscover !== false,
      searchRadius: searchRadiusOf(settings),
      discovered: discovered ? { ...discovered.area } : null,
      nearbyField: nearby ? { ...nearby.area, crops: nearby.crops.length, ring: nearby.ring } : null,
      cachedCrops: cacheIsFresh(),
      cachedArea: cacheIsFresh() && cache.area ? { ...cache.area } : null,
      pendingDrops: ownDrops.size,
      stats: { ...stats }
    };
  }

  async function loop() {
    if (!started) return;
    const done = await runCycle();
    if (!started) return;
    // Kalau siklus lalu berhasil panen dan cache masih punya tanaman, lanjut
    // secepat mungkin: panen terus-menerus sampai lahan habis atau bot di-stop.
    // Kalau tidak ada hasil, baru scan ulang dengan jeda panjang.
    const fast = done > 0 && !scanPending && cacheIsFresh() && cache.crops.length > 0;
    if (!fast) scanPending = true;
    const waitMs = fast
      ? Math.max(300, Number(settings.betweenCycleMs) || 600)
      : Math.max(2000, Number(settings.scanIntervalMs) || 15000);
    loopTimer = setTimeout(loop, waitMs);
  }

  function start(force) {
    if (started) return;
    if (!settings.enabled && !force) return;
    const auto = settings.autoDiscover !== false;
    const area = resolveArea(settings);
    const crops = [...normalizeCrops(settings.crops)].join(', ');
    if (!auto && !isAreaConfigured(area)) {
      log.warn('farm.area (x/y/z) belum diisi - isi titik tengah lahan di config.json, fitur dilewati');
      return;
    }
    started = true;
    startScanner();
    loop();
    if (isAreaConfigured(area)) {
      log.info(`auto-panen aktif di ${describeArea(area)}, tanaman: ${crops}`);
    } else {
      log.info(`auto-panen aktif: mencari lahan di sekitar bot (radius ${searchRadiusOf(settings)} blok), tanaman: ${crops}`);
    }
  }

  // Batalkan siklus panen yang sedang jalan tanpa mematikan auto-panen.
  function abortHarvest() {
    const wasHarvesting = harvesting;
    if (!wasHarvesting) return false;
    aborts += 1;
    cycle += 1;
    scanPending = false;
    queue = [];
    recentlyCut.clear();
    // Tanaman yang tadi dipotong untuk membuka jalan tetap ditanam ulang di
    // latar belakang, jangan sampai lahan jadi berlubang permanen.
    startRefill();
    releaseSleeps();
    // Perintah manual user yang menang atas fitur lain.
    stopMovement(true);
    log.warn('panen dihentikan manual');
    return true;
  }

  function stop() {
    started = false;
    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = null;
    }
    cycle += 1;
    scanPending = false;
    queue = [];
    recentlyCut.clear();
    ownDrops.clear();
    startRefill();
    releaseSleeps();
    stopMovement();
    stopScanner();
  }

  function setEnabled(value) {
    if (value) start(true);
    else stop();
  }

  return {
    stats,
    start,
    stop,
    abortHarvest,
    setEnabled,
    status,
    harvest: () => runCycle(true),
    scan: () => refreshScan() || [],
    get enabled() { return started; },
    get harvesting() { return harvesting; },
    get aborts() { return aborts; }
  };
}

module.exports = {
  attachFarm,
  scanFarmArea,
  planHarvest,
  findNearestDrop,
  listDrops,
  isDropEntity,
  cropName,
  isCropBlock,
  isSoil,
  resolveArea,
  resolveBounds,
  normalizeBounds,
  describeArea,
  areaTarget,
  normalizeCrops,
  isAreaConfigured,
  walkRadiusOf,
  maxWalkDistanceOf,
  cropWalkStepsOf,
  chaseRangeOf,
  pathRadiusOf,
  searchRadiusOf,
  searchIntervalOf,
  searchFarmArea,
  distanceToArea,
  countCropTypes,
  pickTool,
  CROP_BLOCKS,
  SOIL_BLOCKS,
  CROP_ALIASES,
  SEED_ITEM
};