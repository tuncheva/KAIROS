import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The gate itself, plus the invariant that keeps it a gate.
 *
 * The bug these tests exist to prevent is not a broken branch — it is a *bypass*.
 * `users` carried notification preference columns for a long time, the settings
 * screen wrote all of them, and twelve producers across six routers inserted
 * straight into `notifications` without ever reading one. Turning a category off
 * changed a boolean and nothing else.
 *
 * So the wiring test at the bottom matters as much as the unit tests above it: a
 * thirteenth producer that inserts directly would reintroduce exactly the
 * original defect while every behavioural test still passed.
 */

// The dispatcher pulls in the database client and the socket publisher at import
// time. Neither is needed to exercise the decision logic, and a real `~/server/db`
// import wants DATABASE_URL.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/ws/emit", () => ({ emitNotification: vi.fn() }));

const { isDeliverable } = await import("~/server/notifications/dispatch");

type Prefs = Parameters<typeof isDeliverable>[0];

/** Everything on — the shape a brand-new account has. */
function allOn(): NonNullable<Prefs> {
  return {
    inAppNotifications: true,
    directMessageNotifications: true,
    projectUpdatesNotifications: true,
    taskAssignmentNotifications: true,
    taskDueRemindersNotifications: true,
    eventRemindersNotifications: true,
    eventUpdatesNotifications: true,
    eventRsvpNotifications: true,
    socialNotifications: true,
    inviteNotifications: true,
    workspaceNotifications: true,
  };
}

describe("notification preferences — category gating", () => {
  const cases = [
    ["directMessage", "directMessageNotifications"],
    ["projectUpdate", "projectUpdatesNotifications"],
    ["taskAssignment", "taskAssignmentNotifications"],
    ["taskDueReminder", "taskDueRemindersNotifications"],
    ["eventReminder", "eventRemindersNotifications"],
    ["eventUpdate", "eventUpdatesNotifications"],
    ["eventRsvp", "eventRsvpNotifications"],
    ["social", "socialNotifications"],
    ["invite", "inviteNotifications"],
    ["workspace", "workspaceNotifications"],
  ] as const;

  for (const [category, column] of cases) {
    it(`delivers "${category}" when ${column} is on`, () => {
      expect(isDeliverable(allOn(), category)).toBe(true);
    });

    it(`drops "${category}" when ${column} is off`, () => {
      expect(isDeliverable({ ...allOn(), [column]: false }, category)).toBe(false);
    });

    it(`drops "${category}" when only its own column is off`, () => {
      // Guards against a mapping typo pointing two categories at one column: if
      // `eventUpdate` were wired to `eventRemindersNotifications`, turning off
      // reminders alone would silently also kill update notices.
      const prefs = { ...allOn(), [column]: false };
      const others = cases.filter(([c]) => c !== category);
      for (const [otherCategory] of others) {
        expect(isDeliverable(prefs, otherCategory)).toBe(true);
      }
    });
  }
});

describe("notification preferences — precedence", () => {
  it("the master switch silences every category", () => {
    const prefs = { ...allOn(), inAppNotifications: false };
    for (const category of [
      "directMessage",
      "projectUpdate",
      "taskAssignment",
      "taskDueReminder",
      "eventReminder",
      "eventUpdate",
      "eventRsvp",
      "social",
      "invite",
      "workspace",
      "requested",
    ] as const) {
      expect(isDeliverable(prefs, category)).toBe(false);
    }
  });

  it("security notices survive the master switch being off", () => {
    expect(isDeliverable({ ...allOn(), inAppNotifications: false }, "security")).toBe(true);
  });

  it("security notices survive a missing user row", () => {
    // Reached when the row is gone but a notice is already in flight. Everything
    // else must drop; a security notice is worth the attempt.
    expect(isDeliverable(undefined, "security")).toBe(true);
    expect(isDeliverable(undefined, "directMessage")).toBe(false);
  });

  it('"requested" obeys the master switch but has no category toggle', () => {
    // AI briefs the user scheduled themselves. Every category column off, master
    // on: still delivered, because the opt-in was per-item.
    const everyCategoryOff: NonNullable<Prefs> = {
      ...allOn(),
      directMessageNotifications: false,
      projectUpdatesNotifications: false,
      taskAssignmentNotifications: false,
      taskDueRemindersNotifications: false,
      eventRemindersNotifications: false,
      eventUpdatesNotifications: false,
      eventRsvpNotifications: false,
      socialNotifications: false,
      inviteNotifications: false,
      workspaceNotifications: false,
    };
    expect(isDeliverable(everyCategoryOff, "requested")).toBe(true);
    expect(isDeliverable({ ...everyCategoryOff, inAppNotifications: false }, "requested")).toBe(
      false,
    );
  });
});

