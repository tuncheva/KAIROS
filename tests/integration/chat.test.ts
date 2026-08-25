import { beforeAll, afterAll, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import * as schema from "~/server/db/schema";

import {
  createHarness,
  describeIntegration,
  makeUser,
  type Harness,
} from "./harness";

/**
 * The redesigned chat, executed end to end through real tRPC procedures.
 *
 * These cover the behaviours the rebuild introduced, and in three cases the bugs
 * it fixed — a delete that destroyed both participants' history, a notification
 * written per message, and a body that could not be empty even with a file
 * attached. Each of those would fail against the previous implementation.
 */

let h: Harness;

beforeAll(async () => {
  h = await createHarness("chat");
}, 180_000);

afterAll(async () => {
  await h?.cleanup();
});

/** Two users with a conversation between them, plus their callers. */
async function pair() {
  const alice = await makeUser(h.db);
  const bob = await makeUser(h.db);
  const asAlice = h.caller(alice.id);
  const asBob = h.caller(bob.id);

  const { conversationId } = await asAlice.chat.getOrCreateDirectConversation({
    otherUserId: bob.id,
  });

  return { alice, bob, asAlice, asBob, conversationId };
}

describeIntegration("chat: participants", () => {
  it("creates a participant row for both people", async () => {
    const { conversationId, alice, bob } = await pair();

    const rows = await h.db
      .select()
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.conversationId, conversationId));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([alice.id, bob.id].sort());
  });

  it("refuses a non-participant", async () => {
    const { conversationId } = await pair();
    const stranger = await makeUser(h.db);

    await expect(
      h.caller(stranger.id).chat.listMessages({ conversationId, limit: 50 }),
    ).rejects.toBeInstanceOf(TRPCError);
    await expect(
      h.caller(stranger.id).chat.sendMessage({ conversationId, body: "hello" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describeIntegration("chat: unread and read receipts", () => {
  it("counts only the other person's messages, and clears on markRead", async () => {
    const { asAlice, asBob, conversationId } = await pair();

    await asBob.chat.sendMessage({ conversationId, body: "one" });
    await asBob.chat.sendMessage({ conversationId, body: "two" });

    const forAlice = (await asAlice.chat.listAllConversations()).find((c) => c.id === conversationId);
    expect(forAlice?.unreadCount).toBe(2);
    expect((await asAlice.chat.getUnreadTotal()).total).toBe(2);

    /* Replying is reading: Alice's own send advances her pointer past Bob's
       messages, so the badge clears without an explicit markRead. */
    const own = await asAlice.chat.sendMessage({ conversationId, body: "mine" });

    const afterReply = (await asAlice.chat.listAllConversations()).find((c) => c.id === conversationId);
    expect(afterReply?.unreadCount).toBe(0);

    /* ...and Alice's message is now unread for Bob, but not for Alice. */
    const forBob = (await asBob.chat.listAllConversations()).find((c) => c.id === conversationId);
    expect(forBob?.unreadCount).toBe(1);

    await asBob.chat.markRead({ conversationId, messageId: own.id });

    const bobAfter = (await asBob.chat.listAllConversations()).find((c) => c.id === conversationId);
    expect(bobAfter?.unreadCount).toBe(0);
    expect((await asBob.chat.getUnreadTotal()).total).toBe(0);
  });

  it("never rewinds the read pointer", async () => {
    const { asAlice, asBob, conversationId } = await pair();

    const first = await asBob.chat.sendMessage({ conversationId, body: "first" });
    const second = await asBob.chat.sendMessage({ conversationId, body: "second" });

    await asAlice.chat.markRead({ conversationId, messageId: second.id });
    /* An out-of-order frame, or scrolling back up through history. */
    const result = await asAlice.chat.markRead({ conversationId, messageId: first.id });

    expect(result.lastReadMessageId).toBe(second.id);
  });

  it("reports how far the peer has read", async () => {
    const { asAlice, asBob, conversationId } = await pair();

    const sent = await asAlice.chat.sendMessage({ conversationId, body: "seen this?" });

    let page = await asAlice.chat.listMessages({ conversationId, limit: 50 });
    expect(page.peerLastReadMessageId ?? 0).toBeLessThan(sent.id);

    await asBob.chat.markRead({ conversationId, messageId: sent.id });

    page = await asAlice.chat.listMessages({ conversationId, limit: 50 });
    expect(page.peerLastReadMessageId).toBe(sent.id);
  });

  it("keeps a muted conversation out of the global badge but not its own row", async () => {
    const { asAlice, asBob, conversationId } = await pair();

    await asBob.chat.sendMessage({ conversationId, body: "noisy" });
    expect((await asAlice.chat.getUnreadTotal()).total).toBe(1);

    await asAlice.chat.setConversationPrefs({ conversationId, muted: true });

    expect((await asAlice.chat.getUnreadTotal()).total).toBe(0);
    const row = (await asAlice.chat.listAllConversations()).find((c) => c.id === conversationId);
    expect(row?.muted).toBe(true);
    expect(row?.unreadCount).toBe(1);
  });
});

describeIntegration("chat: notifications", () => {
  it("coalesces a burst into one notification instead of one per message", async () => {
    const { asBob, bob, alice, conversationId } = await pair();

    for (let i = 0; i < 5; i += 1) {
      await asBob.chat.sendMessage({ conversationId, body: `burst ${i}` });
    }

    const rows = await h.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, alice.id),
          eq(schema.notifications.link, `/chat/${conversationId}`),
        ),
      );

    /* Previously this wrote one row per message and flooded the bell. */
    expect(rows).toHaveLength(1);
    expect(bob.id).toBeTruthy();
  });

  it("writes none at all when the recipient muted the thread", async () => {
    const { asAlice, asBob, alice, conversationId } = await pair();

    await asAlice.chat.setConversationPrefs({ conversationId, muted: true });
    await asBob.chat.sendMessage({ conversationId, body: "muted" });

    const rows = await h.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, alice.id),
          eq(schema.notifications.link, `/chat/${conversationId}`),
        ),
      );

    expect(rows).toHaveLength(0);
  });

  it("marks the thread's notification read when the thread is read", async () => {
    const { asAlice, asBob, alice, conversationId } = await pair();

    const sent = await asBob.chat.sendMessage({ conversationId, body: "ping" });
    await asAlice.chat.markRead({ conversationId, messageId: sent.id });

    const rows = await h.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, alice.id));

    expect(rows.every((r) => r.read)).toBe(true);
  });
});

