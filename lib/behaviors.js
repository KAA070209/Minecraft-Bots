'use strict';

const mcData = require('minecraft-data');
const { Vec3 } = require('vec3');

const LAVA_BLOCKS = new Set(['lava', 'flowing_lava', 'magma_block']);
const HAZARD_BLOCKS = new Set([
  'lava', 'flowing_lava', 'fire', 'soul_fire', 'magma_block', 'cactus', 'campfire',
  'soul_campfire', 'powder_snow', 'sweet_berry_bush', 'wither_rose', 'pointed_dripstone',
  'end_portal', 'nether_portal', 'end_gateway'
]);
const WATER_BLOCKS = new Set(['water', 'flowing_water']);

const AIR_BLOCKS = new Set(['air', 'cave_air', 'void_air']);

function isFreeSpace(name) {
  if (!name) return false;
  if (HAZARD_BLOCKS.has(name)) return false;
  return AIR_BLOCKS.has(name);
}

function isSolidGround(name) {
  if (!name) return false;
  if (HAZARD_BLOCKS.has(name)) return false;
  return !AIR_BLOCKS.has(name) && !WATER_BLOCKS.has(name);
}

function getHealth(bot) {
  if (typeof bot.health === 'number') return bot.health;
  if (bot.entity && typeof bot.entity.health === 'number') return bot.entity.health;
  return null;
}

function foodScore(entry) {
  if (!entry) return null;
  if (typeof entry === 'number') return { points: entry, quality: entry };
  const points = entry.foodPoints;
  if (typeof points !== 'number') return null;
  const quality = typeof entry.effectiveQuality === 'number' ? entry.effectiveQuality : points;
  return { points, quality };
}

function findBestFood(bot) {
  let table = {};
  try {
    table = mcData(bot.version).foodsByName || {};
  } catch {
    table = {};
  }
  let best = null;
  for (const item of bot.inventory.items()) {
    const score = foodScore(table[item.name]);
    if (!score || item.count <= 0) continue;
    if (!best || score.points > best.points || (score.points === best.points && score.quality > best.quality)) {
      best = { item, points: score.points, quality: score.quality };
    }
  }
  return best;
}

function findSafeSpot(bot, radius = 3) {
  const position = bot.entity.position;
  const base = position.floored();
  const offsets = [[0, 0]];
  for (let ring = 1; ring <= radius; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        offsets.push([dx, dz]);
      }
    }
  }
  for (const [dx, dz] of offsets) {
    const x = base.x + dx;
    const y = base.y;
    const z = base.z + dz;
    const below = bot.blockAt(new Vec3(x, y - 1, z));
    const feet = bot.blockAt(new Vec3(x, y, z));
    const head = bot.blockAt(new Vec3(x, y + 1, z));
    if (!isSolidGround(below ? below.name : null)) continue;
    if (!isFreeSpace(feet ? feet.name : null)) continue;
    if (!isFreeSpace(head ? head.name : null)) continue;
    return new Vec3(x + 0.5, y, z + 0.5);
  }
  return null;
}

function hazardAt(bot) {
  const feet = bot.blockAt(bot.entity.position.floored());
  if (!feet) return null;
  if (LAVA_BLOCKS.has(feet.name)) return 'lava';
  if (WATER_BLOCKS.has(feet.name)) return 'water';
  if (feet.name === 'fire' || feet.name === 'soul_fire') return 'fire';
  return null;
}

const DIRECTIONS = {
  forward: 'forward', fwd: 'forward', maju: 'forward', jalan: 'forward',
  back: 'back', backward: 'back', mundur: 'back', belakang: 'back',
  left: 'left', kiri: 'left',
  right: 'right', kanan: 'right',
  sprint: 'sprint', lari: 'sprint',
  sneak: 'sneak', jongkok: 'sneak',
  jump: 'jump', lompat: 'jump'
};

const manualTimers = new WeakMap();

function manualStop(bot) {
  if (!bot) return false;
  const timer = manualTimers.get(bot);
  if (timer) clearTimeout(timer);
  manualTimers.delete(bot);
  try {
    bot.clearControlStates();
  } catch {
    /* bot already closed */
  }
  return Boolean(timer);
}

function manualWalk(bot, input, durationMs) {
  if (!bot || !bot.entity) return { ok: false, error: 'bot belum login' };
  const state = DIRECTIONS[String(input || '').toLowerCase()];
  if (!state) return { ok: false, error: `arah tidak dikenal: ${input} (pilihan: ${[...new Set(Object.values(DIRECTIONS))].join(', ')})` };
  const ms = Math.min(60000, Math.max(100, Number(durationMs) || 2000));
  manualStop(bot);
  bot.setControlState(state, true);
  if (state === 'forward' || state === 'back') bot.setControlState('sprint', true);
  manualTimers.set(bot, setTimeout(() => manualStop(bot), ms));
  return { ok: true, state, ms };
}

