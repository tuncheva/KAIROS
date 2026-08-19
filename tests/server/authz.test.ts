import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

import { assertProjectAccess, getProjectAccess } from "~/server/api/authz";
import type { TRPCContext } from "~/server/api/trpc";

/**
 * Behavioural tests for the shared project authorization helper.
 *
 * These exercise the real decision logic rather than asserting on source text.
 * The DB is stubbed at the query-builder boundary: `getProjectAccess` issues up
 * to three chained `select().from().where().limit(1)` queries, in this order:
 *
 *   1. the project row
 *   2. the caller's organization membership (only when the project is org-scoped)
 *   3. the caller's project-collaborator row
 *
 * so a queue of canned result arrays is enough to drive every branch.
 */

type Row = Record<string, unknown>;

function fakeDb(results: Row[][]) {
  let call = 0;
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(results[call++] ?? []),
  };
  return { select: () => chain } as unknown as TRPCContext["db"];
}

function makeCtx(userId: string | null, results: Row[][]): TRPCContext {
  return {
    db: fakeDb(results),
    session: userId ? { user: { id: userId } } : null,
    headers: new Headers(),
  } as unknown as TRPCContext;
}

const PERSONAL_PROJECT = { id: 1, createdById: "owner-1", organizationId: null };
const ORG_PROJECT = { id: 2, createdById: "owner-1", organizationId: 42 };

async function expectTRPCError(
  promise: Promise<unknown>,
  code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND",
) {
  await expect(promise).rejects.toBeInstanceOf(TRPCError);
  await promise.catch((err: unknown) => {
    expect((err as TRPCError).code).toBe(code);
  });
}

describe("getProjectAccess", () => {
  it("rejects an unauthenticated caller before querying", async () => {
    const ctx = makeCtx(null, []);
    await expectTRPCError(getProjectAccess(ctx, 1), "UNAUTHORIZED");
  });

  it("throws NOT_FOUND when the project does not exist", async () => {
    const ctx = makeCtx("user-1", [[]]);
    await expectTRPCError(getProjectAccess(ctx, 999), "NOT_FOUND");
  });

  it("skips the org-membership query for a personal project", async () => {
    // Only two results queued: project, then collaborator. If the helper issued
    // a membership query for a null organizationId, the collaborator lookup
    // would consume the wrong slot and this assertion would fail.
    const ctx = makeCtx("user-2", [[PERSONAL_PROJECT], [{ permission: "read" }]]);
    const access = await getProjectAccess(ctx, 1);

    expect(access.isOrgMember).toBe(false);
    expect(access.collaboratorPermission).toBe("read");
  });

  it("reports ownership, membership and collaboration independently", async () => {
    const ctx = makeCtx("owner-1", [
      [ORG_PROJECT],
      [{ userId: "owner-1" }],
      [{ permission: "write" }],
    ]);
    const access = await getProjectAccess(ctx, 2);

    expect(access.isOwner).toBe(true);
    expect(access.isOrgMember).toBe(true);
    expect(access.collaboratorPermission).toBe("write");
    expect(access.project.id).toBe(2);
  });

  it("reports no collaboration as null rather than undefined", async () => {
    const ctx = makeCtx("stranger", [[PERSONAL_PROJECT], []]);
    const access = await getProjectAccess(ctx, 1);

    expect(access.collaboratorPermission).toBeNull();
  });
});

describe("assertProjectAccess — the regression this guards", () => {
  /**
   * The agent layer (`readTools.listTasks`, `taskPlannerDraft`,
   * `taskPlannerApply`) previously resolved a caller-supplied projectId with no
   * check at all, so an unrelated user could read and write another tenant's
   * tasks. These are the cases that must stay denied.
   */
  it("denies a stranger read access to a personal project", async () => {
    const ctx = makeCtx("stranger", [[PERSONAL_PROJECT], []]);
    await expectTRPCError(assertProjectAccess(ctx, 1, "read"), "FORBIDDEN");
  });

  it("denies a stranger write access to a personal project", async () => {
    const ctx = makeCtx("stranger", [[PERSONAL_PROJECT], []]);
    await expectTRPCError(assertProjectAccess(ctx, 1, "write"), "FORBIDDEN");
  });

  it("denies a non-member read access to an org project", async () => {
    const ctx = makeCtx("stranger", [[ORG_PROJECT], [], []]);
    await expectTRPCError(assertProjectAccess(ctx, 2, "read"), "FORBIDDEN");
  });

  it("denies a non-member write access to an org project", async () => {
    const ctx = makeCtx("stranger", [[ORG_PROJECT], [], []]);
    await expectTRPCError(assertProjectAccess(ctx, 2, "write"), "FORBIDDEN");
  });
});

describe("assertProjectAccess — permitted callers", () => {
  it("allows the owner to read and write", async () => {
    const readCtx = makeCtx("owner-1", [[PERSONAL_PROJECT], []]);
    await expect(assertProjectAccess(readCtx, 1, "read")).resolves.toMatchObject({ id: 1 });

    const writeCtx = makeCtx("owner-1", [[PERSONAL_PROJECT], []]);
    await expect(assertProjectAccess(writeCtx, 1, "write")).resolves.toMatchObject({ id: 1 });
  });

  it("allows an org member to read and write", async () => {
    const readCtx = makeCtx("member-1", [[ORG_PROJECT], [{ userId: "member-1" }], []]);
    await expect(assertProjectAccess(readCtx, 2, "read")).resolves.toMatchObject({ id: 2 });

    const writeCtx = makeCtx("member-1", [[ORG_PROJECT], [{ userId: "member-1" }], []]);
    await expect(assertProjectAccess(writeCtx, 2, "write")).resolves.toMatchObject({ id: 2 });
  });

  it("allows a read-only collaborator to read", async () => {
    const ctx = makeCtx("collab-1", [[PERSONAL_PROJECT], [{ permission: "read" }]]);
    await expect(assertProjectAccess(ctx, 1, "read")).resolves.toMatchObject({ id: 1 });
  });

  it("denies a read-only collaborator write access", async () => {
    // The distinction that matters: read-share must not confer write.
    const ctx = makeCtx("collab-1", [[PERSONAL_PROJECT], [{ permission: "read" }]]);
    await expectTRPCError(assertProjectAccess(ctx, 1, "write"), "FORBIDDEN");
  });

  it("allows a write collaborator to write", async () => {
    const ctx = makeCtx("collab-2", [[PERSONAL_PROJECT], [{ permission: "write" }]]);
    await expect(assertProjectAccess(ctx, 1, "write")).resolves.toMatchObject({ id: 1 });
  });

  it("defaults to the read action when none is given", async () => {
    const ctx = makeCtx("collab-1", [[PERSONAL_PROJECT], [{ permission: "read" }]]);
    await expect(assertProjectAccess(ctx, 1)).resolves.toMatchObject({ id: 1 });
  });
});
