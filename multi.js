'use strict';

const path = require('path');
const readline = require('readline');

const { loadProfiles } = require('./lib/profiles');
const { loadConfig } = require('./lib/config');
const { createLogger, formatDuration } = require('./lib/logger');
const { createRunner } = require('./lib/runner');
const { manualWalk, manualStop } = require('./lib/behaviors');
const { solveOnce } = require('./lib/chatgame');

const consoleLogger = {
  info: (m) => process.stdout.write(`${m}\n`),
  warn: (m) => process.stdout.write(`${m}\n`),
  success: (m) => process.stdout.write(`${m}\n`),
  error: (m) => process.stdout.write(`${m}\n`)
};

const ROOT = __dirname;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[body] = argv[i + 1];
      i += 1;
    } else {
      out[body] = true;
    }
  }
  return out;
}

const STATE_ORDER = ['auth-failed', 'fatal', 'stopping', 'stopped', 'offline', 'reconnecting', 'connecting', 'online'];

function main() {
  const options = parseArgs(process.argv.slice(2));
  const profilesFile = options.profiles || path.join(ROOT, 'profiles.json');
  const staggerMs = Number(options.stagger ?? 3000);
  const profiles = [];

  let loaded;
  try {
    loaded = loadProfiles(profilesFile);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
    return;
  }

  const enabled = loaded.profiles.filter((p) => p.enabled);
  if (!enabled.length) {
    process.stderr.write('tidak ada profil aktif di file profil\n');
    process.exit(1);
    return;
  }

  let active = enabled;
  if (options.only) {
    const wanted = String(options.only)
      .split(/[\s,]+/)
      .map((n) => n.trim())
      .filter(Boolean);
    const known = new Set(enabled.map((p) => p.name));
    const unknown = wanted.filter((n) => !known.has(n));
    if (unknown.length) {
      process.stderr.write(
        `nama tidak ada di file profil: ${unknown.join(', ')}\n` +
        `yang tersedia: ${[...known].join(', ')}\n`
      );
      process.exit(1);
      return;
    }
    active = wanted.map((name) => enabled.find((p) => p.name === name));
    const skipped = enabled.filter((p) => !wanted.includes(p.name)).map((p) => p.name);
    if (skipped.length) {
      process.stdout.write(`\nlewati ${skipped.length} profil karena --only: ${skipped.join(', ')}\n`);
    }
  }

  const startedAt = Date.now();
  const registerModes = new Set(active.map((p) => (p.config.register || {}).mode || 'auto'));
  const passwords = new Set(active.map((p) => p.password || '<username>'));
  process.stdout.write(
    `memuat ${active.length} profil dari ${path.basename(profilesFile)} | register mode: ${[...registerModes].join(', ')} | jeda join: ${staggerMs}ms\n\n`
  );
  process.stdout.write(
    `password: ${passwords.size === 1 ? [...passwords][0] : passwords.size + ' variasi (ti profil pakai password sendiri)'}\n\n`
  );

  let shuttingDown = false;

  for (const [index, profile] of active.entries()) {
    const profileConfig = JSON.parse(JSON.stringify(profile.config || {}));
    if (profileConfig.logging && typeof profileConfig.logging.file === 'string') {
      profileConfig.logging.file = profileConfig.logging.file.replace('{name}', profile.name);
    }

    const config = loadConfig([], {
      ...process.env,
      MC_CONFIG_JSON: JSON.stringify({
        ...profileConfig,
        account: {
          ...(profileConfig.account || {}),
          username: profile.name
        }
      })
    });

    const record = {
      profile,
      name: profile.name,
      status: 'queued',
      statusSince: Date.now(),
      joins: 0,
      register: 'pending',
      runner: null,
      error: null
    };
    profiles.push(record);

    setTimeout(() => {
      if (shuttingDown) return;
      const logger = createLogger({
        file: config.logging.file,
        color: config.logging.color,
        level: config.logging.level,
        maxLogFileBytes: config.logging.maxLogFileBytes,
        prefix: `[${profile.name}] `
      });
      const runner = createRunner({
        config,
        logger,
        onStateChange: (state, status, detail) => {
          record.status = status;
          record.statusSince = Date.now();
          record.register = state.registerStatus;
          if (state.joins) record.joins = state.joins;
          if (status === 'auth-failed') record.error = detail || 'autentikasi ditolak';
        }
      });
      record.runner = runner;
      record.logger = logger;
      runner.connect();
    }, index * staggerMs);
  }

  function table() {
    const width = Math.max(...profiles.map((p) => p.name.length), 4);
    const pad = (t, w) => String(t).padEnd(w);
    const padStart = (t, w) => String(t).padStart(w);
    const rank = (s) => {
      const i = STATE_ORDER.indexOf(s);
      return i === -1 ? 0 : i;
    };

    process.stdout.write(`\n${pad('BOT', width)}  ${pad('STATE', 14)}${pad('REGISTER', 11)}${padStart('JOIN', 6)}${padStart('UPTIME', 11)}\n`);
    process.stdout.write('-'.repeat(width + 48) + '\n');
    for (const p of [...profiles].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name))) {
      const uptime = p.runner && p.status === 'online' ? formatDuration(Date.now() - p.runner.state.joinedAt) : '-';
      const register = p.runner ? p.runner.state.registerStatus : p.register;
      process.stdout.write(
        `${pad(p.name, width)}  ${pad(p.status, 14)}${pad(register, 11)}${padStart(p.joins, 6)}${padStart(uptime, 11)}\n`
      );
    }
    const online = profiles.filter((p) => p.status === 'online').length;
    const authed = profiles.filter((p) => p.runner && p.runner.state.registerStatus === 'authenticated').length;
    const failed = profiles.filter((p) => p.status === 'auth-failed' || p.status === 'fatal').length;
    process.stdout.write(`\n${online}/${profiles.length} online | ${authed} terautentikasi`);
    if (failed) process.stdout.write(`, ${failed} gagal auth`);
    process.stdout.write(` | proses uptime ${formatDuration(Date.now() - startedAt)}\n`);
    if (profiles.some((p) => p.error)) {
      process.stdout.write(`\nerror: ${profiles.filter((p) => p.error).map((p) => `${p.name}: ${p.error}`).join('\n       ')}\n`);
    }
    process.stdout.write('\n');
  }

  const help = [
    'status            tabel status semua bot',
    'status <nama>     detail satu bot',
    'stats <nama>      statistik aksi AFK satu bot',
    'say <nama> <pesan>  kirim chat dari satu bot',
    'say <pesan>       kirim chat ke semua bot aktif',
    'sayall <pesan>    kirim chat ke semua bot aktif',
    'walk <nama> <arah> [ms]  gerakkan satu bot',
    'walkall <arah> [ms]      gerakkan semua bot aktif',
    'halts <nama>     hentikan gerakan satu bot',
    'restart <nama>    paksa sambung ulang satu bot',
    'stop <nama>       hentikan satu bot',
    'start <nama>      jalankan satu bot lagi',
    'solve <pertanyaan>  jawab soal lewat solver/AI tanpa kirim ke server',
    'solve <nama> <pertanyaan>  sama, memakai config bot tertentu',
    'help              daftar perintah',
    'quit              hentikan semua bot lalu keluar'
  ].join('\n');

  function attachConsole() {
    if (!process.stdin.isTTY) return null;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'multi> ' });
    rl.prompt();

    rl.on('line', (raw) => {
      const line = raw.trim();
      if (line) {
        const words = line.split(/\s+/);
        const command = words[0];
        const rest = words.slice(1);
        const record = profiles.find((p) => p.name === rest[0]);

        const sendChat = (targets, message) => {
          const sent = [];
          for (const target of targets) {
            const bot = target.runner && target.runner.state.bot;
            if (!bot) {
              process.stdout.write(`\n${target.name} belum punya koneksi, pesan tidak dikirim\n`);
              continue;
            }
            try {
              bot.chat(message);
              sent.push(target.name);
            } catch (err) {
              process.stdout.write(`\n${target.name} gagal kirim: ${err.message}\n`);
            }
          }
          const safe = targets.reduce(
            (text, t) => (t.password ? text.split(t.password).join('<password>') : text),
            message
          );
          process.stdout.write(
            `\npesan terkirim ke ${sent.length}/${targets.length} bot: ${sent.join(', ') || '-'}\n` +
            `isi: ${safe}\n\n`
          );
        };

        switch (command.toLowerCase()) {
          case 'status':
          case 'st':
            if (record) {
              const s = record.runner ? record.runner.state : null;
              process.stdout.write(
                `\n${record.name}: ${record.status} | register ${record.register} | joins ${record.joins}` +
                `${s && s.bot && s.bot.entity ? ` | ${s.bot.game.dimension} ${s.bot.entity.position.floored()} | hp ${s.bot.health} food ${s.bot.food}` : ''}\n\n`
              );
            } else {
              table();
            }
            break;
          case 'stats':
            if (record && record.runner) {
              const stats = record.runner.stats();
              process.stdout.write(`\n${record.name}: ${stats ? JSON.stringify(stats) : 'belum ada aksi'}\n\n`);
            } else {
              process.stdout.write('\nprofil tidak ditemukan\n\n');
            }
            break;
          case 'walk':
          case 'move': {
            if (!record) { process.stdout.write('\nprofil tidak ditemukan\n\n'); break; }
            const result = manualWalk(record.runner && record.runner.state.bot, rest[1], rest[2]);
            if (!result.ok) process.stdout.write(`\n${record.name}: ${result.error}\n\n`);
            else process.stdout.write(`\n${record.name} jalan ${rest[1]} selama ${result.ms}ms\n\n`);
            break;
          }
          case 'halts': {
            if (!record) { process.stdout.write('\nprofil tidak ditemukan\n\n'); break; }
            const stopped = manualStop(record.runner && record.runner.state.bot);
            process.stdout.write(`\n${record.name}: ${stopped ? 'semua gerakan dihentikan' : 'tidak ada gerakan berjalan'}\n\n`);
            break;
          }
          case 'walkall': {
            const message = rest.join(' ');
            const results = [];
            for (const target of profiles) {
              const result = manualWalk(target.runner && target.runner.state.bot, rest[0], rest[1]);
              results.push(`${target.name}=${result.ok ? `${result.state} ${result.ms}ms` : 'gagal'}`);
            }
            process.stdout.write(`\n${results.join(' | ')}\n\n`);
            break;
          }
          case 'restart':
            if (!record) { process.stdout.write('\nprofil tidak ditemukan\n\n'); break; }
            record.runner.reconnect('restart manual').catch(() => {});
            break;
          case 'stop':
            if (!record) { process.stdout.write('\nprofil tidak ditemukan\n\n'); break; }
            record.runner.shutdown('dimatikan dari console').catch(() => {});
            break;
          case 'say':
          case 'chat': {
            const message = record ? rest.slice(1).join(' ') : rest.join(' ');
            if (!message) {
              process.stdout.write('\nisi pesan: say <nama> <pesan>\n\n');
              break;
            }
            const targets = record ? [record] : profiles.filter((p) => p.runner && p.status !== 'stopped');
            if (!targets.length) {
              process.stdout.write('\ntidak ada bot aktif\n\n');
              break;
            }
            sendChat(targets, message);
            break;
          }
          case 'sayall': {
            const message = rest.join(' ');
            if (!message) {
              process.stdout.write('\nisi pesan: sayall <pesan>\n\n');
              break;
            }
            const targets = profiles.filter((p) => p.runner && p.status !== 'stopped');
            if (!targets.length) {
              process.stdout.write('\ntidak ada bot aktif\n\n');
              break;
            }
            sendChat(targets, message);
            break;
          }
          case 'solve': {
            const parts = rest[0] && profiles.some((p) => p.name.toLowerCase() === String(rest[0]).toLowerCase())
              ? rest.slice(1)
              : rest;
            const question = parts.join(' ').trim();
            if (!question) {
              process.stdout.write('\nisi pertanyaan: solve [nama] <pertanyaan>\n\n');
              break;
            }
            const config = record && record.profile && record.profile.config ? record.profile.config : (profiles[0] && profiles[0].profile && profiles[0].profile.config) || {};
            process.stdout.write(`\nmenyelesaikan: ${question}\n`);
            solveOnce(question, config, consoleLogger)
              .then((result) => {
                if (result.answer) {
                  process.stdout.write(`jawaban: ${result.answer}  (${result.source})\n\n`);
                } else {
                  process.stdout.write('tidak ada jawaban - cek MC_AI_ENDPOINT / MC_AI_KEY\n\n');
                }
              })
              .catch((err) => process.stdout.write(`gagal: ${err.message}\n\n`));
            break;
          }
          case 'start':
            process.stdout.write('\nprofil yang sudah di-shutdown tidak bisa di-start ulang; jalankan ulang "npm run multi"\n\n');
            break;
          case 'help':
          case '?':
            process.stdout.write(`\n${help}\n\n`);
            break;
          case 'quit':
          case 'exit':
            rl.close();
            shutdown(0);
            return;
          default:
            process.stdout.write(`\nperintah tidak dikenal: ${command} (ketik "help")\n\n`);
        }
      }
      rl.prompt();
    });

    rl.on('close', () => shutdown(0));
    return rl;
  }

  async function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    const active = profiles.filter((p) => p.runner && p.status !== 'stopped');
    process.stdout.write(`\nmenghentikan ${active.length} bot...\n`);
    await Promise.all(active.map((p) => p.runner.shutdown('shutdown multi').catch(() => {})));
    process.stdout.write('semua bot berhenti\n');
    process.exit(code);
  }

  attachConsole();

  const tableTimer = setInterval(table, options.statusEvery ? Number(options.statusEvery) : 120000);
  tableTimer.unref?.();

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (err) => {
    process.stderr.write(`uncaught exception: ${err && err.stack ? err.stack : err}\n`);
  });
  process.on('unhandledRejection', (err) => {
    process.stderr.write(`unhandled rejection: ${err && err.stack ? err.stack : err}\n`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };