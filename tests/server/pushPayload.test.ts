import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The lock-screen half of a notification.
 *
 * Two things here are easy to break without noticing: the payload shape Safari
 * needs to display a push on its own (Declarative Web Push), and the cleanup of
 * subscriptions the push service has declared dead — without which every
 * notification keeps paying for a request that can never succeed.
 */

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_APP_URL: "https://kairos.test" as string | undefined,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub" as string | undefined,
  VAPID_PRIVATE_KEY: "priv" as string | undefined,
  VAPID_SUBJECT: undefined as string | undefined,
}));
vi.mock("~/env", () => ({ env }));
vi.mock("~/server/db", () => ({ db: {} }));

const webpush = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("web-push", () => ({ default: webpush }));

const { absoluteUrl, buildPushPayload, resetPushConfigForTests, sendPushToUsers } = await import(
  "~/server/notifications/push"
);

type Sub = { id: number; userId: string; endpoint: string; p256dh: string; auth: string };

/** Just enough of drizzle's builder for the four queries the sender makes. */
function fakeDb(subs: Sub[], unread: { userId: string; n: number }[] = []) {
  const deleted: unknown[] = [];
  const updated: unknown[] = [];
  let selects = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          selects++;
          // First select is the subscriptions; the second is the grouped count.
          if (selects === 1) return Promise.resolve(subs);
          return { groupBy: () => Promise.resolve(unread) };
        },
      }),
    }),
    delete: () => ({ where: (w: unknown) => (deleted.push(w), Promise.resolve()) }),
    update: () => ({ set: () => ({ where: (w: unknown) => (updated.push(w), Promise.resolve()) }) }),
  };
  return { db: db as never, deleted, updated };
}

const sub = (id: number, userId = "u1"): Sub => ({
  id,
  userId,
  endpoint: `https://web.push.apple.com/${id}`,
  p256dh: "k",
  auth: "a",
});

beforeEach(() => {
  vi.clearAllMocks();
  env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
  env.VAPID_PRIVATE_KEY = "priv";
  env.VAPID_SUBJECT = undefined;
  resetPushConfigForTests();
});

describe("buildPushPayload", () => {
  it("produces a Declarative Web Push message", () => {
    const p = buildPushPayload(
      { notificationId: 7, title: "New message", message: "hi", link: "/chat/3", unreadCount: 4 },
      "https://kairos.test",
    );
    expect(p.web_push).toBe(8030);
    expect(p.notification).toEqual({
      title: "New message",
      body: "hi",
      navigate: "https://kairos.test/chat/3",
      app_badge: "4",
      data: { notificationId: 7, url: "https://kairos.test/chat/3" },
    });
  });

  it("keeps query strings and hashes in the deep link", () => {
    expect(absoluteUrl("/projects?projectId=5#t", "https://k.test")).toBe("https://k.test/projects?projectId=5#t");
  });

  it("never links off-site, whatever the stored link says", () => {
    for (const link of ["https://evil.test/x", "//evil.test/x", "javascript:alert(1)", null, ""]) {
      expect(absoluteUrl(link, "https://k.test")).toBe("https://k.test/");
    }
  });

  it("stays well under Apple's 4 KB limit for long Cyrillic text", () => {
    const p = buildPushPayload(
      { title: "Ж".repeat(1000), message: "Щ".repeat(5000), link: "/chat/1" },
      "https://kairos.test",
    );
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(2500);
    expect(p.notification.body.endsWith("…")).toBe(true);
  });

  it("omits the badge when no count is given", () => {
    const p = buildPushPayload({ title: "t", message: "m" }, "https://kairos.test");
    expect(p.notification).not.toHaveProperty("app_badge");
  });
});

describe("sendPushToUsers", () => {
  it("does nothing when VAPID keys are not configured", async () => {
    env.VAPID_PRIVATE_KEY = undefined;
    const { db } = fakeDb([sub(1)]);
    const r = await sendPushToUsers(db, [{ userId: "u1", title: "t", message: "m" }]);
    expect(r).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("falls back to the https app URL as the VAPID subject", async () => {
    const { db } = fakeDb([]);
    await sendPushToUsers(db, [{ userId: "u1", title: "t", message: "m" }]);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith("https://kairos.test", "pub", "priv");
  });

  it("sends to every device of the recipient only, with TTL and urgency", async () => {
    webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
    const { db, updated } = fakeDb([sub(1), sub(2), sub(3, "u2")], [{ userId: "u1", n: 2 }]);

    const r = await sendPushToUsers(db, [{ userId: "u1", title: "t", message: "m", link: "/x" }]);

    expect(r.sent).toBe(2);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    const [target, payload, options] = webpush.sendNotification.mock.calls[0] as [unknown, string, unknown];
    expect(target).toEqual({ endpoint: "https://web.push.apple.com/1", keys: { p256dh: "k", auth: "a" } });
    const parsed = JSON.parse(payload) as { notification: { app_badge?: string } };
    expect(parsed.notification.app_badge).toBe("2");
    expect(options).toMatchObject({ TTL: 86400, urgency: "high" });
    expect(updated).toHaveLength(1);
  });

  it("deletes subscriptions the push service reports gone, and keeps the rest", async () => {
    webpush.sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("jwt"), { statusCode: 403 }));
    const { db, deleted } = fakeDb([sub(1), sub(2)]);

    const r = await sendPushToUsers(db, [{ userId: "u1", title: "t", message: "m" }]);

    expect(r).toEqual({ sent: 0, failed: 2, removed: 1 });
    expect(deleted).toHaveLength(1);
  });

  it("never throws, even when the database does", async () => {
    const db = {
      select: () => {
        throw new Error("db down");
      },
    } as never;
    await expect(sendPushToUsers(db, [{ userId: "u1", title: "t", message: "m" }])).resolves.toEqual({
      sent: 0,
      failed: 0,
      removed: 0,
    });
  });
});
