/**
 * Shared sliding-window counter behind both rate limiters.
 *
 * ## Why this exists
 *
 * `rateLimit.ts` and `authRateLimit.ts` each kept their own module-level `Map`,
 * and both files documented the consequence: the counter lives in one process's
 * memory, so the effective limit multiplies by the number of app instances and
 * resets on every deploy. For the AI limiter that Map was the only thing standing
 * between one user and unbounded LLM spend; for the auth limiter it was the only
 * thing slowing down password guessing. Serverless makes it worse — each cold
 * route handler starts with an empty window.
 *
 * Both now share this store, which uses Redis when `REDIS_NATIVE_URL` is
 * configured (the same variable the WebSocket event bus already uses, see
 * `~/server/redis/publisher`) and falls back to per-process memory when it is
 * not, so local development needs no extra service.
 *
 * ## Representation
 *
 * A window is a Redis sorted set whose members are individual hits scored by
 * timestamp. Counting is `ZREMRANGEBYSCORE` to drop what has aged out, then
 * `ZCARD`. This keeps the *sliding* semantics of the original implementation
 * rather than degrading to fixed buckets, which would let a caller spend two
 * windows' worth of budget across a boundary.
 *
 * Keys carry a `rl:` prefix so they cannot collide with the `ws:` pub/sub
 * channels on a shared Redis instance, and every key gets a TTL of one window so
 * abandoned entries expire without a cleanup sweep.
 *
 * ## Failure behaviour
 *
 * Redis errors fall back to the in-memory window for that call rather than
 * throwing. A rate limiter that takes the application down when its backing store
 * blips is worse than one that is briefly per-process — but note this means a
 * sustained Redis outage degrades to the old behaviour rather than failing
 * closed. That is the deliberate trade-off for a limiter that guards spend and
 * brute-force speed rather than correctness.
 */

import { createLogger } from "~/server/logger";

const REDIS_NATIVE_URL = process.env.REDIS_NATIVE_URL;

const KEY_PREFIX = "rl:";
const log = createLogger("rateLimit");

export interface WindowState {
  /** Hits currently inside the window. */
  count: number;
  /** Timestamp (epoch ms) of the oldest hit still in the window, or null. */
  oldest: number | null;
}

// ---------------------------------------------------------------------------
// Redis client (lazy, optional dependency)
// ---------------------------------------------------------------------------

/**
 * The subset of `redis` this module uses. `redis` is an optional dependency that
 * may not be installed, so the dynamic import cannot be type-resolved; absorbing
 * it into `unknown` and casting once here keeps `any` out of the call sites.
 * Mirrors the approach in `~/server/redis/publisher`.
 */
interface RedisLike {
  connect: () => Promise<unknown>;
  zAdd: (
    key: string,
    members: { score: number; value: string },
  ) => Promise<number>;
  zCard: (key: string) => Promise<number>;
  zRemRangeByScore: (
    key: string,
    min: number,
    max: number,
  ) => Promise<number>;
  zRangeWithScores: (
    key: string,
    start: number,
    stop: number,
  ) => Promise<{ value: string; score: number }[]>;
  pExpire: (key: string, ms: number) => Promise<boolean>;
  del: (key: string) => Promise<number>;
}

interface RedisModuleLike {
  createClient: (options: { url: string }) => RedisLike;
}

let client: RedisLike | null = null;
let connecting: Promise<RedisLike | null> | null = null;

