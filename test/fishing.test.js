'use strict';

const EventEmitter = require('events');
const assert = require('assert');
const { Vec3 } = require('vec3');

const {
  attachFishing,
  findFishingRod,
  isFishingRod,
  findBobber,
  isBobberEntity,
  isBiteParticle
} = require('../lib/fishing');
const { attachFarm } = require('../lib/farm');
const { attachBehaviors } = require('../lib/behaviors');
const { loadConfig } = require('../lib/config');

let checks = 0;
function check(label, condition, extra) {
  checks += 1;
  assert.ok(condition, `${label}${extra ? ` (${extra})` : ''}`);
}

function quietLogger() {
  return { debug() {}, info() {}, warn() {}, success() {} };
}

function captureLogger(sink) {
  return {
    debug: (message) => sink.push(['debug', message]),
    info: (message) => sink.push(['info', message]),
    warn: (message) => sink.push(['warn', message]),
    success: (message) => sink.push(['success', message])
  };
}

function makeBot(items = [{ name: 'fishing_rod', slot: 10, count: 1 }]) {
  const bot = new EventEmitter();
  bot.entity = { id: 0, position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0, onGround: true };
  bot.entities = {};
  bot.inventory = { items: () => items };
  bot.heldItem = null;
  bot.equipped = [];
  bot.activations = [];
  bot.moves = [];
  bot.casting = false;
  bot.look = () => Promise.resolve();
  bot.lookAt = () => Promise.resolve();
  bot.clearControlStates = () => { bot.moves.length = 0; };
  bot.quit = () => {};
  bot._client = new EventEmitter();
  bot.equip = (item) => {
    bot.equipped.push(item.name);
    bot.heldItem = item;
    return Promise.resolve();
  };
  bot.activateItem = () => {
    if (bot.casting) {
      bot.activations.push('reel');
      const old = bot.entities[77];
      bot.casting = false;
      delete bot.entities[77];
      if (old) bot.emit('entityGone', old);
      return;
    }
    bot.activations.push('cast');
    bot.casting = true;
    const bobber = { id: 77, name: 'fishing_bobber', position: new Vec3(3.5, 64, 3.5) };
    bot.entities[77] = bobber;
    bot.emit('entitySpawn', bobber);
  };
  return bot;
}

const wait = (ms = 130) => new Promise((resolve) => setTimeout(resolve, ms));

process.stdout.write('\n');
process.stdout.write('[fishing] cari pancingan di inventory\n');
{
  check('nama item dikenali', isFishingRod({ name: 'fishing_rod' }) === true);
  check('displayName dikenali', isFishingRod({ name: 'minecraft:fishing_rod', displayName: 'Fishing Rod' }) === true);
  check('alias pancingan dikenali', isFishingRod({ name: 'pancingan' }) === true);
  check('nama custom dari config dipakai', isFishingRod({ name: 'server_rod' }, ['server_rod']) === true);
  check('item biasa bukan pancingan', isFishingRod({ name: 'stone_sword' }) === false);
  check('item tanpa nama ditolak', isFishingRod({}) === false);

  const items = [
    { name: 'dirt', slot: 0 },
    { name: 'fishing_rod', slot: 5 },
    { name: 'fishing_rod', slot: 12 }
  ];
  const rod = findFishingRod(makeBot(items));
  check('pancingan ditemukan', Boolean(rod) && rod.slot === 12, rod ? String(rod.slot) : 'null');
  check('slot hotbar lebih diprioritaskan', findFishingRod(makeBot([
    { name: 'fishing_rod', slot: 0 },
    { name: 'fishing_rod', slot: 10 }
  ])).slot === 10);
  check('tanpa pancingan = null', findFishingRod(makeBot([{ name: 'dirt', slot: 0 }])) === null);
  check('bot tanpa inventory tidak crash', findFishingRod({}) === null);
}

