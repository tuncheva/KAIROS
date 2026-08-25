"use client";

/**
 * Cache surgery for the `chat.listMessages` infinite query.
 *
 * Direct chat is socket-driven: messages arrive as `message:new` frames and are
 * written straight into the react-query cache rather than triggering a refetch.
 * That only stays correct if every writer agrees on two things, which is what
 * this module exists to enforce:
 *
 *  1. **Page order.** `listMessages` returns a `prevCursor`, so history is
 *     fetched with `fetchPreviousPage` and react-query *prepends* it. `pages`
 *     therefore runs oldest -> newest, and the page a new message belongs on is
 *     the **last** one. (Paging with `fetchNextPage` instead appends history
 *     after the newest page, at which point "last page" means the oldest one
 *     and new messages land in the middle of the thread.)
 *
 *  2. **Identity.** A pending message carries a negative placeholder id until
 *     the server returns the stored row. Replacements must target that exact
 *     id — "remove everything negative" corrupts any send still in flight.
 */

import type { InfiniteData } from "@tanstack/react-query";
import type { RouterOutputs } from "~/trpc/react";

export type MessagesPage = RouterOutputs["chat"]["listMessages"];
export type ChatMessage = MessagesPage["messages"][number];
export type MessagesData = InfiniteData<MessagesPage, number | null>;

/**
 * A placeholder id for a message that has not been stored yet.
 *
 * Negative so it can never collide with a real identity-column id, and
 * counter-based so two sends in the same millisecond get different ids —
 * `-Date.now()` alone hands both the same one, and the second send then
 * overwrites the first in place.
 */
let optimisticCounter = 0;
export function nextOptimisticId(): number {
  optimisticCounter += 1;
  return -optimisticCounter;
}

/**
 * Everything a message carries beyond its text, at the values a brand-new one
 * has.
 *
 * Exported so the two chat surfaces build the same shape: a message constructed
 * by hand — an optimistic send, a socket frame — has to be a complete
 * `ChatMessage` or the renderer hits an undefined `attachments` and throws.
 */
export const NEW_MESSAGE_EXTRAS: Pick<
  ChatMessage,
  "editedAt" | "deletedAt" | "pinnedAt" | "attachments" | "reactions" | "replyTo"
> = {
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  attachments: [],
  reactions: [],
  replyTo: null,
};

/** Is this id a not-yet-stored placeholder? */
export function isOptimistic(id: number): boolean {
  return id < 0;
}

/** Does any loaded page already hold this message? */
export function hasMessage(data: MessagesData, id: number): boolean {
  return data.pages.some((page) => page.messages.some((m) => m.id === id));
}

/** The empty cache a first optimistic send writes into. */
export function seedPage(message: ChatMessage): MessagesData {
  return {
    pages: [{ messages: [message], prevCursor: undefined, peerLastReadMessageId: null }],
    pageParams: [null],
  };
}

/**
 * Apply a patch to one message wherever it sits, leaving its position alone.
 *
 * Edits, soft-deletes, pins and reaction changes all arrive as partial updates
 * for a message that may be on any loaded page. A missing id is not an error —
 * the message simply is not in the window the user has scrolled to.
 */
export function patchMessage(
  data: MessagesData,
  id: number,
  patch: Partial<ChatMessage>,
): MessagesData {
  return {
    ...data,
    pages: data.pages.map((page) =>
      page.messages.some((m) => m.id === id)
        ? {
            ...page,
            messages: page.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
          }
        : page,
    ),
  };
}

/**
 * Record how far the other participant has read.
 *
 * Held on the newest page because that is the only one the receipt is ever read
 * from, and monotonic for the same reason the server-side pointer is: an
 * out-of-order frame must not un-see a message.
 */
export function setPeerRead(data: MessagesData, messageId: number): MessagesData {
  const newest = data.pages.length - 1;
  if (newest < 0) return data;
  const current = data.pages[newest]?.peerLastReadMessageId ?? 0;
  if (messageId <= current) return data;
  return {
    ...data,
    pages: data.pages.map((page, i) =>
      i === newest ? { ...page, peerLastReadMessageId: messageId } : page,
    ),
  };
}

/**
 * How far the other participant has read, across whatever pages are loaded.
 *
 * Takes the page shape rather than `MessagesData` on purpose: the cache writers
 * are handed pages whose param type is `number | null`, while the query's own
 * `data` uses `number | undefined`. Reading only the field it needs lets one
 * function serve both without a cast.
 */
export function peerReadId(
  data: { pages: Array<{ peerLastReadMessageId: number | null }> } | undefined,
): number {
  if (!data) return 0;
  return data.pages.reduce((max, page) => Math.max(max, page.peerLastReadMessageId ?? 0), 0);
}

/** Add a message to the newest page — the last one, given the ordering above. */
export function appendMessage(data: MessagesData, message: ChatMessage): MessagesData {
  const newest = data.pages.length - 1;
  return {
    ...data,
    pages: data.pages.map((page, i) =>
      i === newest ? { ...page, messages: [...page.messages, message] } : page,
    ),
  };
}

/** Swap one message for another, leaving its position in the thread alone. */
export function replaceMessage(
  data: MessagesData,
  id: number,
  message: ChatMessage,
): MessagesData {
  let found = false;
  const pages = data.pages.map((page) => {
    if (!page.messages.some((m) => m.id === id)) return page;
    found = true;
    return {
      ...page,
      messages: page.messages.map((m) => (m.id === id ? message : m)),
    };
  });
  /* The placeholder can be gone already — a refetch mid-flight rebuilds the
     pages from the server. Losing the message entirely is the worse outcome. */
  return found ? { ...data, pages } : appendMessage(data, message);
}

/** Remove a message, used to roll back a send that failed. */
export function dropMessage(data: MessagesData, id: number | undefined): MessagesData {
  if (id === undefined) return data;
  return {
    ...data,
    pages: data.pages.map((page) =>
      page.messages.some((m) => m.id === id)
        ? { ...page, messages: page.messages.filter((m) => m.id !== id) }
        : page,
    ),
  };
}
