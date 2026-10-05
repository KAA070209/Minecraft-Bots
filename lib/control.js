'use strict';

const { formatDuration } = require('./logger');
const { getHealth, manualWalk, manualStop } = require('./behaviors');
const { inventoryReport } = require('./inventory');
const { solveOnce } = require('./chatgame');

const STOP_WORDS = new Set(['stop', 'cancel', 'batal', 'berhenti', 'off', 'mati']);
const START_WORDS = new Set(['on', 'jalan', 'start', 'nyalakan']);
const ALL_WORDS = new Set(['all', 'semua', '*']);

const COMMANDS = [
  { name: 'help', aliases: ['?', 'bantuan'], usage: 'help', summary: 'daftar perintah', target: 'none' },
  { name: 'status', aliases: ['st'], usage: 'status [nama|all]', summary: 'status koneksi semua bot', target: 'optional' },
  { name: 'pos', aliases: ['posisi'], usage: 'pos [nama|all]', summary: 'posisi, health, food, blok', target: 'optional' },
  { name: 'stats', aliases: ['statistik'], usage: 'stats [nama|all]', summary: 'statistik AFK, pukul, beli, panen', target: 'optional' },
  { name: 'look', aliases: ['putar', 'kepala'], usage: 'look [nama] <yaw> [pitch]', summary: 'putar kepala (derajat)', target: 'optional' },
  { name: 'walk', aliases: ['jalan', 'move'], usage: 'walk [nama] <arah> [ms]', summary: 'jalan: forward, back, left, right, jump, sneak, sprint', target: 'optional' },
  { name: 'halts', aliases: ['berhenti'], usage: 'halts [nama|all]', summary: 'hentikan semua gerakan', target: 'optional' },
  { name: 'idle', aliases: ['afk'], usage: 'idle [nama|all]', summary: 'faksa satu aksi anti-AFK sekarang', target: 'optional' },
  { name: 'eat', aliases: ['makan'], usage: 'eat [nama|all]', summary: 'faksa makan sekarang', target: 'optional' },
  { name: 'rescue', aliases: ['selamatkan'], usage: 'rescue [nama|all]', summary: 'cek bahaya lalu selamatkan bot', target: 'optional' },
  { name: 'attack', aliases: ['pukul', 'combat'], usage: 'attack [nama|all] [on|off]', summary: 'pukul mob otomatis', target: 'optional' },
  { name: 'buy', aliases: ['beli'], usage: 'buy [nama|all]', summary: 'beli daftar item shop sekarang', target: 'optional' },
  { name: 'dump', aliases: ['buang'], usage: 'dump [nama|all]', summary: 'buang isi inventory', target: 'optional' },
  { name: 'inv', aliases: ['invntori', 'inventory'], usage: 'inv [nama|all] [filter] [max]', summary: 'lihat isi inventory', target: 'optional' },
  { name: 'harvest', aliases: ['panen'], usage: 'harvest [nama|all] [on|stop]', summary: 'panen lahan sekarang / batalkan siklus', target: 'optional' },
  { name: 'farm', aliases: ['ladang'], usage: 'farm [nama|all] [on|off]', summary: 'status/nyalakan auto-panen', target: 'optional' },
  { name: 'stop', aliases: ['stopall'], usage: 'stop [nama|all]', summary: 'berhenti total: panen, pukul mob, gerakan', target: 'optional' },
  { name: 'say', aliases: ['chat', 'tell', 'sayall'], usage: 'say [nama|all] <pesan>', summary: 'kirim chat ke server', target: 'optional', broadcast: true },
  { name: 'solve', aliases: ['jawab'], usage: 'solve [nama] <pertanyaan>', summary: 'jawab soal lewat solver/AI (tidak kirim ke server)', target: 'optional', broadcast: true },
  { name: 'restart', aliases: ['reconnect'], usage: 'restart [nama|all]', summary: 'keluar lalu sambung ulang', target: 'optional' },
  { name: 'shutdown', aliases: ['kill', 'matikan'], usage: 'shutdown [nama]', summary: 'matikan satu bot (perlu start ulang proses)', target: 'optional' }
];

