'use strict';

const readline = require('readline');
const { formatDuration } = require('./logger');
const { getHealth, manualWalk, manualStop } = require('./behaviors');
const { inventoryReport } = require('./inventory');

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
  'attack [on|off]      pukul mob otomatis (off/stop = berhenti menyerang)',
  'buy                  beli daftar item shop sekarang',
  'dump                 buang semua isi inventory',
  'inv [filter] [max]   lihat isi inventory bot (filter nama item, jumlah baris)',
  'harvest [stop]       panen sekarang, atau harvest stop untuk batalkan yang sedang jalan',
  'farm [on|off]        status/nyalakan auto-panen (tanpa argumen: status)',
  'stop                 berhenti total: batalkan panen, matikan auto-panen + pukul mob + gerakan',
  'say <pesan>          kirim chat ke server',
  'restart              keluar lalu sambung ulang',
  'quit                 matikan bot'
];

const STOP_WORDS = new Set(['stop', 'cancel', 'batal', 'berhenti', 'off', 'mati']);
const START_WORDS = new Set(['on', 'jalan', 'start', 'nyalakan']);

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
          const features = [
            config.combat && config.combat.enabled ? 'combat' : null,
            config.shop && config.shop.enabled ? 'shop' : null,
            config.farm && config.farm.enabled ? 'farm' : null
          ].filter(Boolean);
          logger.plain(`fitur     : ${features.join(', ') || '-'}`);
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
          const combat = state.combat && state.combat.stats;
          const shop = state.shop && state.shop.stats;
          const farm = state.farm && state.farm.stats;
          if (combat) {
            logger.plain(`pukul mob   : ${combat.attacks} serangan / ${combat.kills} knock (target ${combat.lastTarget || '-'})`);
            logger.plain(`senjata     : ${combat.weapon || 'tangan kosong'}`);
          }
          if (shop) logger.plain(`beli        : ${shop.buys} item, buang ${shop.drops} tumpukan`);
          if (farm) logger.plain(`panen       : ${farm.harvests} tanaman (wortel ${farm.carrots}), tanam ulang ${farm.replants}`);
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

        case 'attack':
        case 'pukul': {
          const combat = state.combat;
          if (!combat) {
            logger.warn('fitur pukul mob belum siap');
            break;
          }
          const mode = String(rest[0] || '').toLowerCase();
          if (START_WORDS.has(mode)) combat.setEnabled(true);
          else if (STOP_WORDS.has(mode)) combat.stop();
          const target = combat.fighting ? ` | lagi menyerang #${combat.targetId}` : '';
          const weapon = combat.weapon || 'tangan kosong';
          const plan = combat.stats.action || 'idle';
          const distance = combat.stats.distance === null || combat.stats.distance === undefined
            ? '-'
            : `${combat.stats.distance} blok`;
          logger.success(
            `pukul mob ${combat.enabled ? 'ON' : 'OFF'} | aksi=${plan} jarak=${distance} | ` +
            `bidikan=${combat.stats.aimHeight === null || combat.stats.aimHeight === undefined ? '-' : `${combat.stats.aimHeight} blok dari kaki`} | ` +
            `target=${combat.stats.lastTarget || '-'} senjata=${weapon} | ` +
            `serangan=${combat.stats.attacks} knock=${combat.stats.kills} ` +
            `macet=${combat.stats.stuck}${target}`
          );
          break;
        }

        case 'buy':
        case 'beli': {
          const shop = state.shop;
          if (!shop) {
            logger.warn('fitur shop belum siap');
            break;
          }
          const bought = await shop.buy();
          logger.success(bought ? `beli selesai: ${bought} item` : 'tidak ada yang dibeli (lihat log)');
          break;
        }

        case 'dump':
        case 'buang': {
          const shop = state.shop;
          if (!shop) {
            logger.warn('fitur shop belum siap');
            break;
          }
          const result = await shop.dump();
          logger.success(`${result.dropped} tumpukan dibuang (disimpan: ${result.kept.join(', ') || '-'})`);
          break;
        }

        case 'inv':
        case 'invntori':
        case 'inventory': {
          const bot = getBot();
          if (!bot || !bot.inventory) {
            logger.warn('bot belum login');
            break;
          }
          const limit = Number(rest[rest.length - 1]);
          const hasLimit = rest.length > 0 && Number.isFinite(limit) && limit > 0;
          const report = inventoryReport(bot, {
            query: (hasLimit ? rest.slice(0, -1) : rest).join(' '),
            limit: hasLimit ? limit : undefined
          });
          report.lines.forEach((line) => logger.plain(line));
          break;
        }

        case 'harvest':
        case 'panen': {
          const farm = state.farm;
          if (!farm) {
            logger.warn('fitur panen belum siap');
            break;
          }
          const mode = String(rest[0] || '').toLowerCase();
          if (STOP_WORDS.has(mode)) {
            const aborted = farm.abortHarvest();
            logger.success(
              aborted
                ? 'panen yang sedang jalan dibatalkan'
                : `tidak ada panen berjalan (auto-panen ${farm.enabled ? 'masih ON' : 'OFF'})`
            );
            break;
          }
          if (START_WORDS.has(mode)) {
            farm.setEnabled(true);
            logger.success(farm.enabled ? 'auto-panen ON' : 'auto-panen tidak menyala, cek farm.area di config.json');
            break;
          }
          const before = farm.aborts;
          const done = await farm.harvest();
          if (farm.aborts !== before) logger.warn('panen dihentikan sebelum selesai');
          else logger.success(done ? `${done} tanaman dipanen` : 'tidak ada tanaman siap panen');
          break;
        }

        case 'stop':
        case 'stopall': {
          const farm = state.farm;
          const combat = state.combat;
          const aborted = farm ? farm.abortHarvest() : false;
          if (farm) farm.stop();
          if (combat) combat.stop();
          const moved = manualStop(getBot());
          logger.success('berhenti total');
          logger.plain(`panen     : ${aborted ? 'siklus berjalan dibatalkan' : 'dimatikan'}`);
          logger.plain(`auto-panen : OFF`);
          logger.plain(`pukul mob : OFF (serangan=${combat ? combat.stats.attacks : 0} knock=${combat ? combat.stats.kills : 0})`);
          logger.plain(`gerakan   : ${moved ? 'dihentikan' : 'tidak ada gerakan berjalan'}`);
          break;
        }

        case 'farm': {
          const farm = state.farm;
          if (!farm) {
            logger.warn('fitur panen belum siap');
            break;
          }
          const mode = String(rest[0] || '').toLowerCase();
          if (mode === 'on') farm.setEnabled(true);
          else if (mode === 'off') farm.stop();
          const info = farm.status();
          logger.plain(`auto-panen  : ${info.enabled ? 'ON' : 'OFF'}${info.harvesting ? '  <- sedang panen sekarang' : ''}`);
          logger.plain(`area        : ${info.areaText || '-'}${info.areaConfigured ? '' : '  <- BELUM DIISI'}`);
          logger.plain(`jarak bot   : ${info.distance === null ? '-' : `${info.distance} blok`}`);
          logger.plain(`tanaman     : ${info.crops} siap (${Object.entries(info.types).map(([name, count]) => `${name} ${count}`).join(', ') || '-'})`);
          logger.plain(`filter crops: ${info.cropsFilter.join(', ')}`);
          logger.plain(`statistik   : panen=${info.stats.harvests} wortel=${info.stats.carrots} ambil=${info.stats.pickups} tanam-ulang=${info.stats.replants} scan=${info.stats.scans} cari-lahan=${info.stats.searches} jalan-memutar=${info.stats.detours || 0}`);
          logger.plain(`item jatuh  : ${info.pendingDrops || 0} hasil panen masih tertinggal di tanah${info.pendingDrops ? '  <- dicoba lagi di sapuan akhir siklus' : ''}`);
          logger.plain(`cache scan : ${info.cachedCrops ? `segar (${info.cachedArea ? `lahan ${info.cachedArea.x}, ${info.cachedArea.y}, ${info.cachedArea.z}` : 'tanaman'}), dipakai ulang tanpa scan ulang` : 'basi, siklus depan scan lagi'}${info.stats.lastScanAt ? ` | scan terakhir ${formatDuration(Date.now() - info.stats.lastScanAt)} lalu` : ''}`);
          logger.plain(`cari lahan  : ${info.autoDiscover ? `ON (radius ${info.searchRadius} blok)` : 'OFF'}${info.discovered ? ` | terrain yang ditemukan (${info.discovered.x}, ${info.discovered.y}, ${info.discovered.z})` : ''}${info.nearbyField ? ` | lahan terdekat di ${info.nearbyField.ring} blok, ${info.nearbyField.crops} tanaman` : ''}`);
          if (info.stats.lastError) logger.warn(`error terakhir: ${info.stats.lastError}`);
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