describeIntegration("chat: message content", () => {
  it("accepts an attachment-only message and returns it typed", async () => {
    const { asAlice, conversationId } = await pair();

    /* `body` used to be `min(1)`, so this was rejected outright and uploads had
       to be smuggled into the text. */
    const sent = await asAlice.chat.sendMessage({
      conversationId,
      body: "",
      attachments: [
        {
          url: "https://utfs.io/f/plan.pdf",
          name: "plan.pdf",
          mime: "application/pdf",
          sizeBytes: 2_400_000,
        },
      ],
    });

    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]).toMatchObject({
      name: "plan.pdf",
      mime: "application/pdf",
      sizeBytes: 2_400_000,
    });

    const page = await asAlice.chat.listMessages({ conversationId, limit: 50 });
    expect(page.messages.at(-1)?.attachments[0]?.name).toBe("plan.pdf");
  });

  it("rejects a message with neither text nor attachment", async () => {
    const { asAlice, conversationId } = await pair();
    await expect(
      asAlice.chat.sendMessage({ conversationId, body: "   " }),
    ).rejects.toBeTruthy();
  });

  it("carries a reply quote, and refuses one from another conversation", async () => {
    const { asAlice, asBob, conversationId } = await pair();
    const target = await asBob.chat.sendMessage({ conversationId, body: "the question" });

    const reply = await asAlice.chat.sendMessage({
      conversationId,
      body: "the answer",
      replyToId: target.id,
    });
    expect(reply.replyTo?.id).toBe(target.id);
    expect(reply.replyTo?.body).toBe("the question");

    /* A reply pointing into someone else's thread would be a way to read a line
       out of it by guessing ids. */
    const other = await pair();
    const foreign = await other.asAlice.chat.sendMessage({
      conversationId: other.conversationId,
      body: "elsewhere",
    });
    await expect(
      asAlice.chat.sendMessage({ conversationId, body: "nope", replyToId: foreign.id }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("toggles a reaction and reports the aggregate per viewer", async () => {
    const { asAlice, asBob, conversationId } = await pair();
    const message = await asAlice.chat.sendMessage({ conversationId, body: "react to me" });

    const first = await asBob.chat.toggleReaction({ messageId: message.id, emoji: "🎉" });
    expect(first.reactions).toEqual([{ emoji: "🎉", count: 1, mine: true }]);

    /* `mine` is per viewer — Alice sees the same count, but not as hers. */
    const alicePage = await asAlice.chat.listMessages({ conversationId, limit: 50 });
    expect(alicePage.messages.at(-1)?.reactions).toEqual([
      { emoji: "🎉", count: 1, mine: false },
    ]);

    const second = await asBob.chat.toggleReaction({ messageId: message.id, emoji: "🎉" });
    expect(second.reactions).toEqual([]);
  });

  it("edits and soft-deletes, and only the author may", async () => {
    const { asAlice, asBob, conversationId } = await pair();
    const message = await asAlice.chat.sendMessage({ conversationId, body: "typo" });

    await expect(
      asBob.chat.editMessage({ messageId: message.id, body: "hijacked" }),
    ).rejects.toBeInstanceOf(TRPCError);
    await expect(asBob.chat.deleteMessage({ messageId: message.id })).rejects.toBeInstanceOf(
      TRPCError,
    );

    const edited = await asAlice.chat.editMessage({ messageId: message.id, body: "fixed" });
    expect(edited.body).toBe("fixed");
    expect(edited.editedAt).toBeInstanceOf(Date);

    await asAlice.chat.deleteMessage({ messageId: message.id });

    const page = await asAlice.chat.listMessages({ conversationId, limit: 50 });
    const tombstone = page.messages.find((m) => m.id === message.id);
    expect(tombstone?.deletedAt).toBeTruthy();
    /* The text must be gone from the payload, not merely hidden by the client. */
    expect(tombstone?.body).toBe("");

    const stored = await h.db
      .select({ body: schema.directMessages.body })
      .from(schema.directMessages)
      .where(eq(schema.directMessages.id, message.id));
    expect(stored[0]?.body).toBe("");
  });

  it("pins a message and surfaces it in the details pane", async () => {
    const { asAlice, conversationId } = await pair();
    const message = await asAlice.chat.sendMessage({ conversationId, body: "gate code 4471" });

    await asAlice.chat.togglePin({ messageId: message.id });

    const details = await asAlice.chat.getConversationDetails({ conversationId });
    expect(details.pinned.map((p) => p.id)).toContain(message.id);

    await asAlice.chat.togglePin({ messageId: message.id });
    const after = await asAlice.chat.getConversationDetails({ conversationId });
    expect(after.pinned).toHaveLength(0);
  });
});

describeIntegration("chat: search", () => {
  it("finds a substring, and never leaks another conversation", async () => {
    const { asAlice, conversationId } = await pair();
    await asAlice.chat.sendMessage({ conversationId, body: "the caterer confirmed 240" });

    /* Whole-lexeme full-text would miss this prefix; the search box has to. */
    const hits = await asAlice.chat.searchMessages({ query: "cater" });
    expect(hits.map((m) => m.body)).toContain("the caterer confirmed 240");

    const stranger = await makeUser(h.db);
    const strangerHits = await h.caller(stranger.id).chat.searchMessages({ query: "cater" });
    expect(strangerHits).toHaveLength(0);
  });

  it("treats wildcards as literal text", async () => {
    const { asAlice, conversationId } = await pair();
    await asAlice.chat.sendMessage({ conversationId, body: "a private line" });

    /* Unescaped, "%" matches every message the caller can see. */
    const hits = await asAlice.chat.searchMessages({ query: "%%" });
    expect(hits).toHaveLength(0);
  });
});

describeIntegration("chat: leaving and clearing are one-sided", () => {
  it("clearHistory hides messages for the caller only", async () => {
    const { asAlice, asBob, conversationId } = await pair();
    await asBob.chat.sendMessage({ conversationId, body: "keep me" });
    await asBob.chat.sendMessage({ conversationId, body: "and me" });

    await asAlice.chat.clearHistory({ conversationId });

    const aliceSees = await asAlice.chat.listMessages({ conversationId, limit: 50 });
    expect(aliceSees.messages).toHaveLength(0);

    /* The old deleteConversation cascade-deleted both copies. */
    const bobSees = await asBob.chat.listMessages({ conversationId, limit: 50 });
    expect(bobSees.messages).toHaveLength(2);
  });

  it("leaveConversation keeps the thread alive for the person still in it", async () => {
    const { asAlice, asBob, conversationId } = await pair();
    await asBob.chat.sendMessage({ conversationId, body: "still here" });

    const result = await asAlice.chat.leaveConversation({ conversationId });
    expect(result.purged).toBe(false);

    const bobSees = await asBob.chat.listMessages({ conversationId, limit: 50 });
    expect(bobSees.messages).toHaveLength(1);
  });

  it("purges the row only once nobody is left", async () => {
    const { asAlice, asBob, conversationId } = await pair();
    await asBob.chat.sendMessage({ conversationId, body: "goodbye" });

    await asAlice.chat.leaveConversation({ conversationId });
    const second = await asBob.chat.leaveConversation({ conversationId });

    expect(second.purged).toBe(true);
    const rows = await h.db
      .select()
      .from(schema.directConversations)
      .where(eq(schema.directConversations.id, conversationId));
    expect(rows).toHaveLength(0);
  });

  it("archive moves a conversation without hiding its messages", async () => {
    const { asAlice, asBob, conversationId } = await pair();
    await asBob.chat.sendMessage({ conversationId, body: "archived but readable" });

    await asAlice.chat.setConversationPrefs({ conversationId, archived: true });

    const row = (await asAlice.chat.listAllConversations()).find((c) => c.id === conversationId);
    expect(row?.archived).toBe(true);
    const page = await asAlice.chat.listMessages({ conversationId, limit: 50 });
    expect(page.messages).toHaveLength(1);
  });
});

describeIntegration("chat: rail data", () => {
  it("carries a last-message preview and an attachment name", async () => {
    const { asAlice, asBob, conversationId } = await pair();

    await asBob.chat.sendMessage({ conversationId, body: "latest line" });
    let row = (await asAlice.chat.listAllConversations()).find((c) => c.id === conversationId);
    expect(row?.lastMessage?.body).toBe("latest line");

    await asBob.chat.sendMessage({
      conversationId,
      body: "",
      attachments: [
        {
          url: "https://utfs.io/f/seating.png",
          name: "seating.png",
          mime: "image/png",
          sizeBytes: 51_200,
          width: 800,
          height: 600,
        },
      ],
    });

    row = (await asAlice.chat.listAllConversations()).find((c) => c.id === conversationId);
    expect(row?.lastMessage?.attachmentName).toBe("seating.png");
  });

  it("lists shared files in the details pane", async () => {
    const { asAlice, conversationId } = await pair();
    await asAlice.chat.sendMessage({
      conversationId,
      body: "here",
      attachments: [
        {
          url: "https://utfs.io/f/floor.pdf",
          name: "floor.pdf",
          mime: "application/pdf",
          sizeBytes: 1024,
        },
      ],
    });

    const details = await asAlice.chat.getConversationDetails({ conversationId });
    expect(details.files.map((f) => f.name)).toContain("floor.pdf");
  });
});