const COMMAND_INDEX = new Map();
for (const command of COMMANDS) {
  COMMAND_INDEX.set(command.name, command);
  for (const alias of command.aliases) COMMAND_INDEX.set(alias, command);
}

function findCommand(token) {
  const key = String(token || '').toLowerCase();
  return COMMAND_INDEX.get(key) || null;
}

function suggestCommand(token) {
  const key = String(token || '').toLowerCase();
  if (!key) return null;
  let best = null;
  for (const command of COMMANDS) {
    for (const candidate of [command.name, ...command.aliases]) {
      if (candidate.startsWith(key.slice(0, 3)) || key.startsWith(candidate.slice(0, 3))) {
        if (!best || command.name.length < best.name.length) best = command;
      }
    }
  }
  return best ? best.name : null;
}

function targetName(target) {
  return String((target && target.name) || 'unknown');
}

function matchTarget(targets, token) {
  const key = String(token || '').toLowerCase();
  return targets.find((target) => targetName(target).toLowerCase() === key) || null;
}

function running(target) {
  return target.runner && !target.runner.state.stopping;
}

function ok(lines) {
  return { ok: true, lines: Array.isArray(lines) ? lines : [lines] };
}

function fail(message) {
  return { ok: false, lines: [message] };
}

function statusDetail(target) {
  const state = target.runner ? target.runner.state : null;
  const bot = state ? state.bot : null;
  const config = targetConfig(target);
  const lines = [
    `status   : ${target.status || (state ? state.status : 'unknown')}`,
    `username : ${targetName(target)}`,
    `register : ${target.register || (state ? state.registerStatus : '-')}`,
    `joins    : ${target.joins !== undefined ? target.joins : state ? state.joins : 0}`
  ];
  if (config) lines.push(`server   : ${config.server.host}:${config.server.port}`);
  if (state) {
    lines.push(`uptime   : ${state.joinedAt ? formatDuration(Date.now() - state.joinedAt) : 'n/a'}`);
    lines.push(`reconnect: percobaan ${state.backoff.attempt}`);
  }
  if (bot) {
    lines.push(`versi    : ${bot.version}`);
    if (bot.entity) {
      lines.push(`dunia    : ${bot.game.dimension}`);
      lines.push(`chunk    : ${bot.entity.position.floored()}`);
      lines.push(`health   : ${getHealth(bot)}`);
      lines.push(`food     : ${bot.food}`);
    }
  }
  if (target.error) lines.push(`error    : ${target.error}`);
  return ok(lines);
}

function targetConfig(target) {
  if (target.config) return target.config;
  if (target.profile && target.profile.config) return target.profile.config;
  if (target.runner && target.runner.state && target.runner.state.config) return target.runner.state.config;
  return null;
}

function statusTable(targets) {
  const width = Math.max(...targets.map((target) => targetName(target).length), 4);
  const pad = (text, size) => String(text).padEnd(size);
  const padStart = (text, size) => String(text).padStart(size);
  const lines = [`${pad('BOT', width)}  ${pad('STATUS', 14)}${pad('REGISTER', 13)}${padStart('JOIN', 6)}${padStart('UPTIME', 11)}`];
  for (const target of targets) {
    const state = target.runner ? target.runner.state : null;
    const uptime = state && state.joinedAt && target.status === 'online' ? formatDuration(Date.now() - state.joinedAt) : '-';
    const register = target.register || (state ? state.registerStatus : '-');
    const joins = target.joins !== undefined ? target.joins : state ? state.joins : 0;
    lines.push(`${pad(targetName(target), width)}  ${pad(target.status || '-', 14)}${pad(register, 13)}${padStart(joins, 6)}${padStart(uptime, 11)}`);
  }
  const online = targets.filter((target) => target.status === 'online').length;
  const authed = targets.filter((target) => (target.register || (target.runner && target.runner.state.registerStatus)) === 'authenticated').length;
  lines.push(`${online}/${targets.length} online | ${authed} terautentikasi`);
  if (targets.some((target) => target.error)) {
    lines.push(`error: ${targets.filter((target) => target.error).map((target) => `${targetName(target)}: ${target.error}`).join(' | ')}`);
  }
  return ok(lines);
}

