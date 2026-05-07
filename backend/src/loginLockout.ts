// backend/src/loginLockout.ts
//
// Per-key (username + ip) sliding-window login failure tracker. In-memory; fine
// for a single-process backend. If we ever scale horizontally, swap this for a
// shared store (Redis or a sqlite table).

import { config } from './config';

type Entry = {
  failures: number[]; // timestamps (ms) of recent failures
  lockedUntil: number; // 0 if not locked
};

const store = new Map<string, Entry>();

function cleanup(entry: Entry, now: number) {
  const cutoff = now - config.auth.loginFailureWindowMs;
  entry.failures = entry.failures.filter((t) => t >= cutoff);
}

export function isLocked(key: string): { locked: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) return { locked: false };
  if (entry.lockedUntil > now) {
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }
  if (entry.lockedUntil !== 0 && entry.lockedUntil <= now) {
    // Lock expired, reset.
    entry.lockedUntil = 0;
    entry.failures = [];
  }
  return { locked: false };
}

/** Record a failed login. Returns true if the key is now locked. */
export function recordFailure(key: string): boolean {
  const now = Date.now();
  const entry = store.get(key) || { failures: [], lockedUntil: 0 };
  cleanup(entry, now);
  entry.failures.push(now);
  if (entry.failures.length >= config.auth.loginMaxFailures) {
    entry.lockedUntil = now + config.auth.loginLockoutMs;
  }
  store.set(key, entry);
  return entry.lockedUntil > now;
}

/** Clear failure history (call on success). */
export function recordSuccess(key: string): void {
  store.delete(key);
}

/**
 * Periodic GC so the map doesn't grow forever. Call once at startup.
 */
export function startLockoutGc(intervalMs = 5 * 60_000) {
  const handle = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of store) {
      cleanup(e, now);
      if (e.failures.length === 0 && (e.lockedUntil === 0 || e.lockedUntil <= now)) {
        store.delete(k);
      }
    }
  }, intervalMs);
  // Don't keep the event loop alive on this timer alone.
  if (typeof handle.unref === 'function') handle.unref();
  return handle;
}
