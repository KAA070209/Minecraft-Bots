'use strict';

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function createApiClient({ baseUrl, token, timeoutMs = 20000 }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, query } = {}) {
    const url = new URL(root + path);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { raw: text };
      }
      if (!response.ok) {
        const message = (payload && payload.error) || `HTTP ${response.status}`;
        throw new ApiError(message, response.status, payload);
      }
      return payload;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new ApiError(`timeout ${timeoutMs}ms saat menghubungi ${root}`, 0, null);
      }
      if (err instanceof ApiError) throw err;
      throw new ApiError(`tidak bisa menghubungi API di ${root}: ${err.message}`, 0, null);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    root,
    health: () => request('/health'),
    status: () => request('/api/status'),
    commands: () => request('/api/commands'),
    command: (line) => request('/api/command', { method: 'POST', body: { line } })
  };
}

module.exports = { createApiClient, ApiError };