import { describe, it, expect } from "vitest";

import {
  appendMessage,
  dropMessage,
  hasMessage,
  isOptimistic,
  nextOptimisticId,
  replaceMessage,
  seedPage,
  type ChatMessage,
  type MessagesData,
} from "~/components/chat/messageCache";

/**
 * These cover the two invariants direct chat depends on, both of which were
 * broken before: which page a new message belongs on, and which placeholder a
 * completed send is allowed to remove.
 */

function msg(id: number, body = `m${id}`): ChatMessage {
  return {
    id,
    body,
    createdAt: new Date(2026, 0, 1),
    senderId: "u1",
    senderName: null,
    senderImage: null,
  };
}

/** Pages run oldest -> newest, the order `fetchPreviousPage` produces. */
function data(...pages: ChatMessage[][]): MessagesData {
  return {
    pages: pages.map((messages) => ({ messages, prevCursor: undefined })),
    pageParams: pages.map(() => null),
  };
}

const flat = (d: MessagesData) => d.pages.flatMap((p) => p.messages).map((m) => m.body);

describe("optimistic ids", () => {
  it("never collides, even within the same millisecond", () => {
    // `-Date.now()` handed two sends in the same tick the same id, and the
    // second overwrote the first in place.
    const ids = Array.from({ length: 50 }, () => nextOptimisticId());
    expect(new Set(ids).size).toBe(50);
  });

  it("stays negative so it cannot collide with a stored row id", () => {
    expect(isOptimistic(nextOptimisticId())).toBe(true);
    expect(isOptimistic(1)).toBe(false);
  });
});

describe("appendMessage", () => {
  it("adds to the newest page, which is the last one", () => {
    const before = data([msg(1, "old")], [msg(2, "recent")]);
    expect(flat(appendMessage(before, msg(3, "new")))).toEqual([
      "old",
      "recent",
      "new",
    ]);
  });

  it("keeps a new message last after history is prepended", () => {
    // The regression: with `fetchNextPage` the older page landed at the end,
    // so "newest page" resolved to the oldest one and new messages were filed
    // into the middle of the thread.
    const withHistory = data([msg(1, "older")], [msg(5, "latest")]);
    const result = appendMessage(withHistory, msg(6, "just sent"));
    expect(flat(result).at(-1)).toBe("just sent");
  });

  it("seeds an empty cache with a single page", () => {
    const seeded = seedPage(msg(-1, "first"));
    expect(seeded.pages).toHaveLength(1);
    expect(flat(seeded)).toEqual(["first"]);
  });
});

describe("replaceMessage", () => {
  it("swaps the placeholder in place rather than moving it", () => {
    const before = data([msg(-1, "pending"), msg(9, "arrived")]);
    const after = replaceMessage(before, -1, msg(10, "stored"));
    expect(flat(after)).toEqual(["stored", "arrived"]);
  });

  it("leaves a second in-flight send alone", () => {
    // Two sends before either resolves. Completing the first must not disturb
    // the second — the old "remove every negative id" made it disappear.
    const before = data([msg(-1, "first"), msg(-2, "second")]);
    const after = replaceMessage(before, -1, msg(11, "first stored"));
    expect(flat(after)).toEqual(["first stored", "second"]);
  });

  it("appends when the placeholder is already gone", () => {
    // A refetch can rebuild the pages mid-flight. Losing the message is worse
    // than showing it out of a strictly correct position.
    const before = data([msg(9, "arrived")]);
    expect(flat(replaceMessage(before, -1, msg(12, "stored")))).toEqual([
      "arrived",
      "stored",
    ]);
  });
});

describe("dropMessage", () => {
  it("removes only the failed send", () => {
    const before = data([msg(-1, "failed"), msg(-2, "still going"), msg(3, "real")]);
    expect(flat(dropMessage(before, -1))).toEqual(["still going", "real"]);
  });

  it("is a no-op without an id", () => {
    const before = data([msg(1, "a")]);
    expect(dropMessage(before, undefined)).toBe(before);
  });
});

describe("hasMessage", () => {
  it("finds a message on any loaded page", () => {
    // The server fans a message out to the conversation room and to each
    // participant's user room, so an open chat receives it twice.
    const d = data([msg(1)], [msg(2)]);
    expect(hasMessage(d, 1)).toBe(true);
    expect(hasMessage(d, 2)).toBe(true);
    expect(hasMessage(d, 3)).toBe(false);
  });
});
