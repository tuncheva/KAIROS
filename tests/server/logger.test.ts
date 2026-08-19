import { describe, it, expect } from "vitest";

import { maskEmail, redact } from "~/server/logger";

/**
 * Behavioural tests for log redaction.
 *
 * Audit finding #32: ~60 bare `console.*` calls in `src/server` and ~24 in
 * `ws-server` wrote user ids, organization ids, email addresses and raw error
 * objects to stdout, with no level control and no redaction. These tests pin the
 * redaction rules, because the whole point is that they hold for values nobody
 * inspected on the way past.
 */

describe("maskEmail", () => {
  it("keeps the domain and the first and last local character", () => {
    expect(maskEmail("alice@example.com")).toBe("a***e@example.com");
  });

  it("drops the whole local part when it is too short to blur", () => {
    expect(maskEmail("al@example.com")).toBe("***@example.com");
    expect(maskEmail("a@example.com")).toBe("***@example.com");
  });

  it("redacts a value that is not an address at all", () => {
    expect(maskEmail("not-an-email")).toBe("[redacted]");
    expect(maskEmail("@leading")).toBe("[redacted]");
  });
});

describe("redact", () => {
  it("replaces values under sensitive keys", () => {
    const out = redact({
      password: "hunter2",
      passwordHash: "$argon2id$...",
      resetPinHash: "abc",
      authSecret: "s3cret",
      accessToken: "t0ken",
      cookie: "authjs.session-token=…",
      passwordSalt: "NaCl",
    }) as Record<string, unknown>;

    for (const [key, value] of Object.entries(out)) {
      expect(value, key).toBe("[redacted]");
    }
  });

  it("redacts note and message bodies", () => {
    // `content` is on the sensitive list: note bodies are the most private thing
    // in the product and they were being logged on insert failures.
    const out = redact({ content: "my private note" }) as Record<string, unknown>;
    expect(out.content).toBe("[redacted]");
  });

  it("masks an email under any key whose name mentions email", () => {
    const out = redact({ email: "bob@corp.io", userEmail: "eve@corp.io" }) as Record<
      string,
      unknown
    >;
    expect(out.email).toBe("b***b@corp.io");
    expect(out.userEmail).toBe("e***e@corp.io");
  });

  it("masks addresses that appear inside free text", () => {
    // The old call sites interpolated addresses into the message string, so
    // key-based redaction alone would have missed them.
    expect(redact("failed to send to alice@example.com, retrying")).toBe(
      "failed to send to a***e@example.com, retrying",
    );
  });

  it("truncates long user ids but leaves short ones alone", () => {
    const out = redact({
      userId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      collaboratorId: "short",
    }) as Record<string, unknown>;

    expect(out.userId).toBe("7c9e6679…");
    expect(out.collaboratorId).toBe("short");
  });

  it("keeps non-identifying values intact, so logs stay useful", () => {
    const out = redact({
      organizationId: 42,
      projectId: 7,
      count: 3,
      ok: true,
      via: "org-member",
    });

    expect(out).toEqual({
      organizationId: 42,
      projectId: 7,
      count: 3,
      ok: true,
      via: "org-member",
    });
  });

  it("reduces an Error to name and message, without the stack", () => {
    // Stacks carry file paths, and database errors carry fragments of the failing
    // statement.
    const out = redact(new TypeError("boom at alice@example.com")) as Record<
      string,
      unknown
    >;

    expect(out).toEqual({ name: "TypeError", message: "boom at a***e@example.com" });
    expect(out.stack).toBeUndefined();
  });

  it("recurses into nested objects and arrays", () => {
    const out = redact({
      outer: { inner: { password: "x", userId: "7c9e6679-7425-40de-944b-e07fc1f90ae7" } },
      list: [{ email: "a@b.co" }],
    }) as { outer: { inner: Record<string, unknown> }; list: Record<string, unknown>[] };

    expect(out.outer.inner.password).toBe("[redacted]");
    expect(out.outer.inner.userId).toBe("7c9e6679…");
    expect(out.list[0]?.email).toBe("***@b.co");
  });

  it("stops at a depth limit rather than recursing forever", () => {
    // A cyclic or very deep object must not take the process down just because
    // something logged it.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => redact(cyclic)).not.toThrow();
    expect(JSON.stringify(redact(cyclic))).toContain("depth limit");
  });

  it("caps very long arrays", () => {
    const out = redact(Array.from({ length: 200 }, (_, i) => i)) as unknown[];
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it("passes null and undefined through unchanged", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it("describes values that are not objects, strings or numbers", () => {
    // The final branch used to be `String(value)`, which turns anything unexpected
    // into "[object Object]" and loses the information entirely.
    expect(redact(Symbol("tag"))).toBe("Symbol(tag)");
    expect(redact(123n)).toBe("123");
    expect(redact(() => 1)).toBe("[function]");
  });

  it("treats a prototype-less object as a plain object", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.password = "x";
    bare.count = 2;

    expect(redact(bare)).toEqual({ password: "[redacted]", count: 2 });
  });
});
