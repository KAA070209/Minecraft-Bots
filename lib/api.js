'use strict';

const http = require('http');
const crypto = require('crypto');

const { createController } = require('./control');

const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 10000;
const RATE_MAX = 60;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function readToken(req, url) {
  const header = String(req.headers.authorization || '');
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '').trim();
  const key = String(req.headers['x-api-token'] || '').trim();
  if (key) return key;
  return url.searchParams.get('token') || '';
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createRateLimiter() {
  const hits = new Map();
  return function allow(key) {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((at) => now - at < RATE_WINDOW_MS);
    if (list.length >= RATE_MAX) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 200) hits.clear();
    return true;
  };
}

async function startControlApi({ config, logger, getTargets, onEvent } = {}) {
  const settings = (config && config.api) || {};
  const log = logger || {
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
    debug: () => {},
    plain: () => {}
  };

  if (!settings.enabled) {
    log.info('api kontrol dimatikan (api.enabled=false)');
    return null;
  }

  const token = String(settings.token || '').trim();
  if (!token) {
    log.warn('api kontrol tidak dijalankan: api.token belum diisi (isi token, atau pakai env MC_API_TOKEN)');
    return null;
  }

  const host = String(settings.host || '127.0.0.1');
  const port = settings.port === 0 ? 0 : Number(settings.port) || 8787;
  const logRequests = settings.logRequests !== false;
  const startedAt = Date.now();
  const allow = createRateLimiter();
  const controller = createController({ getTargets, onEvent });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const started = Date.now();

    const send = (code, payload) => {
      const body = JSON.stringify(payload, null, 2);
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
      });
      res.end(body);
      if (logRequests) {
        log.info(
          `api ${req.method} ${url.pathname} dari ${clientIp(req)} -> ${code} (${Date.now() - started}ms)` +
          `${payload && payload.command ? ` | ${payload.command}` : ''}`
        );
      }
    };

    const fail = (code, message) => send(code, { ok: false, error: message });

    if (url.pathname === '/health') {
      send(200, {
        ok: true,
        service: 'mc-afk-bot-control',
        uptimeMs: Date.now() - startedAt,
        bots: (getTargets ? getTargets() || [] : []).length
      });
      return;
    }

    if (!allow(clientIp(req))) {
      fail(429, `terlalu banyak permintaan (maks ${RATE_MAX} per ${RATE_WINDOW_MS / 1000} detik)`);
      return;
    }

    if (!safeEqual(readToken(req, url), token)) {
      fail(401, 'token tidak valid atau tidak ada (pakai header "Authorization: Bearer <token>")');
      return;
    }

    const handle = async () => {
      if (url.pathname === '/api/commands' && req.method === 'GET') {
        send(200, { ok: true, commands: controller.commands() });
        return;
      }

      if (url.pathname === '/api/status' && req.method === 'GET') {
        const result = await controller.execute('status');
        send(200, { ...result, bots: controller.targets().map((target) => ({ name: target.name, status: target.status })) });
        return;
      }

      if (url.pathname === '/api/command' && req.method === 'POST') {
        const raw = await readBody(req);
        let line = url.searchParams.get('line') || '';
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            line = parsed.line || parsed.command || line;
          } catch {
            line = line || raw;
          }
        }
        line = String(line || '').trim();
        if (!line) {
          fail(400, 'kirim body JSON { "line": "attack jack01 on" } atau ?line=...');
          return;
        }
        const result = await controller.execute(line);
        // Perintah yang jalan tapiiliknya hasil "gagal" (mis. bot belum spawn)
        // tetap HTTP 200: status memakai isi body, bukan kode HTTP.
        send(200, result);
        return;
      }

      fail(404, `endpoint tidak dikenal: ${req.method} ${url.pathname}`);
    };

    handle().catch((err) => fail(500, `gagal menangani permintaan: ${err.message}`));
  });

  server.on('error', (err) => log.error(`api kontrol gagal listen: ${err.message}`));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const shown = typeof address === 'object' && address ? `${host}:${address.port}` : `${host}:${port}`;
  log.success(`api kontrol listen di http://${shown} (endpoint /api/command, token wajib)`);

  return {
    server,
    port: typeof address === 'object' && address ? address.port : port,
    host,
    close: () =>
      new Promise((done) => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close(() => done());
      })
  };
}

module.exports = { startControlApi, safeEqual };