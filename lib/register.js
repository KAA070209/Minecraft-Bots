'use strict';

const NOT_REGISTERED_PATTERN =
  /not registered|belum terdaftar|belum daftar|register first|terlebih dahulu|you must register|not logged in|belum login|silakan (login|register)|please (log ?in|register)|請先登入|请先登录|กรุณา|please register/i;
const REGISTERED_PATTERN =
  /successfully registered|registration successful|account created|registrasi berhasil|pendaftaran berhasil|you are now registered/i;
const LOGGED_IN_PATTERN =
  /logged in|login berhasil|berhasil login|welcome back|welcome back|logged in successfully/i;
const ALREADY_REGISTERED_PATTERN =
  /already registered|sudah terdaftar|already exists|nama sudah dipakai|is already taken|name is taken/i;
const LOGIN_FAILED_PATTERN =
  /wrong password|incorrect password|password salah|wrong pass|invalid password|already logged in|sudah login/i;

function classifyChat(message) {
  if (!message) return null;
  const text = String(message);
  if (LOGIN_FAILED_PATTERN.test(text)) return 'login-failed';
  if (ALREADY_REGISTERED_PATTERN.test(text)) return 'already-registered';
  if (NOT_REGISTERED_PATTERN.test(text)) return 'not-registered';
  if (LOGGED_IN_PATTERN.test(text)) return 'logged-in';
  if (REGISTERED_PATTERN.test(text)) return 'registered';
  return null;
}

function resolvePassword(config, username) {
  const explicit = config.register && config.register.password;
  if (explicit !== null && explicit !== undefined && String(explicit).length > 0) {
    return String(explicit);
  }
  return String(username);
}

function createState() {
  return {
    attempts: 0,
    triedLogin: false,
    triedRegister: false,
    notRegistered: false,
    alreadyRegistered: false,
    authenticated: false,
    done: false,
    startedAt: 0,
    lastAt: 0,
    lastAction: null
  };
}

/**
 * Fungsi murni: tentukan aksi berikutnya dari state + config.
 * Mengembalikan null kalau tidak ada yang perlu dilakukan.
 */
function nextStep(state, config, now = Date.now()) {
  const reg = config.register || {};
  if (reg.enabled === false) return null;
  const mode = reg.mode || 'auto';
  if (mode === 'off') return null;
  if (state.done || state.authenticated) return null;

  const username = config.account.username;
  const password = resolvePassword(config, username);
  const maxAttempts = Number.isFinite(reg.maxAttempts) && reg.maxAttempts > 0 ? reg.maxAttempts : 3;

if (state.triedLogin || state.triedRegister) {
    const waitMs = Number(reg.retryMs) || 0;
    if (state.lastAt && now - state.lastAt < waitMs) return null;
  } else {
    const waitMs = Number(reg.delayMs) || 0;
    const since = state.startedAt || 0;
    if (since && now - since < waitMs) return null;
  }

  let type = null;
  if (state.alreadyRegistered && !state.triedLogin && state.attempts < maxAttempts) {
    type = 'login';
  } else if (mode === 'register') {
    if (!state.triedRegister && state.attempts < maxAttempts) type = 'register';
  } else if (mode === 'login') {
    if (!state.triedLogin && state.attempts < maxAttempts) type = 'login';
  } else {
    if (!state.triedLogin && state.attempts < maxAttempts) type = 'login';
    else if (state.notRegistered && !state.triedRegister && state.attempts < maxAttempts) type = 'register';
    else if (state.attempts < maxAttempts) type = 'login';
  }

  if (!type) return null;

  const command = buildCommand(type, config, username, password);

  state.attempts += 1;
  state.lastAt = now;
  state.lastAction = type;
  if (type === 'register') state.triedRegister = true;
  if (type === 'login') state.triedLogin = true;

  return { type, command, password, attempt: state.attempts };
}

function applyChat(state, message) {
  const kind = classifyChat(message);
  if (!kind) return null;
  if (kind === 'not-registered') {
    state.notRegistered = true;
  } else if (kind === 'already-registered') {
    state.alreadyRegistered = true;
    state.triedRegister = true;
  } else if (kind === 'registered') {
    state.authenticated = true;
    state.done = true;
  } else if (kind === 'logged-in') {
    state.authenticated = true;
    state.done = true;
  } else if (kind === 'login-failed') {
    state.notRegistered = true;
  }
  return kind;
}

/**
 * Agent yang menempel ke satu bot: memompa aksi register/login setelah spawn
 * dan memberi tahu lewat callback setiap aksi.
 */
function buildCommand(type, config, username, password) {
  const reg = config.register || {};
  const fallback = type === 'register' ? '/register {password} {password}' : '/login {password}';
  const template = type === 'register' ? reg.commandTemplate || reg.registerCommand : reg.loginTemplate;
  const raw = typeof template === 'string' && template.trim() ? template : fallback;
  return raw
    .replace(/\{username\}/gi, username)
    .replace(/\{password\}/gi, password);
}

function maskSecret(text, secret) {
  if (!secret || typeof secret !== 'string' || !text.includes(secret)) return text;
  return text.split(secret).join('<password>');
}

function createRegisterAgent({ config, logger, username, onAction, tickMs = 400 }) {
  const state = createState();
  let timer = null;
  let botRef = null;

  function start(bot) {
    stop();
    botRef = bot;
    Object.assign(state, createState());
    state.startedAt = Date.now();
    timer = setInterval(() => pump(), tickMs);
    if (timer.unref) timer.unref();
    pump();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    botRef = null;
  }

  function pump() {
    if (!botRef || !botRef.entity) return;
    const action = nextStep(state, config, Date.now());
    if (!action) return;
    const safe = maskSecret(action.command, action.password);
    try {
      botRef.chat(action.command);
    } catch (err) {
      logger.warn(`gagal mengirim ${safe}: ${err.message}`);
      return;
    }
    const label = action.type === 'register' ? 'register' : 'login';
    logger.info(`auto-${label} (${action.attempt}x): ${safe}`);
    if (onAction) onAction(action, state);
    if (state.attempts >= (Number(config.register.maxAttempts) || 3) && state.triedLogin && state.triedRegister) {
      stop();
    }
  }

  function handleChat(message) {
    const kind = applyChat(state, message);
    if (kind && logger) logger.debug(`chat ${kind}: ${message}`);
    return kind;
  }

  return { state, start, stop, handleChat, pump };
}

module.exports = {
  createRegisterAgent,
  createState,
  nextStep,
  applyChat,
  classifyChat,
  resolvePassword,
  NOT_REGISTERED_PATTERN,
  ALREADY_REGISTERED_PATTERN,
  REGISTERED_PATTERN,
  LOGGED_IN_PATTERN,
  LOGIN_FAILED_PATTERN,
  buildCommand,
  maskSecret
};