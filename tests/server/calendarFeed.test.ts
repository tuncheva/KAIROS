import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");

/**
 * The calendar feed's URL *is* its credential.
 *
 * Google, Apple and Outlook fetch it from their own servers, so there is no
 * cookie to gate on. That makes a handful of properties load-bearing rather
 * than stylistic, and each of them is the kind of thing a later edit removes
 * without noticing.
 */
describe("the subscribable calendar feed", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/calendar/feed/[token]/route.ts"),
    "utf-8",
  );

  it("never logs the token", () => {
    // The URL is the secret, so a token in a log file is a leaked calendar.
    const logCalls = [...route.matchAll(/log\.\w+\([^;]*?\)/gs)].map((m) => m[0]);
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      expect(call).not.toMatch(/\btoken\b/);
      expect(call).not.toMatch(/\bvalue\b/);
    }
  });

  it("answers an unknown token with 404, not 401", () => {
    // A 401 confirms the token was well-formed but wrong, which tells someone
    // enumerating that they are close.
    const statuses = [...route.matchAll(/status:\s*(\d{3})/g)].map((m) => m[1]);
    expect(statuses).toContain("404");
    expect(statuses).not.toContain("401");
    expect(statuses).not.toContain("403");
  });

  it("refuses to be cached by anything shared", () => {
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });

  it("scopes through the same collector the export route uses", () => {
    // Not a second query of its own: `collectExport` shares `loadVisibleScope`
    // with the agent layer, which is what makes the scoping trustworthy.
    expect(route).toContain("collectExport(ctx, owner.id)");
  });

  it("is reachable without a session", () => {
    const proxy = fs.readFileSync(path.join(root, "src/proxy.ts"), "utf-8");
    expect(proxy).toContain('pathname.startsWith("/api/calendar/feed/")');
  });
});

describe("the token itself", () => {
  const settings = fs.readFileSync(
    path.join(root, "src/server/api/routers/settings.ts"),
    "utf-8",
  );

  it("comes from randomBytes, not from anything about the user", () => {
    expect(settings).toContain("randomBytes(32).toString(\"hex\")");
  });

  it("can be revoked without deleting the account", () => {
    expect(settings).toContain("revokeCalendarFeedToken");
    expect(settings).toContain("calendarFeedToken: null");
  });
});
