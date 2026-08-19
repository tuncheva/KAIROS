/**
 * Socket.IO emit helpers — safe to import from any tRPC router.
 *
 * Routes events through the publisher -> standalone WS server pipeline
 * (Redis pub/sub in production, HTTP /internal/emit fallback in dev).
 *
 * This file preserves the same public API as the old in-process approach
 * so existing router call sites don't need to change.
 */

import {
  publishUserEvent,
  publishNotificationToUser,
  publishConversationEvent,
  publishEventsFeedEvent,
} from "~/server/redis/publisher";

// -------------------------------------------------------------------------
// Chat events
// -------------------------------------------------------------------------

export interface SocketNewMessage {
  messageId: number;
  conversationId: number;
  senderId: string;
  body: string;
  senderName: string | null;
  senderImage: string | null;
  createdAt: Date;
}

export function emitNewMessage(msg: SocketNewMessage, participantUserIds?: string[]) {
  // Always emit to conversation room (for clients with conversation open)
  publishConversationEvent(msg.conversationId, "message:new", msg);
  
  // Also emit to each participant's user room so they receive it even if
  // they haven't selected/joined that specific conversation yet
  if (participantUserIds) {
    for (const uid of participantUserIds) {
      publishUserEvent(uid, "message:new", msg);
    }
  }
}

export function emitConversationUpdated(
  userIds: string[],
  payload: { conversationId: number; lastMessageAt: Date },
) {
  for (const uid of userIds) {
    publishUserEvent(uid, "conversation:updated", payload);
  }
}

// -------------------------------------------------------------------------
// Notification events
// -------------------------------------------------------------------------

export interface SocketNewNotification {
  id: number | string;
  type: string;
  title: string;
  message: string;
  link?: string | null;
}

export function emitNotification(userId: string, notif: SocketNewNotification) {
  publishNotificationToUser(userId, notif);
}

// -------------------------------------------------------------------------
// Event feed events (real-time updates without refresh)
// -------------------------------------------------------------------------

// Scoped to the feed room rather than broadcast to every connected socket.
// `publishBroadcast` maps to `io.emit` on the WS server, so these two events used
// to wake every client in the system — including everyone who has never opened the
// events page — each time any event changed.

export function emitEventDeleted(eventId: number) {
  publishEventsFeedEvent("event:deleted", { eventId });
}

export function emitEventUpdated(eventId: number) {
  publishEventsFeedEvent("event:updated", { eventId });
}

// -------------------------------------------------------------------------
// Agent events
// -------------------------------------------------------------------------

export function emitAgentThinking(
  userId: string,
  payload: { agentId: string; status: "thinking" | "done" | "error" },
) {
  publishUserEvent(userId, "agent:thinking", payload);
}

export function emitAgentResult(
  userId: string,
  payload: { agentId: string; draftId?: number; summary: string },
) {
  publishUserEvent(userId, "agent:result", payload);
}
