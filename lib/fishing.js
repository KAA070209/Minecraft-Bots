'use strict';

const DEFAULT_ROD_NAMES = ['fishing_rod', 'fishingrod', 'fishing_pole', 'fishing pole', 'pancing', 'pancingan'];
const BOBBER_NAMES = new Set(['fishing_bobber', 'fishingbobber', 'fishing_bobber_entity']);

function normalizeName(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[\s-]+/g, '_');
}

function isFishingRod(item, extraNames = []) {
  if (!item) return false;
  const names = [...DEFAULT_ROD_NAMES, ...extraNames].map(normalizeName).filter(Boolean);
  const labels = [item.name, item.displayName, item.customName].filter(Boolean).map(normalizeName);
  if (!labels.length) return false;
  return names.some((name) => labels.some((label) => label === name || label.includes(name)));
}

// Cari pancingan di seluruh inventory. Slot hotbar lebih diprioritaskan supaya
// bot tidak perlu menukar terlalu banyak item kalau ada beberapa pancingan.
function findFishingRod(bot, options = {}) {
  if (!bot || !bot.inventory || typeof bot.inventory.items !== 'function') return null;
  const extra = Array.isArray(options.names) ? options.names : [];
  const rods = bot.inventory.items().filter((item) => isFishingRod(item, extra));
  if (!rods.length) return null;
  return rods.find((item) => Number(item.slot) >= 9 && Number(item.slot) <= 17) || rods[0];
}

function isBobberEntity(entity, bot) {
  if (!entity) return false;
  const raw = entity.name || (entity.entityType && entity.entityType.name) || entity.type;
  if (typeof raw === 'string') return BOBBER_NAMES.has(normalizeName(raw));
  const id = bot && bot.registry && bot.registry.entitiesByName && bot.registry.entitiesByName.fishing_bobber
    ? Number(bot.registry.entitiesByName.fishing_bobber.id)
    : 90;
  return Number.isFinite(id) && Number(raw) === id;
}

function findBobber(bot) {
  if (!bot || !bot.entities) return null;
  for (const entity of Object.values(bot.entities)) {
    if (isBobberEntity(entity, bot)) return entity;
  }
  return null;
}

// Mineflayer mendeteksi gigitan dari partikel "fishing"/"bubble" di sekitar
// bobber. Pakai aturan yang sama, tapi versi packet lama dan baru sama-sama
// diterima (amount vs particles, particle.type vs particleId).
function isBiteParticle(packet, bobber, bot) {
  if (!packet || !bobber || !bobber.position) return false;
  const amount = packet.amount === undefined ? packet.particles : packet.amount;
  if (!Number.isFinite(Number(amount)) || Number(amount) < 6) return false;
  if (!Number.isFinite(Number(packet.x)) || !Number.isFinite(Number(packet.z))) return false;

  let name = packet.particle;
  if (name && typeof name === 'object') name = name.type === undefined ? name.name : name.type;
  // Packet versi lama memakai particleId, versi baru memakai particle.type.
  if (name === undefined || name === null) name = packet.particleId;
  let match = false;
  if (typeof name === 'string') {
    match = /fishing|bubble/.test(normalizeName(name));
  } else if (name !== undefined && name !== null) {
    const registry = bot && bot.registry;
    const ids = ['fishing', 'bubble']
      .map((key) => registry && registry.particlesByName && registry.particlesByName[key])
      .map((entry) => (entry && typeof entry === 'object' ? entry.id : entry))
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));
    match = ids.includes(Number(name));
  }
  if (!match) return false;

  const dx = Number(packet.x) - bobber.position.x;
  const dz = Number(packet.z) - bobber.position.z;
  return Math.hypot(dx, dz) <= 1.23;
}

