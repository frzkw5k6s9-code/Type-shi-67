/**
 * Small in-memory fixed-window rate limiter (single-process deployment).
 * Memory is bounded so that an attacker spraying random keys cannot exhaust RAM.
 */
export class RateLimiter {
  constructor({ maxKeys = 100_000 } = {}) {
    this.map = new Map(); // key -> { count, resetAt }
    this.maxKeys = maxKeys;
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref?.();
  }

  sweep(now = Date.now()) {
    for (const [k, v] of this.map) if (v.resetAt <= now) this.map.delete(k);
  }

  /** Is `key` already at/over `limit` within its current window? */
  check(key, limit, now = Date.now()) {
    const e = this.map.get(key);
    if (!e || e.resetAt <= now) return { ok: true, retryAfter: 0 };
    return e.count >= limit ? { ok: false, retryAfter: Math.ceil((e.resetAt - now) / 1000) } : { ok: true, retryAfter: 0 };
  }

  /** Count one event against `key`. */
  add(key, windowMs, now = Date.now()) {
    let e = this.map.get(key);
    if (!e || e.resetAt <= now) {
      if (this.map.size >= this.maxKeys) {
        this.sweep(now);
        if (this.map.size >= this.maxKeys) {
          // still full: drop the oldest half (Map preserves insertion order)
          let n = Math.floor(this.map.size / 2);
          for (const k of this.map.keys()) { if (n-- <= 0) break; this.map.delete(k); }
        }
      }
      e = { count: 0, resetAt: now + windowMs };
      this.map.set(key, e);
    }
    e.count += 1;
    return e.count;
  }

  /** check + add in one step. */
  hit(key, [limit, windowMs], now = Date.now()) {
    const c = this.check(key, limit, now);
    if (!c.ok) return c;
    this.add(key, windowMs, now);
    return c;
  }

  reset(key) {
    this.map.delete(key);
  }

  close() {
    clearInterval(this.timer);
  }
}