process.stdout.write('\n');
process.stdout.write('[fishing] bobber + partikel gigitan\n');
{
  check('bobber dikenali dari nama', isBobberEntity({ name: 'fishing_bobber' }) === true);
  check('bobber dikenali dari entityType', isBobberEntity({ entityType: { name: 'fishing_bobber' } }) === true);
  check('mob biasa bukan bobber', isBobberEntity({ name: 'zombie' }) === false);
  check('id registry dipakai', isBobberEntity({ type: 91 }, {
    registry: { entitiesByName: { fishing_bobber: { id: 91 } } }
  }) === true);
  check('id 90 dipakai kalau registry tidak ada', isBobberEntity({ type: 90 }) === true);

  const bot = makeBot();
  bot.entities = { 77: { id: 77, name: 'fishing_bobber', position: new Vec3(3.5, 64, 3.5) } };
  check('findBobber hasilkan entity', findBobber(bot).id === 77);
  check('tanpa bobber = null', findBobber(makeBot()) === null);
  check('objek tanpa entities aman', findBobber({}) === null);

  const registryBot = { registry: { particlesByName: { fishing: { id: 31 }, bubble: 34 } } };
  const point = bot.entities[77];
  check('partikel fishing diterima', isBiteParticle({ particle: 'fishing', amount: 8, x: 3.5, z: 3.5 }, point, registryBot) === true);
  check('partikel bubble lewat objek diterima', isBiteParticle({ particle: { type: 'bubble' }, particles: 6, x: 4, z: 4 }, point, registryBot) === true);
  check('id partikel numerik diterima', isBiteParticle({ particleId: 31, amount: 8, x: 3, z: 3 }, point, registryBot) === true);
  check('jumlah partikel kurang ditolak', isBiteParticle({ particle: 'fishing', amount: 5, x: 3.5, z: 3.5 }, point, registryBot) === false);
  check('partikel jauh ditolak', isBiteParticle({ particle: 'fishing', amount: 8, x: 20, z: 20 }, point, registryBot) === false);
  check('partikel lain ditolak', isBiteParticle({ particle: 'smoke', amount: 8, x: 3.5, z: 3.5 }, point, registryBot) === false);
  check('tanpa bobber tidak ada gigitan', isBiteParticle({ particle: 'fishing', amount: 8, x: 3.5, z: 3.5 }, null, registryBot) === false);
}

process.stdout.write('\n');
process.stdout.write('[fishing] konfigurasi + perlindungan pancingan\n');
{
  check('fishing default aktif', loadConfig([], {}).fishing.enabled === true);
  check('MC_FISHING=0 mematikan', loadConfig([], { MC_FISHING: '0' }).fishing.enabled === false);
  check('--noFishing mematikan', loadConfig(['--noFishing'], {}).fishing.enabled === false);
  check('--no-fishing juga diterima', loadConfig(['--no-fishing'], {}).fishing.enabled === false);
  check('--fishing menyalakan walau env mati', loadConfig(['--fishing'], { MC_FISHING: '0' }).fishing.enabled === true);

  const custom = loadConfig([], {
    MC_CONFIG_JSON: JSON.stringify({ fishing: { loopMs: 1, biteTimeoutMs: 10, reelDelayMs: -2, rodNames: ['', 'server_rod'] } })
  });
  check('loopMs minimal 100', custom.fishing.loopMs === 100, String(custom.fishing.loopMs));
  check('biteTimeoutMs minimal 1000', custom.fishing.biteTimeoutMs === 1000, String(custom.fishing.biteTimeoutMs));
  check('reelDelayMs tidak negatif', custom.fishing.reelDelayMs === 0, String(custom.fishing.reelDelayMs));
  check('rodNames dibersihkan', JSON.stringify(custom.fishing.rodNames) === '["server_rod"]', JSON.stringify(custom.fishing.rodNames));
  check('pancingan masuk shop.keep saat aktif', custom.shop.keep.includes('fishing_rod'), JSON.stringify(custom.shop.keep));

  const off = loadConfig([], { MC_FISHING: '0' });
  check('pancingan tidak masuk keep saat dimatikan', !off.shop.keep.includes('fishing_rod'), JSON.stringify(off.shop.keep));
  const again = loadConfig([], {});
  check('loadConfig berikutnya tidak mewarisi keep', again.shop.keep.filter((name) => name === 'fishing_rod').length === 1, JSON.stringify(again.shop.keep));
}

process.stdout.write('\n');
process.stdout.write('[fishing] profil multi-bot\n');
{
  const { loadProfiles, validateProfile } = require('../lib/profiles');
  check('fishing.enabled non-boolean ditolak', validateProfile({ name: 'Azka01', fishing: { enabled: 'ya' } }, 0).some((error) => error.includes('fishing.enabled')));
  check('fishing.rodNames bukan array ditolak', validateProfile({ name: 'Azka01', fishing: { rodNames: 'pancing' } }, 0).some((error) => error.includes('fishing.rodNames')));
  check('fishing.biteTimeoutMs negatif ditolak', validateProfile({ name: 'Azka01', fishing: { biteTimeoutMs: -1 } }, 0).some((error) => error.includes('fishing.biteTimeoutMs')));
  check('fishing valid diterima', validateProfile({ name: 'Azka01', fishing: { enabled: false, rodNames: ['server_rod'], loopMs: 250 } }, 0).length === 0);

  const profiles = loadProfiles('profiles.json', {
    env: {
      MC_PROFILES_JSON: JSON.stringify({
        profiles: [{ name: 'Azka01', fishing: { enabled: false, biteTimeoutMs: 12000 } }]
      })
    }
  }).profiles;
  check('override fishing per profil dipakai', profiles[0].config.fishing.enabled === false);
  check('override fishing per profil lengkap', profiles[0].config.fishing.biteTimeoutMs === 12000, String(profiles[0].config.fishing.biteTimeoutMs));
}