function positionLines(target) {
  const bot = target.runner && target.runner.state.bot;
  if (!bot || !bot.entity) return fail('bot belum punya koneksi');
  const position = bot.entity.position;
  const below = bot.blockAt(position.offset(0, -1, 0));
  return ok([
    `posisi  : ${position.floored()}`,
    `health  : ${getHealth(bot)}`,
    `food    : ${bot.food}`,
    `diatas  : ${bot.blockAt(position)?.name ?? '-'}`,
    `dibawah : ${below?.name ?? '-'}`
  ]);
}

function statsLines(target) {
  const state = target.runner ? target.runner.state : null;
  const behavior = state && state.behavior;
  const lines = [];
  if (behavior) {
    const s = behavior.stats;
    lines.push(
      `aksi idle   : ${s.idleActions}`,
      `lompat      : ${s.jumps}`,
      `ayunan arm  : ${s.swings}`,
      `jalan       : ${s.walks}`,
      `makan       : ${s.eats}`,
      `penyelamatan: ${s.resafes}`,
      `aksi terakhir: ${s.lastActionAt ? `${formatDuration(Date.now() - s.lastActionAt)} lalu` : '-'}`
    );
  }
  if (state && state.combat) {
    const c = state.combat.stats;
    lines.push(
      `pukul mob   : ${state.combat.enabled ? 'ON' : 'OFF'} | ${c.attacks} serangan / ${c.kills} knock | target ${c.lastTarget || '-'}`,
      `senjata     : ${state.combat.weapon || 'tangan kosong'}`,
      `aksi target : ${c.action || 'idle'} | jarak ${c.distance === null || c.distance === undefined ? '-' : `${c.distance} blok`} | macet ${c.stuck}`
    );
  }
  if (state && state.shop) {
    lines.push(`beli        : ${state.shop.stats.buys} item, buang ${state.shop.stats.drops} tumpukan`);
  }
  if (state && state.farm) {
    const f = state.farm.stats;
    lines.push(`panen       : ${f.harvests} tanaman (wortel ${f.carrots}), ambil ${f.pickups}, tanam ulang ${f.replants}`);
  }
  if (!lines.length) return fail('belum ada aksi yang tercatat');
  return ok(lines);
}

function attackLines(target, mode) {
  const combat = target.runner && target.runner.state.combat;
  if (!combat) return fail('fitur pukul mob belum siap');
  if (START_WORDS.has(mode)) combat.setEnabled(true);
  else if (STOP_WORDS.has(mode)) combat.stop();
  const c = combat.stats;
  return ok([
    `pukul mob ${combat.enabled ? 'ON' : 'OFF'}`,
    `aksi       : ${c.action || 'idle'}`,
    `jarak      : ${c.distance === null || c.distance === undefined ? '-' : `${c.distance} blok`}`,
    `target     : ${c.lastTarget || '-'}`,
    `senjata    : ${combat.weapon || 'tangan kosong'}`,
    `serangan=${c.attacks} knock=${c.kills} macet=${c.stuck}`
  ]);
}

