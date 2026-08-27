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

export interface SocketMessageAttachment {
  id: number;
  url: string;
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface SocketNewMessage {
  messageId: number;
  conversationId: number;
  senderId: string;
  body: string;
  senderName: string | null;
  senderImage: string | null;
  createdAt: Date;
  attachments?: SocketMessageAttachment[];
  replyTo?: {
    id: number;
    body: string;
    senderName: string | null;
    deleted: boolean;
  } | null;
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

/**
 * "Your message was seen."
 *
 * Sent to the *reader's counterpart* only — the reader already knows what they
 * just read, and a frame back to them would only invite a needless refetch.
 */
export function emitMessageRead(
  recipientUserId: string,
  payload: { conversationId: number; userId: string; messageId: number },
) {
  publishUserEvent(recipientUserId, "message:read", payload);
}

/**
 * Edit, soft-delete and pin share one frame shape.
 *
 * A field left `undefined` means "unchanged" — a pin must not blank out a body,
 * and an edit must not clear a pin. `null` is a real value (deletedAt: null =
 * not deleted), which is why absence and null mean different things here.
 */
export interface SocketMessageUpdated {
  conversationId: number;
  messageId: number;
  body?: string;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  pinnedAt?: Date | null;
}

export function emitMessageUpdated(
  conversationId: number,
  participantUserIds: string[],
  payload: SocketMessageUpdated,
) {
  publishConversationEvent(conversationId, "message:updated", payload);
  for (const uid of participantUserIds) {
    publishUserEvent(uid, "message:updated", payload);
  }
}

/**
 * Reaction state after the change — the full set of reactor ids per emoji, not
 * a delta.
 *
 * Two reasons it carries ids rather than counts: the fan-out below delivers the
 * same frame to the conversation room *and* each user room, so a client can see
 * it twice and `+1` would double-count; and `mine` differs per viewer, so each
 * client has to derive its own from the ids.
 */
export interface SocketMessageReaction {
  conversationId: number;
  messageId: number;
  reactions: Array<{ emoji: string; userIds: string[] }>;
}

export function emitMessageReaction(
  conversationId: number,
  participantUserIds: string[],
  payload: SocketMessageReaction,
) {
  publishConversationEvent(conversationId, "message:reaction", payload);
  for (const uid of participantUserIds) {
    publishUserEvent(uid, "message:reaction", payload);
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