async function agentTests() {
  process.stdout.write('\n');
  process.stdout.write('[fishing] agent: cari, pegang, lempar, gigitan, timeout, stop\n');
  const rod = { name: 'fishing_rod', slot: 10, count: 1 };
  const bot = makeBot([{ name: 'dirt', slot: 0 }, rod]);
  bot.registry = { particlesByName: { fishing: { id: 31 }, bubble: 34 } };
  const messages = [];
  let busy = false;
  const agent = attachFishing(bot, {
    fishing: {
      enabled: true,
      loopMs: 100,
      equipRetryMs: 200,
      castTimeoutMs: 1000,
      biteTimeoutMs: 1000,
      reelDelayMs: 200
    }
  }, captureLogger(messages), { combatBusy: () => busy });

  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    check('agent belum jalan sebelum start', agent.enabled === false);
    check('belum memegang pancingan sebelum start', bot.heldItem === null);
    check('belum sibuk sebelum start', agent.busy === false);
    agent.start();
    check('start menyalakan agent', agent.enabled === true);

    await wait(230);
    check('pancingan di inventory dipegang', bot.heldItem === rod, bot.heldItem && bot.heldItem.name);
    check('agent sibuk saat pancingan di tangan', agent.busy === true);
    check('equip tercatat', agent.stats.equips === 1, String(agent.stats.equips));
    check('langsung melempar setelah pegang', agent.casting === true && agent.stats.casts === 1, String(agent.stats.casts));
    check('bobber muncul di entity', findBobber(bot) !== null);

    bot._client.emit('world_particles', { particle: 'fishing', amount: 8, x: 20, z: 20 });
    check('partikel jauh tidak dihitung gigitan', agent.stats.bites === 0, String(agent.stats.bites));
    bot._client.emit('world_particles', { particle: 'fishing', amount: 8, x: 3.5, z: 3.5 });
    check('gigitan terdeteksi', agent.stats.bites === 1 && agent.stats.catches === 1, String(agent.stats.catches));
    check('pancingan ditarik saat gigitan', bot.activations.includes('reel'), JSON.stringify(bot.activations));
    check('bobber hilang setelah ditarik', findBobber(bot) === null);
    check('status casting mati', agent.casting === false);

    await wait();
    check('tidak cast ulang sebelum jeda reel', agent.stats.casts === 1, String(agent.stats.casts));
    now += 200;
    await wait();
    check('cast ulang setelah jeda', agent.stats.casts === 2 && agent.casting === true, String(agent.stats.casts));

    bot._client.emit('world_particles', { particleId: 31, amount: 7, x: 3.4, z: 3.6 });
    check('id partikel numerik memicu gigitan', agent.stats.catches === 2, String(agent.stats.catches));

    now += 200;
    await wait();
    check('cast lagi sebelum timeout', agent.casting === true && agent.stats.casts === 3, String(agent.stats.casts));
    now += 1000;
    await wait();
    check('timeout menarik pancingan', agent.stats.timeouts === 1 && agent.casting === false, String(agent.stats.timeouts));

    now += 200;
    await wait();
    check('cast lagi setelah timeout', agent.casting === true && agent.stats.casts === 4, String(agent.stats.casts));
    busy = true;
    const reelsBefore = agent.stats.reels;
    await wait();
    check('combat mengambil alih tangan', agent.casting === false, String(agent.casting));
    check('tarikan saat combat tercatat', agent.stats.reels > reelsBefore, `${reelsBefore} -> ${agent.stats.reels}`);
    check('tidak ada ikan baru saat combat', agent.stats.catches === 2, String(agent.stats.catches));
    busy = false;

    const info = agent.status();
    check('status melaporkan pancingan', info.rod === 'fishing_rod' && info.held === true, JSON.stringify(info.rod));
    check('status menyalin statistik', info.stats.casts === agent.stats.casts, String(info.stats.casts));

    agent.stop();
    check('stop mematikan agent', agent.enabled === false && agent.casting === false);
    check('stop melepaskan kunci fitur lain', agent.busy === false);
    const bitesAtStop = agent.stats.bites;
    const castsAtStop = agent.stats.casts;
    bot._client.emit('world_particles', { particle: 'fishing', amount: 8, x: 3.5, z: 3.5 });
    check('listener dilepas saat stop', agent.stats.bites === bitesAtStop, String(agent.stats.bites));
    await wait();
    check('loop berhenti saat stop', agent.stats.casts === castsAtStop, String(agent.stats.casts));
  } finally {
    Date.now = realNow;
    agent.stop();
  }

  process.stdout.write('\n');
  process.stdout.write('[fishing] agent: tanpa pancingan + nyala/mati manual\n');
  const empty = makeBot([{ name: 'dirt', slot: 0 }]);
  const idle = attachFishing(empty, { fishing: { enabled: true, loopMs: 100 } }, captureLogger(messages));
  idle.start();
  await wait();
  check('tanpa pancingan tidak melempar', idle.stats.casts === 0 && idle.stats.catches === 0, String(idle.stats.casts));
  check('tidak ada activateItem tanpa pancingan', empty.activations.length === 0, JSON.stringify(empty.activations));
  check('tanpa pancingan tidak mengunci farm/anti-AFK', idle.busy === false);
  check('status tanpa pancingan', idle.status().rod === null && idle.status().held === false);
  check('alasan ditulis di statistik', /pancingan/.test(idle.stats.lastError || ''), String(idle.stats.lastError));
  idle.stop();

  const offBot = makeBot();
  const offAgent = attachFishing(offBot, { fishing: { enabled: false } }, quietLogger());
  offAgent.start();
  check('enabled=false tidak menyala', offAgent.enabled === false);
  offAgent.setEnabled(true);
  check('setEnabled(true) menyalakan paksa', offAgent.enabled === true);
  offAgent.setEnabled(false);
  check('setEnabled(false) mematikan', offAgent.enabled === false);
}