function farmStatusLines(target) {
  const farm = target.runner && target.runner.state.farm;
  if (!farm) return fail('fitur panen belum siap');
  const info = farm.status();
  const lines = [
    `auto-panen  : ${info.enabled ? 'ON' : 'OFF'}${info.harvesting ? '  <- sedang panen sekarang' : ''}`,
    `area        : ${info.areaText || '-'}${info.areaConfigured ? '' : '  <- BELUM DIISI'}`,
    `jarak bot   : ${info.distance === null ? '-' : `${info.distance} blok`}`,
    `tanaman     : ${info.crops} siap${Object.keys(info.types || {}).length ? ` (${Object.entries(info.types).map(([key, count]) => `${key} ${count}`).join(', ')})` : ''}`,
    `filter crops: ${info.cropsFilter.join(', ')}`,
    `statistik   : panen=${info.stats.harvests} wortel=${info.stats.carrots} ambil=${info.stats.pickups} tanam-ulang=${info.stats.replants} scan=${info.stats.scans} cari-lahan=${info.stats.searches} jalan-memutar=${info.stats.detours || 0}`,
    `item jatuh  : ${info.pendingDrops || 0} hasil panen tertinggal di tanah`,
    `cache scan  : ${info.cachedCrops ? 'segar, dipakai ulang tanpa scan ulang' : 'basi, siklus depan scan lagi'}`,
    `cari lahan  : ${info.autoDiscover ? `ON (radius ${info.searchRadius} blok)` : 'OFF'}`
  ];
  if (info.stats.lastError) lines.push(`error       : ${info.stats.lastError}`);
  return ok(lines);
}

function farmLines(target, mode) {
  const farm = target.runner && target.runner.state.farm;
  if (!farm) return fail('fitur panen belum siap');
  if (START_WORDS.has(mode)) {
    farm.setEnabled(true);
    return ok([`auto-panen ${farm.enabled ? 'ON' : 'tidak menyala, cek farm.area di config.json'}`]);
  }
  if (STOP_WORDS.has(mode)) {
    farm.stop();
    return ok(['auto-panen OFF']);
  }
  return farmStatusLines(target);
}

function harvestLines(target, mode) {
  const farm = target.runner && target.runner.state.farm;
  if (!farm) return fail('fitur panen belum siap');
  if (STOP_WORDS.has(mode)) {
    const aborted = farm.abortHarvest();
    return ok([aborted ? 'siklus panen yang berjalan dibatalkan' : `tidak ada panen berjalan (auto-panen ${farm.enabled ? 'ON' : 'OFF'})`]);
  }
  if (START_WORDS.has(mode)) return farmLines(target, 'on');
  return farm.harvest().then(
    (done) => ok([done ? `${done} tanaman dipanen` : 'tidak ada tanaman siap panen']),
    (err) => fail(`panen gagal: ${err.message}`)
  );
}

function inventoryLines(target, args) {
  const bot = target.runner && target.runner.state.bot;
  if (!bot || !bot.inventory) return fail('bot belum punya koneksi');
  const limit = Number(args[args.length - 1]);
  const hasLimit = args.length > 0 && Number.isFinite(limit) && limit > 0;
  const report = inventoryReport(bot, {
    query: (hasLimit ? args.slice(0, -1) : args).join(' '),
    limit: hasLimit ? limit : undefined
  });
  return ok(report.lines);
}

function stopLines(target) {
  const state = target.runner && target.runner.state;
  const aborted = state && state.farm ? state.farm.abortHarvest() : false;
  if (state && state.farm) state.farm.stop();
  if (state && state.combat) state.combat.stop();
  const moved = manualStop(state ? state.bot : null);
  return ok([
    `panen      : ${aborted ? 'siklus berjalan dibatalkan' : 'dimatikan'}`,
    'auto-panen : OFF',
    `pukul mob  : OFF (serangan=${state && state.combat ? state.combat.stats.attacks : 0} knock=${state && state.combat ? state.combat.stats.kills : 0})`,
    `gerakan    : ${moved ? 'dihentikan' : 'tidak ada gerakan berjalan'}`
  ]);
}

function collectLogger(lines) {
  const push = (prefix) => (message) => lines.push(`${prefix}${message}`);
  return {
    info: push(''),
    warn: push('peringatan: '),
    error: push('error: '),
    success: push(''),
    debug: () => {}
  };
}