function attachBehaviors(bot, config, logger) {
  const timers = [];
  let started = false;
  const stats = {
    idleActions: 0,
    jumps: 0,
    swings: 0,
    walks: 0,
    eats: 0,
    rescues: 0,
    lastActionAt: Date.now()
  };

  const setTimer = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    const index = timers.indexOf(timer);
    if (index !== -1) timers.splice(index, 1);
  };

  function randomBetween(min, max) {
    return min + Math.random() * Math.max(0, max - min);
  }

  function lookAround() {
    const { yawStepDeg, pitchMinDeg, pitchMaxDeg } = config.afk;
    const step = ((Math.random() * 2 - 1) * yawStepDeg * Math.PI) / 180;
    const pitch = ((pitchMinDeg + Math.random() * (pitchMaxDeg - pitchMinDeg)) * Math.PI) / 180;
    void bot.look(bot.entity.yaw + step, pitch, true);
  }

  function tryJump() {
    if (!bot.entity.onGround) return;
    if (Math.random() > config.afk.jumpChance) return;
    const below = bot.blockAt(bot.entity.position.offset(0, -0.2, 0));
    if (!isSolidGround(below ? below.name : null)) return;
    bot.setControlState('jump', true);
    setTimer(() => bot.setControlState('jump', false), 120);
    stats.jumps += 1;
  }

  function tryWalk() {
    const spot = findSafeSpot(bot, 2);
    if (!spot) return;
    void bot.lookAt(spot, true);
    bot.setControlState('forward', true);
    setTimer(() => bot.setControlState('forward', false), 450);
    stats.walks += 1;
  }

  function idleAction() {
    const mode = config.afk.mode;
    lookAround();
    if (config.afk.swingArm) {
      bot.swingArm(Math.random() < 0.5 ? 'right' : 'left', true);
      stats.swings += 1;
    }
    if (mode === 'wander') tryWalk();
    if (mode !== 'look') tryJump();
    stats.idleActions += 1;
    stats.lastActionAt = Date.now();
  }

  function scheduleIdle() {
    const delay = randomBetween(config.afk.minIntervalMs, config.afk.maxIntervalMs);
    setTimer(() => {
      if (!bot.entity) return;
      idleAction();
      scheduleIdle();
    }, delay);
  }

  async function eatIfNeeded() {
    if (!config.survival.autoEat) return;
    const health = getHealth(bot);
    const hungry = typeof bot.food === 'number' && bot.food < config.survival.eatBelowFood;
    const hurt = typeof health === 'number' && health < config.survival.eatBelowHealth;
    if (!hungry && !hurt) return;
    const best = findBestFood(bot);
    if (!best) {
      if (stats.idleActions % 10 === 0) logger.debug(`lapar (food=${bot.food}, health=${health}) tapi tidak ada makanan`);
      return;
    }
    try {
      await bot.equip(best.item, 'hand');
      await bot.consume();
      stats.eats += 1;
      logger.info(`makan ${best.item.name} x${best.item.count} (food=${bot.food}, health=${getHealth(bot)})`);
    } catch (err) {
      logger.debug(`gagal makan: ${err.message}`);
    }
  }

  function rescueIfNeeded() {
    if (!config.survival.rescue || !bot.entity) return;
    const hazard = hazardAt(bot);
    if (!hazard) return;
    const spot = findSafeSpot(bot, 4);
    if (!spot) {
      logger.warn(`berada di ${hazard} dan tidak ada tempat aman di sekitar`);
      return;
    }
    stats.resafes += 1;
    logger.warn(`berada di ${hazard}, mencoba ke lokasi aman (${spot.x}, ${spot.y}, ${spot.z})`);
    if (hazard === 'water') {
      void bot.look(bot.entity.yaw, -Math.PI / 2, true);
      bot.setControlState('jump', true);
      setTimer(() => bot.setControlState('jump', false), 1500);
    } else {
      void bot.lookAt(spot, true);
      bot.setControlState('forward', true);
      setTimer(() => bot.setControlState('forward', false), 1200);
    }
  }

  function start() {
    if (started) return;
    started = true;
    scheduleIdle();
    setTimer(() => {
      eatIfNeeded().catch(() => {});
    }, 4000);
    setTimer(function poll() {
      eatIfNeeded().catch(() => {});
      rescueIfNeeded();
      const health = getHealth(bot);
      if (config.survival.lowHealthQuit > 0 && typeof health === 'number' && health <= config.survival.lowHealthQuit) {
        logger.error(`darurat: health=${health} <= ${config.survival.lowHealthQuit}, keluar dari server`);
        bot.quit('low health safety');
        return;
      }
      setTimer(poll, 4000);
    }, 4000);
  }

  if (bot.entity && bot.entity.position) start();
  else bot.once('spawn', start);

  bot.on('physicsTick', () => {
    if (bot.entity && bot.entity.velocity && bot.entity.velocity.y < -0.8 && !bot.entity.onGround) {
      stats.lastActionAt = Date.now();
    }
  });

  return {
    stats,
    idleAction,
    eatIfNeeded,
    rescueIfNeeded,
    stop() {
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;
      try {
        bot.clearControlStates();
      } catch {
        /* bot already closed */
      }
    }
  };
}

module.exports = { attachBehaviors, findSafeSpot, findBestFood, foodScore, getHealth, isFreeSpace, isSolidGround, manualWalk, manualStop, DIRECTIONS };