async function hookTests() {
  process.stdout.write('\n');
  process.stdout.write('[fishing] fitur lain mengalah saat pancingan aktif\n');
  {
    const world = new Map();
    for (let x = 0; x <= 3; x += 1) {
      world.set(`${x},63,0`, 'farmland');
      world.set(`${x},64,0`, 'carrots');
    }
    const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
    let digs = 0;
    const bot = makeBot();
    bot.blockAt = (position) => {
      const name = world.get(key(position));
      return name ? { name } : null;
    };
    bot.dig = () => { digs += 1; return Promise.resolve(); };

    const messages = [];
    const farm = attachFarm(bot, {
      farm: {
        enabled: false, area: { x: 1, y: 64, z: 0, radius: 4 }, crops: ['carrots'],
        replant: false, useTool: false
      }
    }, captureLogger(messages), { fishingBusy: () => true });
    check('panen manual dilewati saat fishing', (await farm.harvest()) === 0);
    check('tidak ada tanaman dipotong saat fishing', digs === 0, String(digs));
    check('alasan panen ditunda jelas', messages.some(([, text]) => /auto-mancing/.test(text)), messages.map(([, text]) => text).join(' | '));
    farm.stop();
  }

  {
    const bot = makeBot();
    bot.blockAt = (position) => ({ name: position.y < 64 ? 'stone' : 'air' });
    bot.swingArm = () => { bot.swings = (bot.swings || 0) + 1; };
    bot.setControlState = (state, value) => { if (value) bot.moves.push(state); };
    bot.moves.length = 0;
    let fishing = true;
    const config = {
      afk: {
        mode: 'wander', yawStepDeg: 30, pitchMinDeg: -20, pitchMaxDeg: 20,
        swingArm: true, jumpChance: 1, minIntervalMs: 100000, maxIntervalMs: 100000
      },
      survival: { autoEat: false, rescue: false, eatBelowFood: 0, eatBelowHealth: 0, lowHealthQuit: 0 }
    };
    const behavior = attachBehaviors(bot, config, quietLogger(), { fishingBusy: () => fishing });
    const before = { ...behavior.stats };
    behavior.idleAction();
    check('idle action tetap jalan saat fishing', behavior.stats.idleActions === before.idleActions + 1, String(behavior.stats.idleActions));
    check('kepala tetap diputar anti-AFK', bot.entity.yaw !== 0 || bot.entity.pitch !== 0, `${bot.entity.yaw} ${bot.entity.pitch}`);
    check('tangan tidak diayunkan saat fishing', behavior.stats.swings === 0, String(behavior.stats.swings));
    check('kaki tidak digerakkan saat fishing', behavior.stats.walks === 0 && behavior.stats.jumps === 0 && bot.moves.length === 0, JSON.stringify(bot.moves));

    fishing = false;
    behavior.idleAction();
    check('ayunan tangan jalan lagi tanpa fishing', behavior.stats.swings === 1, String(behavior.stats.swings));
    check('jalan+lompat jalan lagi tanpa fishing', behavior.stats.walks === 1 && behavior.stats.jumps === 1, `${behavior.stats.walks}/${behavior.stats.jumps}`);
    behavior.stop();
  }
}

async function main() {
  await agentTests();
  await hookTests();
  process.stdout.write(`\nfishing: ${checks} test lolos\n`);
}

main().catch((err) => {
  process.stderr.write(`\nfishing: GAGAL - ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