async function solveLines(target, question) {
  const config = targetConfig(target) || {};
  if (!question) return fail('isi pertanyaan: solve [nama] <pertanyaan>');
  const lines = [];
  const result = await solveOnce(question, config, collectLogger(lines));
  if (result.answer) lines.push(`jawaban: ${result.answer} (${result.source})`);
  else lines.push('tidak ada jawaban - cek MC_AI_ENDPOINT / MC_AI_KEY');
  return ok(lines);
}

async function runTarget(target, spec, args) {
  const state = target.runner ? target.runner.state : null;
  const bot = state ? state.bot : null;
  const behavior = state ? state.behavior : null;
  const command = spec.name;

  switch (command) {
    case 'status':
      return statusDetail(target);

    case 'pos':
      return positionLines(target);

    case 'stats':
      return statsLines(target);

    case 'look': {
      if (!bot || !bot.entity) return fail('bot belum punya koneksi');
      if (!args.length) return fail(`isi sudut: ${spec.usage}`);
      const yaw = (Number(args[0]) * Math.PI) / 180;
      const pitch = args[1] !== undefined ? (Number(args[1]) * Math.PI) / 180 : bot.entity.pitch;
      if (!Number.isFinite(yaw)) return fail(`yaw bukan angka: ${args[0]}`);
      bot.look(yaw, pitch, true);
      return ok([`kepala diputar ke yaw=${yaw.toFixed(2)} pitch=${pitch.toFixed(2)}`]);
    }

    case 'walk': {
      if (!args.length) return fail(`isi arah: ${spec.usage}`);
      const result = manualWalk(bot, args[0], args[1]);
      if (!result.ok) return fail(result.error);
      return ok([`jalan ${args[0]} selama ${result.ms}ms`]);
    }

    case 'halts': {
      const stopped = manualStop(bot);
      return ok([stopped ? 'semua gerakan dihentikan' : 'tidak ada gerakan berjalan']);
    }

    case 'idle': {
      if (!behavior) return fail('belum ada behavior (bot belum spawn)');
      behavior.idleAction();
      return ok(['aksi anti-AFK dipicu manual']);
    }

    case 'eat': {
      if (!behavior) return fail('belum ada behavior (bot belum spawn)');
      await behavior.eatIfNeeded();
      return ok(['cek makan selesai']);
    }

    case 'rescue': {
      if (!behavior) return fail('belum ada behavior (bot belum spawn)');
      behavior.rescueIfNeeded();
      return ok(['cek bahaya selesai']);
    }

    case 'attack':
      return attackLines(target, String(args[0] || '').toLowerCase());

    case 'buy': {
      const shop = state && state.shop;
      if (!shop) return fail('fitur shop belum siap');
      const bought = await shop.buy();
      return ok([bought ? `beli selesai: ${bought} item` : 'tidak ada yang dibeli (lihat log)']);
    }

    case 'dump': {
      const shop = state && state.shop;
      if (!shop) return fail('fitur shop belum siap');
      const result = await shop.dump();
      return ok([`${result.dropped} tumpukan dibuang (disimpan: ${result.kept.join(', ') || '-'})`]);
    }

    case 'inv':
      return inventoryLines(target, args);

    case 'harvest':
      return harvestLines(target, String(args[0] || '').toLowerCase());

    case 'farm':
      return farmLines(target, String(args[0] || '').toLowerCase());

    case 'stop':
      return stopLines(target);

    case 'say': {
      const message = args.join(' ').trim();
      if (!message) return fail(`isi pesan: ${spec.usage}`);
      if (!bot) return fail('bot belum punya koneksi');
      bot.chat(message);
      return ok([`chat dikirim: ${message}`]);
    }

    case 'solve':
      return solveLines(target, args.join(' ').trim());

    case 'restart': {
      if (!running(target)) return fail('bot tidak aktif');
      target.runner.reconnect('restart dari discord/api').catch(() => {});
      return ok(['restart diminta, sambung ulang...']);
    }

    case 'shutdown': {
      if (!running(target)) return fail('bot tidak aktif');
      target.runner.shutdown('dimatikan dari discord/api').catch(() => {});
      return ok(['bot dimatikan, jalankan ulang proses untuk menyalakan lagi']);
    }

    default:
      return fail(`perintah "${command}" belum punya aksi`);
  }
}

