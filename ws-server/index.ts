/**
 * Standalone Socket.IO server for KAIROS.
 *
 * Runs as a separate process from Next.js.  Communicates with the
 * Next.js app via an HTTP internal-emit fallback (dev) or Redis
 * pub/sub (production with REDIS_NATIVE_URL).
 *
 * Usage:
 *   dev:  pnpm ws:dev          (tsx watch ws-server/index.ts)
 *   prod: node --import tsx ws-server/index.ts
 */

import { createServer } from "node:http";
import { Server, type DefaultEventsMap } from "socket.io";
import { verifyWsTicket } from "./auth";
import { registerRoomHandlers, type WsSocketData } from "./rooms";

const WS_PORT = parseInt(process.env.WS_PORT ?? "3001", 10);
const WS_SECRET = process.env.WS_SECRET;
const REDIS_NATIVE_URL = process.env.REDIS_NATIVE_URL;
const CORS_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// ── fatal checks ─────────────────────────────────────────────────────

if (!WS_SECRET || WS_SECRET.length < 32) {
  console.error(
    "FATAL: WS_SECRET missing or too short (min 32 chars). Set it in .env.",
  );
  process.exit(1);
}

// ── HTTP server + health endpoint ────────────────────────────────────

const httpServer = createServer((req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  // Internal emit endpoint (dev fallback — not callable by browser)
  if (req.method === "POST" && req.url === "/internal/emit") {
    const authHeader = req.headers["x-ws-secret"];
    if (authHeader !== WS_SECRET) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const { room, event, payload } = JSON.parse(body) as {
          room: string;
          event: string;
          payload: unknown;
        };
        if (room === "__broadcast__") {
          io.emit(event, payload);
        } else {
          io.to(room).emit(event, payload);
        }
        res.writeHead(200);
        res.end("OK");
      } catch {
        res.writeHead(400);
        res.end("Bad Request");
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

// ── Socket.IO server ─────────────────────────────────────────────────

// Typed with WsSocketData so `socket.data` is checked rather than `any`.
const io = new Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  WsSocketData
>(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

// ── Optional Redis peer-dependency shapes ────────────────────────────

/** Minimal structural types for the optional `redis` / redis-adapter packages. */
interface RedisClientLike {
  connect: () => Promise<unknown>;
  duplicate: () => RedisClientLike;
  pSubscribe: (
    pattern: string,
    listener: (message: string, channel: string) => void,
  ) => Promise<unknown>;
}

interface RedisModuleLike {
  createClient: (options: { url: string }) => RedisClientLike;
}

interface RedisAdapterModuleLike {
  createAdapter: (
    pubClient: RedisClientLike,
    subClient: RedisClientLike,
  ) => Parameters<typeof io.adapter>[0];
}

// ── Optional Redis adapter (multi-instance) ──────────────────────────

if (REDIS_NATIVE_URL) {
  void (async () => {
    try {
      // Both packages are optional peer dependencies that may not be installed,
      // so their imports cannot be type-resolved. Absorb each into `unknown` and
      // cast once against a declared shape, rather than letting `any` leak into
      // every downstream call.
      // @ts-expect-error -- redis is an optional peer dependency, may not be installed
      const redisMod: unknown = await import("redis");
      const { createClient } = redisMod as RedisModuleLike;
      // @ts-expect-error -- @socket.io/redis-adapter is an optional peer dependency
      const adapterMod: unknown = await import("@socket.io/redis-adapter");
      const { createAdapter } = adapterMod as RedisAdapterModuleLike;

      const pubClient = createClient({ url: REDIS_NATIVE_URL });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);

      io.adapter(createAdapter(pubClient, subClient));
      console.log("[ws] Redis adapter enabled for multi-instance scaling");

      // App-level Redis subscriber for app->WS fanout
      const appSubClient = pubClient.duplicate();
      await appSubClient.connect();
      await appSubClient.pSubscribe("ws:*", (message: string, channel: string) => {
        try {
          const parsed = JSON.parse(message) as {
            event: string;
            payload: unknown;
          };
          // Channel is "ws:user:123" -> room is "user:123"
          const firstColon = channel.indexOf(":");
          const room = channel.slice(firstColon + 1);
          io.to(room).emit(parsed.event, parsed.payload);
        } catch (err) {
          console.error("[ws] Redis message parse error", err);
        }
      });
      console.log("[ws] Subscribed to ws:* channels via Redis");
    } catch (err) {
      console.error("[ws] Failed to set up Redis adapter", err);
      console.warn("[ws] Running in single-instance mode (no Redis)");
    }
  })();
} else {
  console.warn(
    "[ws] REDIS_NATIVE_URL not set — running in single-instance mode (dev). " +
      "Using HTTP /internal/emit fallback for app->WS communication.",
  );
}

// ── Auth middleware (HMAC ticket verification) ───────────────────────

io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error("WS_UNAUTHORIZED"));
  }

  const payload = verifyWsTicket(token, WS_SECRET);
  if (!payload) {
    return next(new Error("WS_UNAUTHORIZED"));
  }

  socket.data.userId = payload.userId;
  socket.data.sessionId = payload.sessionId;
  next();
});

// ── Connection handler ───────────────────────────────────────────────

io.on("connection", (socket) => {
  const userId = socket.data.userId;
  if (!userId) {
    socket.disconnect(true);
    return;
  }

  console.log(
    `[ws] client connected — userId=${userId}, socketId=${socket.id}`,
  );

  // Auto-join private room
  void socket.join(`user:${userId}`);

  // Register room join/leave handlers (org, project, conversation, typing)
  registerRoomHandlers(socket);

  socket.on("disconnect", (reason: string) => {
    console.log(
      `[ws] client disconnected — userId=${userId}, reason=${reason}`,
    );
  });
});

// ── Start ────────────────────────────────────────────────────────────

httpServer.listen(WS_PORT, () => {
  console.log(`[ws] WebSocket server listening on port ${WS_PORT}`);
  console.log(`[ws] CORS origin: ${CORS_ORIGIN}`);
});