async function getClient(): Promise<RedisLike | null> {
  if (!REDIS_NATIVE_URL) return null;
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      // `redis` is an optional dependency that may not be installed. The
      // specifier is held in a variable and marked `@vite-ignore` so that
      // bundlers treat this as a genuinely dynamic import instead of trying to
      // resolve it at build time — Vitest fails to transform this module
      // otherwise, since it imports the store transitively through the limiters.
      const specifier = "redis";
      const mod: unknown = await import(/* @vite-ignore */ specifier);
      const { createClient } = mod as RedisModuleLike;
      const created = createClient({ url: REDIS_NATIVE_URL });
      await created.connect();
      client = created;
      return client;
    } catch (err) {
      log.warn("redis unavailable, using in-process windows", { err });
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

/**
 * Held on `globalThis` so Next.js module reloading in development does not reset
 * every window on each edit — the same reason `~/server/db` caches its pool
 * there.
 */
const memoryStore: Map<string, number[]> = (() => {
  const g = globalThis as Record<string, unknown>;
  const existing = g.__kairosSlidingWindows;
  if (existing instanceof Map) return existing as Map<string, number[]>;
  const created = new Map<string, number[]>();
  g.__kairosSlidingWindows = created;
  return created;
})();

function memoryPrune(key: string, cutoff: number): number[] {
  const valid = (memoryStore.get(key) ?? []).filter((ts) => ts > cutoff);
  if (valid.length === 0) memoryStore.delete(key);
  else memoryStore.set(key, valid);
  return valid;
}

function memoryState(key: string, windowMs: number, now: number): WindowState {
  const valid = memoryPrune(key, now - windowMs);
  return { count: valid.length, oldest: valid[0] ?? null };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Read a window without recording a hit. */
export async function readWindow(
  key: string,
  windowMs: number,
  now = Date.now(),
): Promise<WindowState> {
  const redis = await getClient();
  if (!redis) return memoryState(key, windowMs, now);

  const rkey = KEY_PREFIX + key;
  try {
    await redis.zRemRangeByScore(rkey, 0, now - windowMs);
    const count = await redis.zCard(rkey);
    if (count === 0) return { count: 0, oldest: null };
    const [first] = await redis.zRangeWithScores(rkey, 0, 0);
    return { count, oldest: first?.score ?? null };
  } catch (err) {
    log.warn("window read failed, falling back to memory", { err });
    return memoryState(key, windowMs, now);
  }
}

/**
 * Record one hit and return the window state *including* it.
 *
 * Not atomic across the read and the write: two concurrent callers can both be
 * admitted at the boundary, overshooting the limit by at most the number of
 * in-flight requests. Making it exact needs a Lua script; for limits measured in
 * tens per window, the off-by-a-few is not worth the added moving part.
 */
export async function recordHit(
  key: string,
  windowMs: number,
  now = Date.now(),
): Promise<WindowState> {
  const redis = await getClient();
  if (!redis) {
    const valid = memoryPrune(key, now - windowMs);
    valid.push(now);
    memoryStore.set(key, valid);
    return { count: valid.length, oldest: valid[0] ?? now };
  }

  const rkey = KEY_PREFIX + key;
  try {
    await redis.zRemRangeByScore(rkey, 0, now - windowMs);
    // The member must be unique or ZADD updates the existing score instead of
    // adding a hit. Two hits in the same millisecond are otherwise possible.
    await redis.zAdd(rkey, {
      score: now,
      value: `${now}:${Math.random().toString(36).slice(2, 10)}`,
    });
    await redis.pExpire(rkey, windowMs);
    const count = await redis.zCard(rkey);
    const [first] = await redis.zRangeWithScores(rkey, 0, 0);
    return { count, oldest: first?.score ?? now };
  } catch (err) {
    log.warn("window write failed, falling back to memory", { err });
    const valid = memoryPrune(key, now - windowMs);
    valid.push(now);
    memoryStore.set(key, valid);
    return { count: valid.length, oldest: valid[0] ?? now };
  }
}

/** Drop a window entirely — used after a successful sign-in. */
export async function clearWindow(key: string): Promise<void> {
  memoryStore.delete(key);

  const redis = await getClient();
  if (!redis) return;
  try {
    await redis.del(KEY_PREFIX + key);
  } catch (err) {
    log.warn("window clear failed", { err });
  }
}

/** Test seam: drop every in-memory window. Does not touch Redis. */
export function __resetMemoryWindows(): void {
  memoryStore.clear();
}