function helpLines() {
  return COMMANDS.map((command) => `${command.usage.padEnd(30)}${command.summary}`);
}

function describeCommands() {
  return COMMANDS.map((command) => ({
    name: command.name,
    aliases: command.aliases,
    usage: command.usage,
    summary: command.summary
  }));
}

function selectTargets(targets, spec, tokens) {
  const first = tokens[0];
  const explicit = matchTarget(targets, first);
  const all = ALL_WORDS.has(String(first || '').toLowerCase());

  if (explicit) return { selected: [explicit], args: tokens.slice(1) };
  if (all) return { selected: targets.slice(), args: tokens.slice(1) };
  if (targets.length === 1) return { selected: targets.slice(), args: tokens.slice() };
  if (spec.target === 'optional') return { selected: targets.slice(), args: tokens.slice() };
  return { selected: null, args: tokens.slice(), error: `perintah "${spec.name}" butuh nama bot: ${spec.usage}` };
}

function createController({ getTargets, onEvent } = {}) {
  const list = () => (typeof getTargets === 'function' ? getTargets() || [] : []);

  async function execute(line) {
    const tokens = String(line || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!tokens.length) {
      return { ok: true, command: 'help', targets: [], results: [{ name: '-', ok: true, lines: helpLines() }] };
    }

    const name = tokens[0].toLowerCase();
    const spec = findCommand(name);
    if (!spec) {
      const hint = suggestCommand(name);
      const line1 = `perintah tidak dikenal: ${name}`;
      const line2 = hint ? `mungkin maksudmu "${hint}"? ketik help` : 'ketik help untuk daftar perintah';
      if (onEvent) onEvent('unknown-command', { command: name });
      return { ok: false, command: name, targets: [], error: line1, results: [{ name: '-', ok: false, lines: [line1, line2] }] };
    }

    if (spec.target === 'none') {
      const lines = spec.name === 'help' ? helpLines() : [];
      return { ok: true, command: spec.name, targets: [], results: [{ name: '-', ok: true, lines }] };
    }

    const targets = list();
    if (!targets.length) {
      return { ok: false, command: spec.name, targets: [], error: 'tidak ada bot yang bisa dikontrol', results: [] };
    }

    const rest = tokens.slice(1);
    let selected;
    let args;

    if (spec.broadcast && !matchTarget(targets, rest[0]) && !ALL_WORDS.has(String(rest[0] || '').toLowerCase())) {
      selected = targets.slice();
      args = rest.slice();
    } else {
      const picked = selectTargets(targets, spec, rest);
      if (picked.error) {
        return { ok: false, command: spec.name, targets: [], error: picked.error, results: [] };
      }
      selected = picked.selected;
      args = picked.args;
    }

    if (onEvent) onEvent('command', { command: spec.name, targets: selected.map(targetName) });

    if (spec.name === 'status' && selected.length > 1 && !args.length) {
      return { ok: true, command: spec.name, targets: selected.map(targetName), results: [{ name: '-', ok: true, lines: statusTable(selected).lines }] };
    }

    const results = [];
    for (const target of selected) {
      let result;
      try {
        result = await runTarget(target, spec, args);
      } catch (err) {
        result = fail(`perintah "${spec.name}" gagal: ${err.message}`);
      }
      results.push({ name: targetName(target), ok: result.ok, lines: result.lines });
    }

    return {
      ok: results.every((result) => result.ok),
      command: spec.name,
      targets: results.map((result) => result.name),
      results
    };
  }

  return { execute, help: helpLines, commands: describeCommands, targets: list };
}

module.exports = { createController, COMMANDS, findCommand, helpLines, describeCommands };