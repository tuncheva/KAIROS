/**
 * F-2 — every read tool fails closed.
 *
 * Audit finding P0 #1 was "AI agent reads and writes any project by ID (no
 * membership check)": the tools reach `ctx.db` directly rather than going through
 * a tRPC router, so none of the router's authorization applied to them, and the
 * id the model asks for is model output — which is to say, ultimately user input.
 *
 * That was fixed by putting `assertProjectAccess` inside each tool. This suite
 * exists so it stays fixed, including for tools written later: the last test
 * enumerates the registry and fails when a tool takes a resource id without a
 * matching authorization test, so adding tool nineteen without a check is a red
 * build rather than a quiet regression.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("~/env", () => ({
  env: {
    LLM_BASE_URL: "https://llm.test/api/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "primary-model",
    AUTH_SECRET: "x".repeat(32),
  },
}));

const assertProjectAccess = vi.fn();
vi.mock("~/server/api/authz", () => ({
  assertProjectAccess,
  assertProjectPermission: vi.fn(),
}));

/**
 * A drizzle query builder that resolves to whatever rows the test queued.
 *
 * Every builder method returns `this`, and the object is thenable, so any chain
 * shape the tools use — `.select().from().where().limit()`,
 * `.select().from().innerJoin().where().orderBy().limit()` — resolves to the
 * same queued result without the stub needing to know the shape in advance.
 */
function queryStub(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "from",
    "where",
    "innerJoin",
    "leftJoin",
    "orderBy",
    "limit",
    "groupBy",
    "offset",
  ]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
  return builder;
}

/** A context whose every query returns `rows`. */
function ctxWith(rows: unknown[], userId = "user-1") {
  return {
    db: {
      select: () => queryStub(rows),
      delete: () => queryStub(rows),
      query: {},
    },
    session: { user: { id: userId, email: "a@b.c", name: "A" } },
    headers: new Headers(),
  } as never;
}

const { A1_READ_TOOLS } = await import("~/server/llm/tools/a1/readTools");

