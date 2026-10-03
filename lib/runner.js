'use strict';

const mineflayer = require('mineflayer');

const { Backoff } = require('./backoff');
const { attachBehaviors, getHealth } = require('./behaviors');
const { attachCombat } = require('./combat');
const { attachFarm } = require('./farm');
const { attachShop } = require('./shop');
const { createRegisterAgent } = require('./register');
const { createChatGameAgent } = require('./chatgame');
const { formatDuration } = require('./logger');

const AFK_KICK_PATTERN = /afk|idle|inactive|terlalu lama|too long|spam/i;
const AUTH_KICK_PATTERN = /not logged into your minecraft account|failed to verify|invalid session|not registered|belum terdaftar|belum login|you must register/i;
const ONLINE_MODE_KICK_PATTERN = /you are not logged into your minecraft account|failed to verify|invalid session|multiplayer.*not.*enabled|online.?mode/i;

function extractKickReason(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return payload.map(extractKickReason).filter(Boolean).join(' | ') || JSON.stringify(payload);
  if (typeof payload === 'object') {
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.description === 'string') return payload.description;
    if (payload.extra) return extractKickReason(payload.extra);
  }
  return JSON.stringify(payload);
}

function createRunner({ config, logger, onStateChange }) {
  const backoff = new Backoff(config.reconnect);
  const label = config.account.username;

  const register = createRegisterAgent({
    config,
    logger,
    username: label,
    onAction: (action) => {
      state.registerStatus = action.type === 'register' ? 'registering' : 'logging-in';
    }
  });

  const chatGame = createChatGameAgent({ config, logger, username: label });

  const state = {
    bot: null,
    behavior: null,
    combat: null,
    shop: null,
    farm: null,
    connecting: false,
    stopping: false,
    joinedAt: null,
    startedAt: Date.now(),
    joins: 0,
    lastKick: null,
    lastError: null,
    spawnTimer: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    status: 'idle',
    fatal: null,
    backoff,
    registerStatus: config.register.enabled ? 'pending' : 'disabled',
    authFailures: 0
  };

  const notify = (status, detail) => {
    if (state.status === status && !detail) return;
    state.status = status;
    if (onStateChange) onStateChange(state, status, detail);
  };

  function buildOptions() {
    const { account, server, version } = config;
    return {
      host: server.host,
      port: server.port,
      username: account.username,
      version: version || false,
      hideErrors: true
    };
  }

  function clearSpawnTimer() {
    if (state.spawnTimer) {
      clearTimeout(state.spawnTimer);
      state.spawnTimer = null;
    }
  }

  function startHeartbeat() {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = setInterval(() => {
      const bot = state.bot;
      if (!bot || !bot.entity) return;
      const s = state.behavior ? state.behavior.stats : null;
      const extra = [
        state.combat && state.combat.stats.attacks ? `pukul=${state.combat.stats.attacks} mob=${state.combat.stats.kills}` : '',
        state.farm && state.farm.stats.harvests ? `panen=${state.farm.stats.harvests}` : '',
        state.shop && state.shop.stats.buys ? `beli=${state.shop.stats.buys} buang=${state.shop.stats.drops}` : ''
      ].filter(Boolean);
      logger.info(
        `online ${formatDuration(Date.now() - state.joinedAt)} | ` +
        `dunia=${bot.game.dimension} pos=${bot.entity.position.floored()} | ` +
        `hp=${getHealth(bot)} food=${bot.food} reg=${state.registerStatus} | ` +
        `aksi=${s ? s.idleActions : 0} (jmp=${s ? s.jumps : 0} eat=${s ? s.eats : 0} rescue=${s ? s.resafes : 0})` +
        (extra.length ? ` | ${extra.join(' ')}` : '')
      );
    }, config.logging.heartbeatMs || 300000);
  }

  function startFeatures() {
    state.combat = attachCombat(state.bot, config, logger);
    state.shop = attachShop(state.bot, config, logger);
    // Auto-panen dan auto-combat sama-sama menggerakkan bot lewat control
    // state, jadi farm diberi tahu kalau combat sedang memegang target:
    // kalau tidak, keduanya rebut arah dan combat tidak pernah sampai ke mob.
    state.farm = attachFarm(state.bot, config, logger, {
      combatBusy: () => Boolean(state.combat && state.combat.fighting)
    });
    state.combat.start();
    state.farm.start();
    state.shop.start();
  }

  function teardown(reason) {
    clearSpawnTimer();
    register.stop();
    chatGame.stop();
    if (state.combat) {
      state.combat.stop();
      state.combat = null;
    }
    if (state.shop) {
      state.shop.stop();
      state.shop = null;
    }
    if (state.farm) {
      state.farm.stop();
      state.farm = null;
    }
    if (state.behavior) {
      state.behavior.stop();
      state.behavior = null;
    }
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    state.bot = null;
    state.connecting = false;
    if (state.joinedAt) {
      logger.info(`sesi berakhir setelah ${formatDuration(Date.now() - state.joinedAt)} (${reason})`);
      state.joinedAt = null;
    }
  }

  function scheduleReconnect(reason, extraMs = 0) {
    if (state.stopping) return;
    if (!config.join.autoReconnect) {
      logger.error('auto-reconnect dimatikan di config, bot berhenti');
      shutdown('auto-reconnect dimatikan');
      return;
    }
    if (config.reconnect.maxAttempts > 0 && backoff.attempt >= config.reconnect.maxAttempts) {
      logger.error(`gagal ${backoff.attempt}x berturut-turut, berhenti sesuai maxAttempts`);
      shutdown('max attempts tercapai');
      return;
    }
    if (state.reconnectTimer) return;

    const delay = backoff.next(extraMs);
    notify('reconnecting');
    logger.warn(`${reason} - sambung ulang dalam ${formatDuration(delay)} (percobaan ke-${backoff.attempt})`);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (state.stopping || state.fatal) return;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.connecting || state.bot) return;

    state.connecting = true;
    notify('connecting');
    logger.info(`menghubungkan ke ${config.server.host}:${config.server.port} sebagai "${label}" ...`);

    let bot;
    try {
      bot = mineflayer.createBot(buildOptions());
    } catch (err) {
      state.connecting = false;
      logger.error(`gagal membuat koneksi: ${err.message}`);
      scheduleReconnect('Gagal membuat koneksi');
      return;
    }
    state.bot = bot;

    bot.once('login', () => {
      notify('authenticated');
      logger.success(`login berhasil - versi ${bot.version}, protocol ${bot.protocolVersion}`);
    });

    bot.once('spawn', () => {
      state.connecting = false;
      state.joinedAt = Date.now();
      state.joins += 1;
      backoff.reset();
      clearSpawnTimer();
      state.behavior = attachBehaviors(bot, config, logger, {
        // Aksi AFK yang memutar kepala membatalkan bidikan kaki ke mob.
        combatBusy: () => Boolean(state.combat && state.combat.fighting)
      });
      startFeatures();
      startHeartbeat();
      if (config.chatGame && config.chatGame.enabled) chatGame.start(bot);
      if (config.register.enabled) {
        state.registerStatus = 'pending';
        register.start(bot);
        logger.info(
          `auto-register siap (mode ${config.register.mode}, password: ${
            config.register.password ? 'dari config' : 'sama dengan username'
          })`
        );
      }
      notify('online');
      logger.success(`spawn di ${bot.game.dimension} ${bot.entity.position.floored()} - AFK bot aktif (mode ${config.afk.mode})`);
    });

    bot.on('messagestr', (message) => {
      const kind = register.handleChat(message);
      if (kind && (kind === 'registered' || kind === 'logged-in')) {
        state.registerStatus = 'authenticated';
      }
      if (config.chatGame && config.chatGame.enabled) {
        const game = chatGame.handleChat(message);
        if (game && (game.type === 'answered' || game.type === 'unknown')) {
          state.chatGame = game.type;
        }
      }
      if (!config.logging.logChat || message.length > 400) return;
      logger.raw('gray', `chat> ${message}`);
    });

    // Teks soal bisa tersembunyi di hoverEvent dan tidak muncul di messagestr.
    bot.on('message', (jsonMsg) => {
      if (!config.chatGame || !config.chatGame.enabled) return;
      const game = chatGame.handleJson(jsonMsg);
      if (game && (game.type === 'answered' || game.type === 'unknown')) {
        state.chatGame = game.type;
      }
    });

    // Plugin "ketik kode" biasanya menaruh soal di action bar / title, bukan chat.
    bot.on('actionBar', (jsonMsg) => {
      if (!config.chatGame || !config.chatGame.enabled) return;
      const game = chatGame.handleScreen(jsonMsg, 'actionbar');
      if (game && (game.type === 'answered' || game.type === 'unknown')) {
        state.chatGame = game.type;
      }
    });

    bot.on('title', (text, type) => {
      if (!config.chatGame || !config.chatGame.enabled) return;
      const game = chatGame.handleScreen(text, `title:${type}`);
      if (game && (game.type === 'answered' || game.type === 'unknown')) {
        state.chatGame = game.type;
      }
    });

    bot.on('kicked', (payload) => {
      state.lastKick = extractKickReason(payload);
    });

    bot.on('error', (err) => {
      if (state.stopping) return;
      const now = Date.now();
      if (state.lastError && state.lastError.message === err.message && now - state.lastError.at < 2000) return;
      state.lastError = { message: err.message, at: now };
      logger.error(`error koneksi: ${err.message}`);
    });

    bot.once('end', (reason) => {
      const kick = state.lastKick;
      state.lastKick = null;
      if (state.stopping) {
        teardown('dimatikan manual');
        notify('stopped');
        return;
      }
      const isAfkKick = kick ? AFK_KICK_PATTERN.test(kick) : false;
      const isAuthKick = kick ? AUTH_KICK_PATTERN.test(kick) : false;
      teardown(reason ? `putus: ${reason}` : 'putus dari server');
      notify('offline');

      if (isAuthKick) {
        state.authFailures += 1;
        state.registerStatus = 'auth-failed';
        logger.error(`kick autentikasi: ${kick}`);

        if (ONLINE_MODE_KICK_PATTERN.test(kick)) {
          logger.error('Server ini berjalan di ONLINE-MODE (wajib akun Microsoft asli).');
          logger.error('Bot ini hanya untuk server CRACKED (offline-mode), jadi tidak akan bisa masuk.');
          logger.error('Ganti server.host ke server cracked Anda di profiles.json / config.json.');
          state.fatal = 'online-mode';
          notify('auth-failed', kick);
          shutdown('server online-mode');
          return;
        }

        const maxAuthFailures = Number(config.register.maxAuthFailures) || 3;
        if (state.authFailures >= maxAuthFailures) {
          logger.error(`gagal autentikasi/registrasi ${state.authFailures}x berturut-turut, bot berhenti.`);
          logger.error('Cek: username sudah dipakai orang lain? password cocok? perintah /register dan /login aktif di server?');
          state.fatal = 'auth-failed';
          notify('auth-failed', kick);
          shutdown('autentikasi gagal');
          return;
        }
        logger.warn(`coba daftar ulang (${state.authFailures}/${maxAuthFailures})...`);
        scheduleReconnect('kick autentikasi/registrasi', 0);
        return;
      }

      if (kick) {
        const extra = isAfkKick ? config.reconnect.afkKickExtraMs : 0;
        scheduleReconnect(`dikick: ${kick}${isAfkKick ? ' (terdeteksi AFK kick, jeda diperpanjang)' : ''}`, extra);
      } else {
        scheduleReconnect(reason ? `putus: ${reason}` : 'koneksi terputus');
      }
    });

    if (config.join.spawnTimeoutMs > 0) {
      state.spawnTimer = setTimeout(() => {
        if (state.bot !== bot || state.joinedAt) return;
        logger.warn(`belum spawn dalam ${formatDuration(config.join.spawnTimeoutMs)}, mencoba ulang`);
        try {
          bot.quit('spawn timeout');
        } catch {
          state.lastKick = 'spawn timeout';
        }
      }, config.join.spawnTimeoutMs);
    }
  }

  function shutdown(reason = 'dimatikan manual') {
    if (state.stopping) return Promise.resolve();
    state.stopping = true;
    logger.info(`shutdown: ${reason}`);

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    clearSpawnTimer();
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    notify('stopping', reason);

    return new Promise((resolve) => {
      const bot = state.bot;
      if (!bot) {
        teardown('shutdown');
        notify('stopped', reason);
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        teardown('shutdown');
        notify('stopped', reason);
        resolve();
      }, 8000);
      bot.once('end', () => {
        clearTimeout(timer);
        teardown('shutdown');
        notify('stopped', reason);
        resolve();
      });
      try {
        bot.quit(reason);
      } catch {
        clearTimeout(timer);
        teardown('shutdown');
        notify('stopped', reason);
        resolve();
      }
    });
  }

  function reconnect(reason = 'manual restart') {
    state.lastKick = reason;
    state.fatal = null;
    const bot = state.bot;
    if (!bot) {
      connect();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      bot.once('end', () => resolve());
      try {
        bot.quit(reason);
      } catch {
        resolve();
      }
    });
  }

  function stats() {
    const behavior = state.behavior ? { ...state.behavior.stats } : null;
    const combat = state.combat ? { ...state.combat.stats } : null;
    const shop = state.shop ? { ...state.shop.stats } : null;
    const farm = state.farm ? { ...state.farm.stats } : null;
    if (!behavior && !combat && !shop && !farm) return null;
    return { ...(behavior || {}), combat, shop, farm };
  }

  state.reconnect = reconnect;
  state.shutdown = shutdown;

  return {
    label,
    state,
    register,
    connect,
    shutdown,
    reconnect,
    stats,
    get bot() { return state.bot; }
  };
}

module.exports = { createRunner, extractKickReason, AFK_KICK_PATTERN, AUTH_KICK_PATTERN, ONLINE_MODE_KICK_PATTERN };