function duration(value, fallback, minimum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

function attachFishing(bot, config, logger, hooks = {}) {
  const settings = (config && config.fishing) || {};
  const log = logger || { debug() {}, info() {}, warn() {}, success() {} };
  const combatBusy = typeof hooks.combatBusy === 'function' ? hooks.combatBusy : () => false;
  function yielding() {
    try {
      return combatBusy() === true;
    } catch {
      return false;
    }
  }

  const rodNames = Array.isArray(settings.rodNames) ? settings.rodNames.map(String) : [];
  const loopMs = Math.max(100, duration(settings.loopMs, 500, 1));
  const biteTimeoutMs = Math.max(1000, duration(settings.biteTimeoutMs, 25000, 1));
  const castTimeoutMs = Math.min(biteTimeoutMs, Math.max(1000, duration(settings.castTimeoutMs, 4000, 1)));
  const reelDelayMs = Math.max(0, duration(settings.reelDelayMs, 800, 0));
  const equipRetryMs = Math.max(200, duration(settings.equipRetryMs, 1500, 1));

  const stats = {
    casts: 0,
    bites: 0,
    catches: 0,
    timeouts: 0,
    reels: 0,
    equips: 0,
    lastCatchAt: 0,
    lastActionAt: 0,
    lastError: null
  };

  let started = false;
  let rodName = null;
  let bobber = null;
  let casting = false;
  let castAt = 0;
  let nextCastAt = 0;
  let equipPending = false;
  let lastEquipAt = 0;
  const timers = new Set();
  const reported = new Set();

  function schedule(fn, ms) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  }

  function clearScheduled() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function report(key, level, message) {
    if (reported.has(key)) return;
    reported.add(key);
    log[level](message);
  }

  function rodHeld() {
    const held = bot && bot.heldItem;
    if (held && typeof held === 'object') {
      if (isFishingRod(held, rodNames)) {
        rodName = held.name || rodName;
        return true;
      }
      return false;
    }
    // heldItem undefined = informasi tidak tersedia; percayakan equip yang
    // baru saja berhasil selama beberapa detik seperti yang dilakukan combat.
    if (held === undefined && rodName && Date.now() - lastEquipAt < equipRetryMs) return true;
    return false;
  }

  function equipRod() {
    if (equipPending || Date.now() - lastEquipAt < equipRetryMs) return false;
    const rod = findFishingRod(bot, { names: rodNames });
    if (!rod) {
      report('no-rod', 'warn', 'pancingan tidak ada di inventory, auto-mancing menunggu');
      stats.lastError = 'pancingan tidak ditemukan di inventory';
      return false;
    }
    reported.delete('no-rod');
    lastEquipAt = Date.now();
    equipPending = true;
    try {
      const pending = bot.equip(rod.item || rod, 'hand');
      Promise.resolve(pending)
        .then(() => {
          rodName = rod.name || rodName;
          stats.equips += 1;
          stats.lastError = null;
          log.info(`pegang ${rod.label || rod.name || 'fishing_rod'} untuk auto-mancing`);
        })
        .catch((err) => {
          stats.lastError = `gagal pegang pancingan: ${err.message}`;
          report(`equip-${err.message}`, 'warn', stats.lastError);
        })
        .finally(() => {
          equipPending = false;
        });
    } catch (err) {
      equipPending = false;
      stats.lastError = `gagal pegang pancingan: ${err.message}`;
      report(`equip-${err.message}`, 'warn', stats.lastError);
    }
    return true;
  }

  function cast() {
    if (!rodHeld()) return false;
    try {
      bot.activateItem();
    } catch (err) {
      stats.lastError = `gagal melempar pancingan: ${err.message}`;
      report('cast-error', 'warn', stats.lastError);
      return false;
    }
    casting = true;
    castAt = Date.now();
    bobber = findBobber(bot);
    stats.casts += 1;
    stats.lastActionAt = Date.now();
    stats.lastError = null;
    return true;
  }

  function reel(reason) {
    if (rodHeld()) {
      try {
        bot.activateItem();
      } catch (err) {
        stats.lastError = `gagal menarik pancingan: ${err.message}`;
        report('reel-error', 'warn', stats.lastError);
      }
    }
    if (reason === 'bite') {
      stats.catches += 1;
      stats.lastCatchAt = Date.now();
      log.success(`ikan kena, pancingan ditarik (total ${stats.catches})`);
    } else if (reason === 'timeout') {
      stats.timeouts += 1;
      log.debug(`tidak ada gigitan dalam ${Math.round(biteTimeoutMs / 1000)}s, lempar lagi`);
    }
    casting = false;
    bobber = null;
    castAt = 0;
    nextCastAt = Date.now() + reelDelayMs;
    stats.reels += 1;
    stats.lastActionAt = Date.now();
  }

  function onParticle(packet) {
    if (!started || !casting || !bobber || yielding()) return;
    if (!isBiteParticle(packet, bobber, bot)) return;
    stats.bites += 1;
    reel('bite');
  }

  function onEntitySpawn(entity) {
    if (isBobberEntity(entity, bot)) bobber = entity;
  }

  function onEntityGone(entity) {
    if (bobber && entity && entity.id === bobber.id) bobber = null;
  }

  function listen() {
    if (bot && bot._client && typeof bot._client.on === 'function') {
      bot._client.on('world_particles', onParticle);
    }
    if (bot && typeof bot.on === 'function') {
      bot.on('entitySpawn', onEntitySpawn);
      bot.on('entityGone', onEntityGone);
    }
  }

  function unlisten() {
    if (bot && bot._client && typeof bot._client.removeListener === 'function') {
      bot._client.removeListener('world_particles', onParticle);
    }
    if (bot && typeof bot.removeListener === 'function') {
      bot.removeListener('entitySpawn', onEntitySpawn);
      bot.removeListener('entityGone', onEntityGone);
    }
  }

  function loop() {
    if (!started) return;
    if (!bot || !bot.entity) {
      schedule(loop, loopMs);
      return;
    }

    // Sedang duel: combat butuh tangan dan bidikan, jadi pancingan ditarik dulu.
    if (yielding()) {
      if (casting && rodHeld()) reel('combat');
      schedule(loop, Math.max(1000, loopMs * 2));
      return;
    }

    if (!rodHeld()) {
      casting = false;
      castAt = 0;
      bobber = null;
      equipRod();
      schedule(loop, equipRetryMs);
      return;
    }
    reported.delete('no-rod');

    const found = findBobber(bot);
    bobber = found;
    if (bobber && !casting) {
      // Bobber tertinggal (misal selesai makan), tarik dulu sebelum lempar lagi.
      // nextCastAt dicek supaya satu tarikan tidak terulang tiap loop sebelum
      // server sempat menghapus entity bobber lama.
      if (Date.now() >= nextCastAt) reel('orphan');
    } else if (!casting) {
      if (Date.now() >= nextCastAt) cast();
    } else if (bobber && Date.now() - castAt >= biteTimeoutMs) {
      reel('timeout');
    } else if (!bobber && Date.now() - castAt >= castTimeoutMs) {
      reel('miss');
    }
    schedule(loop, loopMs);
  }

  function start(force) {
    if (started) return;
    if (!settings.enabled && !force) return;
    started = true;
    listen();
    log.info(`auto-mancing aktif: cari pancingan di inventory (jeda ${Math.round(biteTimeoutMs / 1000)}s per lemparan)`);
    loop();
  }

  function stop() {
    if (!started) return;
    started = false;
    clearScheduled();
    unlisten();
    if (casting && rodHeld()) reel('stop');
    casting = false;
    bobber = null;
  }

  function setEnabled(value) {
    if (value) start(true);
    else stop();
  }

  function status() {
    const rod = findFishingRod(bot, { names: rodNames });
    return {
      enabled: started,
      rod: rod ? rod.label || rod.name : null,
      rodName: rod ? rod.name : null,
      held: rodHeld(),
      casting,
      bobber: bobber ? bobber.id : null,
      biteTimeoutMs,
      castTimeoutMs,
      reelDelayMs,
      stats: { ...stats }
    };
  }

  return {
    stats,
    start,
    stop,
    setEnabled,
    status,
    cast,
    reel,
    get enabled() { return started; },
    // Dipakai hook farm/anti-AFK: fitur dianggap sibuk hanya kalau agent aktif
    // DAN pancingan benar-benar ada di tangan. Tanpa pancingan, bot boleh
    // tetap panen/berjalan seperti biasa.
    get busy() { return started && rodHeld(); },
    get casting() { return casting; },
    get rod() { return rodName; }
  };
}

module.exports = {
  attachFishing,
  findFishingRod,
  isFishingRod,
  findBobber,
  isBobberEntity,
  isBiteParticle,
  DEFAULT_ROD_NAMES
};
