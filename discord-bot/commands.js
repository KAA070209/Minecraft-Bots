'use strict';

const { API_COMMAND_NAMES } = require('./api-commands');

const DISCORD_COMMANDS = [
  { name: 'help', aliases: ['bots'], usage: '!help', summary: 'daftar perintah', build: () => 'help' },
  { name: 'status', aliases: ['st'], usage: '!status [nama]', summary: 'status koneksi', api: 'status', build: (args) => ['status', ...args].join(' ') },
  { name: 'pos', aliases: ['posisi'], usage: '!pos [nama]', summary: 'posisi, health, food', build: (args) => ['pos', ...args].join(' ') },
  { name: 'stats', aliases: ['statistik'], usage: '!stats [nama]', summary: 'statistik AFK/pukul/panen', build: (args) => ['stats', ...args].join(' ') },
  { name: 'look', aliases: ['kepala'], usage: '!look [nama] <yaw> [pitch]', summary: 'putar kepala', build: (args) => ['look', ...args].join(' ') },
  { name: 'walk', aliases: ['jalan'], usage: '!walk [nama] <arah> [ms]', summary: 'gerakkan bot', build: (args) => ['walk', ...args].join(' ') },
  { name: 'halts', aliases: ['berhenti'], usage: '!halts [nama]', summary: 'hentikan gerakan', build: (args) => ['halts', ...args].join(' ') },
  { name: 'idle', aliases: ['afk'], usage: '!idle [nama]', summary: 'faksa aksi anti-AFK', build: (args) => ['idle', ...args].join(' ') },
  { name: 'eat', aliases: ['makan'], usage: '!eat [nama]', summary: 'faksa makan', build: (args) => ['eat', ...args].join(' ') },
  { name: 'rescue', aliases: ['selamatkan'], usage: '!rescue [nama]', summary: 'selamatkan dari bahaya', build: (args) => ['rescue', ...args].join(' ') },
  { name: 'attack', aliases: ['pukul'], usage: '!attack [nama|all] [on|off]', summary: 'pukul mob otomatis', build: (args) => ['attack', ...args].join(' ') },
  { name: 'buy', aliases: ['beli'], usage: '!buy [nama|all]', summary: 'beli item shop', build: (args) => ['buy', ...args].join(' ') },
  { name: 'dump', aliases: ['buang'], usage: '!dump [nama|all]', summary: 'buang isi inventory', build: (args) => ['dump', ...args].join(' ') },
  {
    name: 'inv',
    aliases: ['invntori', 'inventory'],
    usage: '!inv [nama] [filter] [max]',
    summary: 'lihat isi inventory',
    build: (args, context = {}) => {
      if (!args.length) return 'inv all';
      if (/^\d+$/.test(args[0])) return ['inv', 'all', ...args].join(' ');
      if (isBotName(args[0], context)) return ['inv', ...args].join(' ');
      return ['inv', 'all', ...args].join(' ');
    }
  },
  { name: 'invall', aliases: [], usage: '!invall [filter] [max]', summary: 'inventory semua bot', build: (args) => ['inv', 'all', ...args].join(' ') },
  { name: 'harvest', aliases: ['panen'], usage: '!harvest [nama|all]', summary: 'panen lahan sekarang', build: (args) => ['harvest', ...args].join(' ') },
  { name: 'harveststop', aliases: [], usage: '!harveststop [nama|all]', summary: 'batalkan siklus panen', build: (args) => ['harvest', args[0] || 'all', 'stop'].join(' ') },
  { name: 'farm', aliases: ['ladang'], usage: '!farm [nama|all] [on|off]', summary: 'status auto-panen', build: (args) => ['farm', ...args].join(' ') },
  { name: 'farmon', aliases: [], usage: '!farmon [nama|all]', summary: 'nyalakan auto-panen', build: (args) => ['farm', args[0] || 'all', 'on'].join(' ') },
  { name: 'farmoff', aliases: [], usage: '!farmoff [nama|all]', summary: 'matikan auto-panen', build: (args) => ['farm', args[0] || 'all', 'off'].join(' ') },
  { name: 'stop', aliases: ['stopall'], usage: '!stop [nama|all]', summary: 'berhenti total (panen, pukul, gerak)', build: (args) => ['stop', ...args].join(' ') },
  { name: 'say', aliases: ['chat'], usage: '!say [nama] <pesan>', summary: 'kirim chat', build: (args) => ['say', ...args].join(' ') },
  { name: 'sayall', aliases: [], usage: '!sayall <pesan>', summary: 'chat ke semua bot', build: (args) => ['say', 'all', ...args].join(' ') },
  { name: 'solve', aliases: ['jawab'], usage: '!solve [nama] <soal>', summary: 'jawab soal (tidak dikirim ke server)', build: (args) => ['solve', ...args].join(' ') },
  { name: 'id', aliases: ['dimana', 'where', 'diagnostic'], usage: '!id', summary: 'ID channel/server + daftar channel yang diizinkan', build: () => 'id', diagnostic: true },
  { name: 'restart', aliases: ['reconnect'], usage: '!restart [nama|all]', summary: 'sambung ulang bot', build: (args) => ['restart', ...args].join(' ') },
  { name: 'shutdown', aliases: ['kill'], usage: '!shutdown <nama>', summary: 'matikan satu bot', danger: true, build: (args) => ['shutdown', ...args].join(' ') }
];

const INDEX = new Map();
for (const command of DISCORD_COMMANDS) {
  INDEX.set(command.name, command);
  for (const alias of command.aliases) INDEX.set(alias, command);
}

const ALL_WORDS = new Set(['all', 'semua', '*']);

function isBotName(token, context = {}) {
  const key = String(token || '').toLowerCase();
  if (ALL_WORDS.has(key)) return true;
  const bots = Array.isArray(context.bots) ? context.bots : [];
  return bots.some((name) => String(name).toLowerCase() === key);
}

function findCommand(token) {
  return INDEX.get(String(token || '').toLowerCase()) || null;
}

function parseMessage(content, prefix = '!') {
  const text = String(content || '').trim();
  if (!text.startsWith(prefix)) return null;
  const body = text.slice(prefix.length).trim();
  if (!body) return null;
  const [name, ...args] = body.split(/\s+/);
  return { command: findCommand(name), name, args };
}

function isKnownApiCommand(name) {
  return API_COMMAND_NAMES.includes(String(name).toLowerCase());
}

module.exports = { DISCORD_COMMANDS, findCommand, parseMessage, isBotName, isKnownApiCommand };