describe("notification producers — no bypasses", () => {
  const srcDir = path.resolve(__dirname, "../../src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  const files = walk(srcDir);

  it("only the dispatcher inserts into the notifications table", () => {
    const offenders = files
      .filter((f) => !f.endsWith(path.join("notifications", "dispatch.ts")))
      .filter((f) => /insert\(\s*notifications\s*\)/.test(fs.readFileSync(f, "utf-8")))
      .map((f) => path.relative(srcDir, f));

    expect(offenders).toEqual([]);
  });

  it("only the dispatcher emits notification socket frames", () => {
    const offenders = files
      .filter((f) => !f.endsWith(path.join("notifications", "dispatch.ts")))
      .filter((f) => !f.endsWith(path.join("ws", "emit.ts")))
      .filter((f) => /\bemitNotification\s*\(/.test(fs.readFileSync(f, "utf-8")))
      .map((f) => path.relative(srcDir, f));

    expect(offenders).toEqual([]);
  });

  it("every preference column the dispatcher maps exists on the users schema", () => {
    const dispatch = fs.readFileSync(
      path.join(srcDir, "server/notifications/dispatch.ts"),
      "utf-8",
    );
    const schema = fs.readFileSync(path.join(srcDir, "server/db/schemas/users.ts"), "utf-8");

    const mapped = [...dispatch.matchAll(/users\.(\w*Notifications)\b/g)].map((m) => m[1]);
    expect(mapped.length).toBeGreaterThan(10);

    for (const column of new Set(mapped)) {
      expect(schema).toContain(`${column}:`);
    }
  });

  it("the settings router accepts every column the dispatcher reads", () => {
    const dispatch = fs.readFileSync(
      path.join(srcDir, "server/notifications/dispatch.ts"),
      "utf-8",
    );
    const settings = fs.readFileSync(
      path.join(srcDir, "server/api/routers/settings.ts"),
      "utf-8",
    );

    // A gate the user cannot reach is as broken as no gate at all — this is the
    // half of the original bug that pointed the other way.
    for (const column of new Set(
      [...dispatch.matchAll(/users\.(\w*Notifications)\b/g)].map((m) => m[1]),
    )) {
      expect(settings).toContain(`${column}: z.boolean().optional()`);
      expect(settings).toContain(`${column}: true`);
    }
  });
});

describe("every category has a producer", () => {
  const srcDir = path.resolve(__dirname, "../../src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  const allSource = walk(srcDir)
    .map((f) => fs.readFileSync(f, "utf-8"))
    .join("\n");

  /**
   * A toggle nothing can trigger is the original bug wearing a different hat.
   *
   * `taskDueRemindersNotifications` shipped on the settings screen promising "get
   * notified when tasks are due" and no code path ever produced that category, so
   * the switch governed nothing — exactly the defect this whole change set exists
   * to remove, and one that a gating test alone would never catch.
   */
  const CATEGORIES = [
    "directMessage",
    "projectUpdate",
    "taskAssignment",
    "taskDueReminder",
    "eventReminder",
    "eventUpdate",
    "eventRsvp",
    "social",
    "invite",
    "workspace",
    "requested",
  ] as const;

  for (const category of CATEGORIES) {
    it(`something actually emits "${category}"`, () => {
      expect(allSource).toContain(`category: "${category}"`);
    });
  }
});

describe("email preferences are enforced", () => {
  const runner = fs.readFileSync(
    path.resolve(__dirname, "../../src/server/llm/scheduled/runner.ts"),
    "utf-8",
  );

  it("checks the account-level switch before sending a brief by email", () => {
    // `emailNotifications` was read by nothing: a user who switched email off in
    // Settings kept receiving briefs in their inbox.
    expect(runner).toContain("users.emailNotifications");
  });

  it("treats email being switched off as a choice, not a delivery failure", () => {
    // It must not count toward the three-strikes counter that disables the
    // channel, and the brief must still arrive in-app.
    expect(runner).toContain("emailSuppressed");
    expect(runner).toMatch(/wantsApp \|\| emailError \|\| emailSuppressed/);
  });
});

describe("task due reminders — the other missing sweep", () => {
  const reminders = fs.readFileSync(
    path.resolve(__dirname, "../../src/server/notifications/taskReminders.ts"),
    "utf-8",
  );
  const route = fs.readFileSync(
    path.resolve(__dirname, "../../src/app/api/internal/ai/run-schedules/route.ts"),
    "utf-8",
  );

  it("runs on the server scheduler tick", () => {
    expect(route).toContain("sendDueTaskReminders");
  });

  it("does not remind about completed work", () => {
    expect(reminders).toContain("<> 'completed'");
  });

  it("re-arms a task whose due date was pushed out", () => {
    // Otherwise rescheduling a task it already reminded about means it never
    // reminds again — the reminder silently belongs to the old date.
    expect(route).toContain("rearmMovedTaskReminders");
    expect(reminders).toContain("dueReminderSentAt: null");
  });

  it("stamps the task so the reminder is sent once", () => {
    expect(reminders).toContain("dueReminderSentAt: now");
  });
});

describe("event reminders — the sweep that was missing", () => {
  const reminders = fs.readFileSync(
    path.resolve(__dirname, "../../src/server/notifications/eventReminders.ts"),
    "utf-8",
  );

  it("is driven by the server scheduler tick, not a browser interval", () => {
    const route = fs.readFileSync(
      path.resolve(__dirname, "../../src/app/api/internal/ai/run-schedules/route.ts"),
      "utf-8",
    );
    expect(route).toContain("sendDueEventReminders");
  });

  it("marks a reminder handled even when the recipient has them switched off", () => {
    // Otherwise a user who re-enables reminders receives a backlog of notices for
    // events that have already happened.
    expect(reminders).toContain("reminderSent: true");
  });

  it("ignores reminders for people who declined", () => {
    expect(reminders).toContain("not_going");
  });

  it("refuses to fire reminders for events long past", () => {
    expect(reminders).toContain("STALE_AFTER_MS");
  });
});
