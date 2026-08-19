/**
 * Socket.IO connection handler.
 *
 * Manages room joins/leaves and client-to-server events like typing indicators.
 */

import type { Socket, DefaultEventsMap } from "socket.io";
import { createLogger } from "~/server/logger";

const log = createLogger("socket");

export function handleConnection(socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, { userId: string }>) {
  const userId: string | undefined = socket.data.userId;
  if (!userId) {
    socket.disconnect(true);
    return;
  }

  log.debug("client connected", { userId, socketId: socket.id });

  // Auto-join the user's private room for notifications / agent events.
  void socket.join(`user:${userId}`);

  // -----------------------------------------------------------------------
  // Room management
  // -----------------------------------------------------------------------

  socket.on("join:conversation", (conversationId: unknown) => {
    if (typeof conversationId !== "number" && typeof conversationId !== "string") return;
    void socket.join(`conversation:${String(conversationId)}`);
  });

  socket.on("leave:conversation", (conversationId: unknown) => {
    if (typeof conversationId !== "number" && typeof conversationId !== "string") return;
    void socket.leave(`conversation:${String(conversationId)}`);
  });

  socket.on("join:project", (projectId: unknown) => {
    if (typeof projectId !== "number" && typeof projectId !== "string") return;
    void socket.join(`project:${String(projectId)}`);
  });

  socket.on("leave:project", (projectId: unknown) => {
    if (typeof projectId !== "number" && typeof projectId !== "string") return;
    void socket.leave(`project:${String(projectId)}`);
  });

  socket.on("join:org", (orgId: unknown) => {
    if (typeof orgId !== "number" && typeof orgId !== "string") return;
    void socket.join(`org:${String(orgId)}`);
  });

  socket.on("leave:org", (orgId: unknown) => {
    if (typeof orgId !== "number" && typeof orgId !== "string") return;
    void socket.leave(`org:${String(orgId)}`);
  });

  // -----------------------------------------------------------------------
  // Typing indicator (client → server → other clients in the room)
  // -----------------------------------------------------------------------

  socket.on(
    "message:typing",
    (data: unknown) => {
      if (
        typeof data !== "object" ||
        data === null ||
        typeof (data as Record<string, unknown>).conversationId === "undefined"
      )
        return;

      const { conversationId, isTyping } = data as {
        conversationId: number | string;
        isTyping: boolean;
      };

      // Broadcast to others in the conversation room (exclude sender).
      socket.to(`conversation:${String(conversationId)}`).emit("message:typing", {
        userId,
        isTyping: !!isTyping,
      });
    },
  );

  // -----------------------------------------------------------------------
  // Disconnect
  // -----------------------------------------------------------------------

  socket.on("disconnect", (reason: string) => {
    log.debug("client disconnected", { userId, reason });
    // Rooms are automatically cleaned up by Socket.IO on disconnect.
  });
}
