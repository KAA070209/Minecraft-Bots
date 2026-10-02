'use strict';

const readline = require('readline');
const { formatDuration } = require('./logger');
const { getHealth, manualWalk, manualStop } = require('./behaviors');

const HELP = [
  'help                 tampilkan daftar perintah',
  'status               status koneksi dan AFK',
  'pos                  posisi, health, food, dan block di bawah',
  'stats                statistik aksi AFK',
  'look [yaw] [pitch]   putar kepala (derajat)',
  'walk <arah> [ms]     jalan: forward/maju, back, left/kiri, right/kanan, jump, sneak, sprint',
  'halts                hentikan semua gerakan',
  'idle                 faksa satu aksi anti-AFK sekarang',
  'eat                  faksa makan sekarang',
  'rescue               cek bahaya (lava, air, terjatuh) lalu selamatkan bot',
  'say <pesan>          kirim chat ke server',
  'restart              keluar lalu sambung ulang',
  'quit                 matikan bot'
];

function stripPrefix(line, prefix) {
  if (!prefix) return line;
  return line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

function attachConsole(ctx) {
  const { config, logger, state } = ctx;
  if (!config.console.enabled || !process.stdin.isTTY) return null;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  const getBot = () => state.bot;
  const getBehavior = () => state.behavior;

  rl.prompt();

  rl.on('line', async (raw) => {
    const line = raw.trim();
    if (!line) {
      rl.prompt();
      return;
    }
    const command = stripPrefix(line, config.console.commandPrefix);
    const [name, ...rest] = command.split(/\s+/);
    const argument = rest.join(' ');

    try {
      switch (name.toLowerCase()) {
        case 'help':
        case '?':
          HELP.forEach((entry) => logger.plain(`  ${entry}`));
          break;

        case 'status': {
          const bot = getBot();
          const stateLabel = state.stopping ? 'stopping' : bot ? 'online' : state.connecting ? 'connecting' : 'reconnecting';
          logger.plain(`state     : ${stateLabel}`);
          logger.plain(`server    : ${config.server.host}:${config.server.port}`);
          logger.plain(`username  : ${config.account.username}`);
          logger.plain(`version   : ${bot ? bot.version : '-'}`);
          logger.plain(`uptime    : ${state.startedAt ? formatDuration(Date.now() - state.startedAt) : 'n/a'}`);
          logger.plain(`reconnect : percobaan ${state.backoff.attempt}`);
          if (bot && bot.entity) {
            logger.plain(`dunia     : ${bot.game.dimension}`);
            logger.plain(`chunk     : ${bot.entity.position.floored()}`);
          }
          break;
        }

        case 'pos': {
          const bot = getBot();
          if (!bot || !bot.entity) {
            logger.warn('bot belum login');
            break;
          }
          const position = bot.entity.position;
          const below = bot.blockAt(position.offset(0, -1, 0));
          logger.plain(`posisi  : ${position.floored()}`);
          logger.plain(`health  : ${getHealth(bot)}`);
          logger.plain(`food    : ${bot.food}`);
          logger.plain(`diatas  : ${bot.blockAt(position)?.name ?? '-'}`);
          logger.plain(`dibawah : ${below?.name ?? '-'}`);
          break;
        }

        case 'stats': {
          const behavior = getBehavior();
          if (!behavior) {
            logger.warn('belum ada statistik');
            break;
          }
          const s = behavior.stats;
          logger.plain(`aksi idle   : ${s.idleActions}`);
          logger.plain(`lompat      : ${s.jumps}`);
          logger.plain(`ayunan arm  : ${s.swings}`);
          logger.plain(`jalan       : ${s.walks}`);
          logger.plain(`makan       : ${s.eats}`);
          logger.plain(`penyelamatan: ${s.resafes}`);
          logger.plain(`aksi terakhir: ${formatDuration(Date.now() - s.lastActionAt)} lalu`);
          break;
        }

        case 'look': {
          const bot = getBot();
          if (!bot || !bot.entity) {
            logger.warn('bot belum login');
            break;
          }
          const yaw = rest[0] !== undefined ? (Number(rest[0]) * Math.PI) / 180 : bot.entity.yaw;
          const pitch = rest[1] !== undefined ? (Number(rest[1]) * Math.PI) / 180 : bot.entity.pitch;
          bot.look(yaw, pitch, true);
          logger.success(`kepala diputar ke yaw=${yaw.toFixed(2)} pitch=${pitch.toFixed(2)}`);
          break;
        }

        case 'walk':
        case 'jalan':
        case 'move': {
          const result = manualWalk(getBot(), rest[0], rest[1]);
          if (!result.ok) logger.warn(result.error);
          else logger.success(`jalan ${rest[0]} selama ${result.ms}ms`);
          break;
        }

        case 'halts':
        case 'berhenti': {
          const stopped = manualStop(getBot());
          logger.success(stopped ? 'semua gerakan dihentikan' : 'tidak ada gerakan berjalan');
          break;
        }

        case 'idle': {
          const behavior = getBehavior();
          if (!behavior) {
            logger.warn('belum ada behavior');
            break;
          }
          behavior.idleAction();
          logger.success('aksi anti-AFK dipicu manual');
          break;
        }

        case 'eat': {
          const behavior = getBehavior();
          if (!behavior) {
            logger.warn('belum ada behavior');
            break;
          }
          await behavior.eatIfNeeded();
          break;
        }

        case 'rescue': {
          const behavior = getBehavior();
          if (!behavior) {
            logger.warn('belum ada behavior');
            break;
          }
          behavior.rescueIfNeeded();
          logger.success('cek bahaya selesai');
          break;
        }

        case 'say':
        case 'tell': {
          const bot = getBot();
          if (!bot) {
            logger.warn('bot belum login');
            break;
          }
          if (!argument) {
            logger.warn('pesan kosong');
            break;
          }
          bot.chat(argument);
          logger.success(`chat dikirim: ${argument}`);
          break;
        }

        case 'restart':
          logger.warn('restart diminta, sambung ulang...');
          await state.reconnect('manual restart');
          break;

        case 'quit':
        case 'exit':
          rl.close();
          await state.shutdown();
          return;

        default:
          logger.warn(`perintah tidak dikenal: ${name} (ketik "help")`);
      }
    } catch (err) {
      logger.error(`perintah "${name}" gagal: ${err.message}`);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    if (!state.stopping) state.shutdown().catch(() => {});
  });

  return rl;
}

module.exports = { attachConsole, HELP, stripPrefix };
