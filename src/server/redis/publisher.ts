/**
 * Publisher: app -> WS server event bus.
 *
 * Primary path (production):  Redis pub/sub  ws:{scope}:{id}
 * Fallback path (dev):        HTTP POST to WS server /internal/emit
 *
 * All publish calls are best-effort — errors are logged, never thrown.
 */

const REDIS_NATIVE_URL = process.env.REDIS_NATIVE_URL;
const WS_INTERNAL_URL =
  process.env.WS_INTERNAL_URL ?? "http://localhost:3001";
const WS_SECRET = process.env.WS_SECRET ?? "";

// ── Redis client (lazy init) ─────────────────────────────────────────

/**
 * Minimal structural type for the parts of `redis` this module uses.
 *
 * `redis` is an optional peer dependency that may not be installed, so the
 * dynamic import below cannot be type-resolved. Absorbing it into `unknown` and
 * casting once against this shape keeps the `any` from leaking into every
 * downstream call.
 */
interface RedisClientLike {
  publish: (channel: string, message: string) => Promise<number>;
  connect: () => Promise<unknown>;
}

interface RedisModuleLike {
  createClient: (options: { url: string }) => RedisClientLike;
}

let redisPublisher: RedisClientLike | null = null;
let redisInitializing = false;

async function getRedisPublisher(): Promise<RedisClientLike | null> {
  if (redisPublisher) return redisPublisher;
  if (!REDIS_NATIVE_URL || redisInitializing) return null;

  redisInitializing = true;
  try {
    // @ts-expect-error -- redis is an optional peer dependency, may not be installed
    const mod: unknown = await import("redis");
    const { createClient } = mod as RedisModuleLike;
    const client = createClient({ url: REDIS_NATIVE_URL });
    await client.connect();
    redisPublisher = client;
    console.log("[publisher] Redis publisher connected");
    return redisPublisher;
  } catch (err) {
    console.error("[publisher] Failed to connect Redis publisher", err);
    redisInitializing = false;
    return null;
  }
}

// ── core publish ─────────────────────────────────────────────────────

async function publish(
  scope: "user" | "org" | "project" | "conversation",
  id: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const channel = `ws:${scope}:${id}`;
  const room = `${scope}:${id}`;
  const envelope = JSON.stringify({ event, payload });

  // Try Redis first
  if (REDIS_NATIVE_URL) {
    try {
      const pub = await getRedisPublisher();
      if (pub) {
        await pub.publish(channel, envelope);
        return;
      }
    } catch (err) {
      console.error("[publisher] Redis publish failed, falling back to HTTP", err);
    }
  }

  // HTTP fallback (dev mode)
  try {
    const res = await fetch(`${WS_INTERNAL_URL}/internal/emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ws-secret": WS_SECRET,
      },
      body: JSON.stringify({ room, event, payload }),
    });
    if (!res.ok) {
      console.error(
        `[publisher] HTTP fallback failed: ${res.status} ${res.statusText}`,
      );
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[publisher] HTTP fallback failed (WS server may not be running)",
        (err as Error).message,
      );
    }
  }
}

// ── convenience methods ──────────────────────────────────────────────

/**
 * Publish an event to a specific user's private room.
 */
export function publishUserEvent(
  userId: string,
  event: string,
  payload: unknown,
): void {
  void publish("user", userId, event, payload);
}

/**
 * Publish a notification:new event to a user — the universal bell refresh.
 */
export function publishNotificationToUser(
  userId: string,
  payload: {
    id: number | string;
    type: string;
    title: string;
    message: string;
    link?: string | null;
  },
): void {
  void publish("user", userId, "notification:new", payload);
}

/**
 * Publish an event to an organization room.
 */
export function publishOrgEvent(
  orgId: string,
  event: string,
  payload: unknown,
): void {
  void publish("org", orgId, event, payload);
}

/**
 * Publish an event to a project room.
 */
export function publishProjectEvent(
  projectId: string,
  event: string,
  payload: unknown,
): void {
  void publish("project", projectId, event, payload);
}

/**
 * Publish an event to a conversation room.
 */
export function publishConversationEvent(
  conversationId: string | number,
  event: string,
  payload: unknown,
): void {
  void publish("conversation", String(conversationId), event, payload);
}

/**
 * Broadcast to all connected clients (publishes to each scope).
 * For events that need global broadcast, publish to a well-known room.
 */
export function publishBroadcast(event: string, payload: unknown): void {
  // Redis and the HTTP endpoint are alternatives, not a pair. This previously
  // published via Redis *and then unconditionally* POSTed, so with Redis
  // configured every broadcast was delivered to every client twice.
  if (REDIS_NATIVE_URL) {
    void publish("user", "__broadcast__", event, payload);
    return;
  }

  // HTTP fallback (dev / no Redis). The WS server maps the "__broadcast__" room
  // to io.emit, since having every client join a shared room isn't practical.
  const body = JSON.stringify({ room: "__broadcast__", event, payload });

  void fetch(`${WS_INTERNAL_URL}/internal/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ws-secret": WS_SECRET,
    },
    body,
  }).catch((err: Error) => {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[publisher] broadcast HTTP fallback failed", err.message);
    }
  });
}
