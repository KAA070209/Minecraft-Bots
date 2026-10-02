'use strict';

const fs = require('fs');
const path = require('path');

const COLORS = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m',
  white: '\u001b[37m'
};

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function timestamp() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function createLogger(options = {}) {
  const { file = null, color = true, level = 'info', maxLogFileBytes = 0, prefix = '' } = options;
  const useColor = color !== false && Boolean(process.stdout.isTTY);
  const threshold = LEVELS[level] ?? LEVELS.info;
  let stream = null;

  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (maxLogFileBytes > 0 && fs.existsSync(file) && fs.statSync(file).size > maxLogFileBytes) {
        fs.renameSync(file, `${file}.1`);
      }
      stream = fs.createWriteStream(file, { flags: 'a' });
      stream.on('error', () => { stream = null; });
    } catch {
      stream = null;
    }
  }

  const paint = (color, text) => (useColor && color ? `${color}${text}${COLORS.reset}` : text);
  const strip = (text) => String(text).replace(/\u001b\[[0-9;]*m/g, '');

  function write(severity, color, tag, message, toFile = true) {
    if ((LEVELS[severity] ?? LEVELS.info) < threshold) return;
    const line = `[${timestamp()}] ${tag} ${prefix}${message}`;
    if (severity === 'error') process.stderr.write(`${paint(color, line)}\n`);
    else process.stdout.write(`${paint(color, line)}\n`);
    if (stream && toFile) stream.write(`${strip(line)}\n`);
  }

  return {
    debug: (message) => write('debug', COLORS.gray, 'DEBUG', message),
    info: (message) => write('info', COLORS.cyan, 'INFO ', message),
    success: (message) => write('info', COLORS.green, 'OK   ', message),
    warn: (message) => write('warn', COLORS.yellow, 'WARN ', message),
    error: (message) => write('error', COLORS.red, 'ERROR', message),
    plain: (message) => write('info', COLORS.white, '     ', message),
    raw: (colorName, message) => write('info', COLORS[colorName] ?? colorName, '     ', message),
    formatDuration,
    close: () => {
      if (stream) stream.end();
      stream = null;
    }
  };
}

module.exports = { createLogger, formatDuration, COLORS, LEVELS };
