/**
 * Socket.IO server — initialised once, attached to the Node HTTP server.
 *
 * Responsibilities: push events only (messages, notifications, agent status).
 * All CRUD / auth stays on tRPC.
 */

import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "node:http";
import { socketAuthMiddleware } from "./auth";
import { handleConnection } from "./handlers";
import { createLogger } from "~/server/logger";

const log = createLogger("socket");

let io: SocketIOServer | null = null;

/**
 * Create and attach Socket.IO to the given HTTP server.
 * Safe to call multiple times — returns the same instance.
 */
export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    path: "/api/socketio",
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use(socketAuthMiddleware as Parameters<typeof io.use>[0]);
  io.on("connection", handleConnection as Parameters<(typeof io)["on"]>[1]);

  log.debug("[Socket.IO] initialised on path /api/socketio");
  return io;
}

/**
 * Get the global Socket.IO instance.
 * Throws if called before `initSocketIO`.
 */
export function getIO(): SocketIOServer {
  if (!io) throw new Error("Socket.IO not initialised — call initSocketIO first");
  return io;
}

/**
 * Returns the global Socket.IO instance or `null` if not yet initialised.
 * Useful for optional emit paths that should not crash when running
 * without a custom server (e.g. during tests or `next dev --turbo`).
 */
export function getIOSafe(): SocketIOServer | null {
  return io;
}
