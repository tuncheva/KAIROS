/**
 * History retention: the guard that decides whether anything is deleted at all.
 *
 * `cullUserMessages` is a delete path, which makes it the one function in this
 * phase where being wrong is unrecoverable. A brief sent at the wrong hour is an
 * annoyance; a paying user's history deleted because `null` was coerced to `0` is
 * data that does not come back.
 *
 * So the tests here are about the early return, and they assert it the strict
 * way: the database is a proxy that throws on any access, so "did not delete"
 * and "did not even look" are the same assertion. A stub returning empty arrays
 * would let a coercion bug pass by deleting nothing from an empty fixture.
 *
 * The queries beyond the guard need a real database and are not covered here.
 */

import { describe, expect, it, vi } from "vitest";

/**
 * `retention.ts` imports the database client at module load, which reads
 * validated server env. The guard under test runs before any query, so the
 * client is replaced with something that throws if touched — which is precisely
 * the property being asserted.
 */
vi.mock("~/server/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("the database must not be reached");
      },
    },
  ),
}));

const { cullUserMessages } = await import("~/server/llm/retention");

describe("cullUserMessages — plans with no limit", () => {
  it("deletes nothing when historyDays is null", async () => {
    // `null` means indefinitely. This is the case every user resolves to today,
    // and the one where a coercion bug would be silent and permanent.
    const result = await cullUserMessages({
      userId: "user_1",
      historyDays: null,
    });

    expect(result.messagesDeleted).toBe(0);
  });

  it("does not touch the database when historyDays is null", async () => {
    // The mocked client throws on any property access, so completing at all is
    // the assertion. Returning zero after running the queries would be a
    // different, worse implementation that this distinguishes.
    await expect(
      cullUserMessages({ userId: "user_1", historyDays: null }),
    ).resolves.toEqual({ messagesDeleted: 0, conversationsKept: 0 });
  });

  it("treats zero as unlimited rather than as delete-everything", async () => {
    // A misconfigured `0` must fail safe. Read as a window it would mean "keep
    // nothing", which is the most destructive possible interpretation of a value
    // that most plausibly arrived by mistake.
    const result = await cullUserMessages({
      userId: "user_1",
      historyDays: 0,
    });

    expect(result.messagesDeleted).toBe(0);
  });

  it("treats a negative window as unlimited too", async () => {
    const result = await cullUserMessages({
      userId: "user_1",
      historyDays: -30,
    });

    expect(result.messagesDeleted).toBe(0);
  });
});

describe("cullUserMessages — plans with a limit", () => {
  it("proceeds to query when given a real window", async () => {
    // The mirror of the tests above: with a genuine limit it must NOT short
    // circuit. Without this, an early return that always fired would pass every
    // other test in this file.
    await expect(
      cullUserMessages({ userId: "user_1", historyDays: 30 }),
    ).rejects.toThrow("the database must not be reached");
  });
});
