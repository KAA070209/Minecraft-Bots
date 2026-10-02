'use strict';

class Backoff {
  constructor(options = {}) {
    const { baseMs = 5000, maxMs = 120000, factor = 1.8, jitter = 0.25 } = options;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.factor = factor;
    this.jitter = jitter;
    this.attempt = 0;
  }

  reset() {
    this.attempt = 0;
  }

  next(extraMs = 0) {
    const raw = this.baseMs * Math.pow(this.factor, this.attempt);
    const capped = Math.min(raw, this.maxMs);
    const spread = capped * this.jitter;
    const delay = capped - spread + Math.random() * spread * 2;
    this.attempt += 1;
    return Math.round(Math.min(delay + extraMs, this.maxMs + extraMs));
  }

  peek() {
    return Math.min(this.baseMs * Math.pow(this.factor, this.attempt), this.maxMs);
  }
}

module.exports = { Backoff };