beforeEach(() => {
  vi.clearAllMocks();
  assertProjectAccess.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Project-scoped tools
// ---------------------------------------------------------------------------

const PROJECT_SCOPED = [
  ["listTasks", { projectId: 99, limit: 5 }],
  ["getProjectDetail", { projectId: 99 }],
  ["getProjectHealth", { projectId: 99 }],
  ["listProjectCollaborators", { projectId: 99 }],
] as const;

describe("project-scoped tools authorize the project id", () => {
  it.each(PROJECT_SCOPED)("%s calls assertProjectAccess", async (name, input) => {
    const tool = A1_READ_TOOLS[name];
    // A project row must exist for the tools that look one up after the check.
    await tool.execute(ctxWith([{ id: 99, title: "P", status: "active" }]), input as never).catch(() => {
      // Some tools throw NOT_FOUND against the thin stub; the authorization call
      // is what this test is about, and it happens first.
    });

    expect(assertProjectAccess).toHaveBeenCalledWith(
      expect.anything(),
      99,
      "read",
    );
  });

  it.each(PROJECT_SCOPED)(
    "%s propagates the refusal instead of returning rows",
    async (name, input) => {
      assertProjectAccess.mockRejectedValue(
        new TRPCError({ code: "FORBIDDEN", message: "no" }),
      );
      const tool = A1_READ_TOOLS[name];

      await expect(
        tool.execute(ctxWith([{ id: 99 }]), input as never),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );
});

// ---------------------------------------------------------------------------
// Task-scoped tools — the project comes from the row, not the caller
// ---------------------------------------------------------------------------

const TASK_SCOPED = ["listTaskComments", "getTaskActivity", "getTaskDetail"] as const;

describe("task-scoped tools authorize the task's project", () => {
  it.each(TASK_SCOPED)("%s resolves the project then checks it", async (name) => {
    const tool = A1_READ_TOOLS[name];
    await tool.execute(ctxWith([{ projectId: 7 }]), { taskId: 5 } as never);

    // 7, not 5: the id checked must be the task's *project*, looked up from the
    // row. Checking the task id would authorize nothing.
    expect(assertProjectAccess).toHaveBeenCalledWith(
      expect.anything(),
      7,
      "read",
    );
  });

  it.each(TASK_SCOPED)("%s refuses when the task does not exist", async (name) => {
    const tool = A1_READ_TOOLS[name];
    await expect(
      tool.execute(ctxWith([]), { taskId: 5 } as never),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each(TASK_SCOPED)(
    "%s propagates a refusal on the parent project",
    async (name) => {
      assertProjectAccess.mockRejectedValue(
        new TRPCError({ code: "FORBIDDEN", message: "no" }),
      );
      const tool = A1_READ_TOOLS[name];
      await expect(
        tool.execute(ctxWith([{ projectId: 7 }]), { taskId: 5 } as never),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );
});

// ---------------------------------------------------------------------------
// Tools with their own membership / ownership rules
// ---------------------------------------------------------------------------

describe("getWorkloadByAssignee authorizes a named project", () => {
  it("checks the project when one is given", async () => {
    await A1_READ_TOOLS.getWorkloadByAssignee.execute(ctxWith([]), {
      projectId: 12,
    } as never);

    expect(assertProjectAccess).toHaveBeenCalledWith(
      expect.anything(),
      12,
      "read",
    );
  });

  it("propagates a refusal for that project", async () => {
    assertProjectAccess.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "no" }),
    );
    await expect(
      A1_READ_TOOLS.getWorkloadByAssignee.execute(ctxWith([]), {
        projectId: 12,
      } as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("falls back to the caller's visible projects when none is given", async () => {
    // No project id means no single project to authorize; the scope helper
    // constrains the query instead, so `assertProjectAccess` is not the guard here.
    await A1_READ_TOOLS.getWorkloadByAssignee.execute(ctxWith([]), {} as never);
    expect(assertProjectAccess).not.toHaveBeenCalled();
  });
});

describe("listOrgMembers requires membership of that organization", () => {
  it("refuses a non-member", async () => {
    // First query is the caller's own membership row; empty means not a member.
    await expect(
      A1_READ_TOOLS.listOrgMembers.execute(ctxWith([]), {
        organizationId: 3,
      } as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a member", async () => {
    const rows = [{ id: 1, userId: "user-1", name: "A", role: "admin", joinedAt: new Date() }];
    await expect(
      A1_READ_TOOLS.listOrgMembers.execute(ctxWith(rows), {
        organizationId: 3,
      } as never),
    ).resolves.toBeInstanceOf(Array);
  });
});

describe("listEventRsvps is organizer-only", () => {
  it("refuses someone who is not the organizer", async () => {
    await expect(
      A1_READ_TOOLS.listEventRsvps.execute(
        ctxWith([{ createdById: "someone-else" }]),
        { eventId: 4 } as never,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses when the event does not exist", async () => {
    await expect(
      A1_READ_TOOLS.listEventRsvps.execute(ctxWith([]), { eventId: 4 } as never),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("allows the organizer", async () => {
    await expect(
      A1_READ_TOOLS.listEventRsvps.execute(
        ctxWith([{ createdById: "user-1", userId: "u", name: "N", status: "going" }]),
        { eventId: 4 } as never,
      ),
    ).resolves.toMatchObject({ going: expect.any(Number) as unknown as number });
  });
});

describe("every tool refuses an unauthenticated caller", () => {
  const anonymous = {
    db: { select: () => queryStub([]), delete: () => queryStub([]), query: {} },
    session: null,
    headers: new Headers(),
  } as never;

  // The ones that resolve identity from the session rather than from an id.
  const IDENTITY_SCOPED = [
    "getSessionContext",
    "listProjects",
    "listOrganizations",
    "listNotifications",
    "listMyWork",
    "listNotesMetadata",
    "searchWorkspace",
  ] as const;

  it.each(IDENTITY_SCOPED)("%s throws UNAUTHORIZED", async (name) => {
    const tool = A1_READ_TOOLS[name];
    const input = name === "searchWorkspace" ? { query: "anything" } : {};
    await expect(tool.execute(anonymous, input as never)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

// ---------------------------------------------------------------------------
// The guard that keeps this suite honest as tools are added
// ---------------------------------------------------------------------------

describe("registry coverage", () => {
  /**
   * Tools taking a resource id, and the suite that covers each.
   *
   * A tool that accepts an id the caller chose is a tool that can be pointed at
   * somebody else's data. Adding one without a row here fails the next test.
   */
  const COVERED_ID_TOOLS = new Set<string>([
    ...PROJECT_SCOPED.map(([name]) => name),
    ...TASK_SCOPED,
    "getWorkloadByAssignee",
    "listOrgMembers",
    "listEventRsvps",
  ]);

  it("has an authorization test for every id-taking tool", () => {
    const idTaking = Object.entries(A1_READ_TOOLS)
      .filter(([, tool]) => {
        // Inspect the Zod input shape rather than the name, so a tool that takes
        // an id under a new name is still caught.
        const shape = (
          tool.inputSchema as unknown as {
            _def?: { shape?: () => Record<string, unknown> };
          }
        )._def?.shape?.();
        if (!shape) return false;
        return Object.keys(shape).some((key) => key.endsWith("Id"));
      })
      .map(([name]) => name);

    const uncovered = idTaking.filter((name) => !COVERED_ID_TOOLS.has(name));

    expect(
      uncovered,
      `These tools accept a caller-supplied id but have no authorization test: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the covered list free of tools that no longer exist", () => {
    for (const name of COVERED_ID_TOOLS) {
      expect(A1_READ_TOOLS, `${name} is covered but not registered`).toHaveProperty(
        name,
      );
    }
  });
});
