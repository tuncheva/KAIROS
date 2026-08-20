import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

import {
  ORG_ROLES,
  PERMISSION_FLAG_KEYS,
  flagsForRole,
  getPermissions,
  isOrgRole,
  isViewOnlyRole,
  permissionsFromFlags,
  personalModePermissions,
  type MemberPermissionFlags,
} from "~/lib/permissions";
import {
  assertOrgPermission,
  assertProjectPermission,
  membershipHasFlag,
  requireMembership,
} from "~/server/api/authz";
import type { TRPCContext } from "~/server/api/trpc";

/**
 * Behavioural tests for the unified permission model.
 *
 * These are the regression tests for audit finding #4 — the `mentor` view-only
 * role was enforced only in the browser, and the `canDeleteTasks` column was
 * written at membership creation and then never read, so any org member could
 * create, edit and delete every task and project by calling tRPC directly.
 *
 * The DB is stubbed at the query-builder boundary, same as `authz.test.ts`:
 * `getProjectAccess` issues up to three chained
 * `select().from().where().limit(1)` queries — project row, membership row,
 * collaborator row — so a queue of canned results drives every branch.
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

/** A membership row as the authz queries select it. */
function membershipRow(
  role: string,
  overrides: Partial<MemberPermissionFlags> = {},
): Row {
  return { role, ...flagsForRole(role), ...overrides };
}

async function expectTRPCError(
  promise: Promise<unknown>,
  code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND",
) {
  await expect(promise).rejects.toBeInstanceOf(TRPCError);
  await promise.catch((err: unknown) => {
    expect((err as TRPCError).code).toBe(code);
  });
}

// ---------------------------------------------------------------------------
// Role templates
// ---------------------------------------------------------------------------

describe("flagsForRole", () => {
  it("gives an admin every capability", () => {
    const flags = flagsForRole("admin");
    for (const key of PERMISSION_FLAG_KEYS) {
      expect(flags[key], key).toBe(true);
    }
  });

  it("treats worker and member as the same role under two names", () => {
    // The access-code join flow writes `worker`; invites and role management
    // write `member`. They must not diverge in what they can do.
    expect(flagsForRole("worker")).toEqual(flagsForRole("member"));
  });

  it("lets a contributor plan work but not administer the org", () => {
    const flags = flagsForRole("member");

    expect(flags.canAssignTasks).toBe(true);
    expect(flags.canCreateProjects).toBe(true);
    expect(flags.canEditProjects).toBe(true);

    expect(flags.canAddMembers).toBe(false);
    expect(flags.canKickMembers).toBe(false);
    expect(flags.canManageRoles).toBe(false);
  });

  it("withholds canDeleteTasks from contributors so it stays a granted capability", () => {
    expect(flagsForRole("member").canDeleteTasks).toBe(false);
    expect(flagsForRole("worker").canDeleteTasks).toBe(false);
    expect(flagsForRole("admin").canDeleteTasks).toBe(true);
  });

  it("gives mentor and guest nothing at all", () => {
    for (const role of ["mentor", "guest"] as const) {
      const flags = flagsForRole(role);
      for (const key of PERMISSION_FLAG_KEYS) {
        expect(flags[key], `${role}.${key}`).toBe(false);
      }
    }
  });

  it("covers every value of the org_role enum", () => {
    // A role added to the enum without a template here would otherwise silently
    // inherit the fail-closed branch, which is safe but surprising.
    for (const role of ORG_ROLES) {
      expect(isOrgRole(role)).toBe(true);
      expect(Object.keys(flagsForRole(role)).sort()).toEqual(
        [...PERMISSION_FLAG_KEYS].sort(),
      );
    }
  });

  it("fails CLOSED for unknown, null and undefined roles", () => {
    // The old implementation's `default` branch returned WORKER_PERMISSIONS —
    // write access — for `member`, `guest` and anything unrecognised.
    const cases: { label: string; role: unknown }[] = [
      { label: "null", role: null },
      { label: "undefined", role: undefined },
      { label: "empty string", role: "" },
      { label: "unrecognised string", role: "superuser" },
      { label: "number", role: 7 },
      { label: "object", role: {} },
    ];

    for (const { label, role } of cases) {
      const flags = flagsForRole(role);
      for (const key of PERMISSION_FLAG_KEYS) {
        expect(flags[key], `${label}.${key}`).toBe(false);
      }
    }
  });

  it("returns a fresh object each call, so a caller cannot mutate a template", () => {
    const first = flagsForRole("admin");
    first.canDeleteTasks = false;

    expect(flagsForRole("admin").canDeleteTasks).toBe(true);
  });
});

describe("isViewOnlyRole", () => {
  it("is true for the read-only roles and for anything unrecognised", () => {
    expect(isViewOnlyRole("mentor")).toBe(true);
    expect(isViewOnlyRole("guest")).toBe(true);
    expect(isViewOnlyRole("nonsense")).toBe(true);
    expect(isViewOnlyRole(null)).toBe(true);
  });

  it("is false for roles that can write", () => {
    expect(isViewOnlyRole("admin")).toBe(false);
    expect(isViewOnlyRole("member")).toBe(false);
    expect(isViewOnlyRole("worker")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Client-facing view
// ---------------------------------------------------------------------------

describe("permissionsFromFlags", () => {
  it("derives the UI shape from the flags rather than from the role", () => {
    // An admin who has had `canEditProjects` revoked individually must not be
    // shown edit controls just because their role says admin.
    const flags = { ...flagsForRole("admin"), canEditProjects: false };
    const permissions = permissionsFromFlags(flags);

    expect(permissions.canEditTasks).toBe(false);
    // Untouched capabilities survive: only what was revoked changes.
    expect(permissions.canDeleteTasks).toBe(true);
    expect(permissions.canDeleteProjects).toBe(true);
  });

  it("ties project deletion to canDeleteTasks, not to canEditProjects", () => {
    const contributor = permissionsFromFlags(flagsForRole("member"));
    expect(contributor.canEditProjects).toBe(true);
    expect(contributor.canDeleteProjects).toBe(false);
  });

  it("marks a role with no flags as view-only", () => {
    expect(getPermissions("mentor").isViewOnly).toBe(true);
    expect(getPermissions("mentor").canCreateNotes).toBe(false);
  });

  it("lets anyone with any write flag manage their own notes and events", () => {
    // Notes and events are owned by their creator, not organization-scoped.
    const permissions = getPermissions("worker");
    expect(permissions.canCreateNotes).toBe(true);
    expect(permissions.canDeleteNotes).toBe(true);
    expect(permissions.isViewOnly).toBe(false);
  });

  it("grants everything in personal mode, where ownership is the authority", () => {
    const permissions = personalModePermissions();
    expect(permissions.isViewOnly).toBe(false);
    expect(permissions.canDeleteTasks).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// membershipHasFlag
// ---------------------------------------------------------------------------

describe("membershipHasFlag", () => {
  it("denies a non-member", () => {
    expect(membershipHasFlag(null, "canEditProjects")).toBe(false);
  });

  it("reads the column when any flag is set", () => {
    const membership = {
      role: "member",
      ...flagsForRole("member"),
      canDeleteTasks: true,
    };
    expect(membershipHasFlag(membership, "canDeleteTasks")).toBe(true);
  });

  it("does not let the role override an explicitly revoked column", () => {
    // An admin who has been individually stripped of one capability keeps the
    // rest, so the row is not all-false and the role fallback must not apply.
    const membership = {
      role: "admin",
      ...flagsForRole("admin"),
      canDeleteTasks: false,
    };
    expect(membershipHasFlag(membership, "canDeleteTasks")).toBe(false);
    expect(membershipHasFlag(membership, "canEditProjects")).toBe(true);
  });

  it("falls back to the role template for legacy all-false rows", () => {
    // `join` used to insert every flag as false regardless of role, so an
    // un-backfilled contributor is indistinguishable from a view-only member by
    // columns alone. Without this fallback they would lose write access.
    const legacyWorker = {
      role: "worker",
      canAddMembers: false,
      canAssignTasks: false,
      canCreateProjects: false,
      canDeleteTasks: false,
      canKickMembers: false,
      canManageRoles: false,
      canEditProjects: false,
      canViewAnalytics: false,
    };

    expect(membershipHasFlag(legacyWorker, "canEditProjects")).toBe(true);
    // …but only what the template actually grants.
    expect(membershipHasFlag(legacyWorker, "canDeleteTasks")).toBe(false);
  });

  it("keeps a legacy mentor row read-only", () => {
    const legacyMentor = { role: "mentor", ...flagsForRole("mentor") };
    for (const key of PERMISSION_FLAG_KEYS) {
      expect(membershipHasFlag(legacyMentor, key), key).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// assertProjectPermission
// ---------------------------------------------------------------------------

describe("assertProjectPermission", () => {
  it("rejects an unauthenticated caller", async () => {
    const ctx = makeCtx(null, []);
    await expectTRPCError(
      assertProjectPermission(ctx, 1, "canEditProjects"),
      "UNAUTHORIZED",
    );
  });

  it("throws NOT_FOUND for a project that does not exist", async () => {
    const ctx = makeCtx("user-1", [[]]);
    await expectTRPCError(
      assertProjectPermission(ctx, 999, "canEditProjects"),
      "NOT_FOUND",
    );
  });

  it("skips the flag check for a personal project owned by the caller", async () => {
    // No organization means no membership row and no flags; ownership decides.
    const ctx = makeCtx("owner-1", [[PERSONAL_PROJECT], []]);
    const project = await assertProjectPermission(ctx, 1, "canDeleteTasks");
    expect(project.id).toBe(1);
  });

  it("denies a stranger with no relationship to the project", async () => {
    const ctx = makeCtx("stranger", [[ORG_PROJECT], [], []]);
    await expectTRPCError(
      assertProjectPermission(ctx, 2, "canEditProjects"),
      "FORBIDDEN",
    );
  });

  it("allows an org member who holds the flag", async () => {
    const ctx = makeCtx("member-1", [
      [ORG_PROJECT],
      [membershipRow("member")],
      [],
    ]);
    const project = await assertProjectPermission(ctx, 2, "canEditProjects");
    expect(project.id).toBe(2);
  });

  it("denies an org member who lacks the specific flag", async () => {
    // This is the finding: `canDeleteTasks` is false in the contributor template,
    // and before the fix nothing consulted it.
    const ctx = makeCtx("member-1", [
      [ORG_PROJECT],
      [membershipRow("member")],
      [],
    ]);
    await expectTRPCError(
      assertProjectPermission(ctx, 2, "canDeleteTasks"),
      "FORBIDDEN",
    );
  });

  it("denies a mentor every write capability, on the server", async () => {
    for (const flag of PERMISSION_FLAG_KEYS) {
      const ctx = makeCtx("mentor-1", [
        [ORG_PROJECT],
        [membershipRow("mentor")],
        [],
      ]);
      await expectTRPCError(
        assertProjectPermission(ctx, 2, flag),
        "FORBIDDEN",
      );
    }
  });

  it("allows an admin every capability", async () => {
    for (const flag of PERMISSION_FLAG_KEYS) {
      const ctx = makeCtx("admin-1", [
        [ORG_PROJECT],
        [membershipRow("admin")],
        [],
      ]);
      await expect(
        assertProjectPermission(ctx, 2, flag),
      ).resolves.toMatchObject({ id: 2 });
    }
  });

  it("does not exempt the project owner from the flag check", async () => {
    // "Strict flags": inside an organization the columns are the authority, so a
    // member whose capability was revoked cannot act on their own project.
    const ctx = makeCtx("owner-1", [
      [ORG_PROJECT],
      [membershipRow("member")],
      [],
    ]);
    await expectTRPCError(
      assertProjectPermission(ctx, 2, "canDeleteTasks"),
      "FORBIDDEN",
    );
  });

  it("honours an outside write-collaborator grant without consulting org flags", async () => {
    // A collaborator is not governed by the organization's roles — the grant
    // itself is the authorization.
    const ctx = makeCtx("outsider", [
      [ORG_PROJECT],
      [],
      [{ permission: "write" }],
    ]);
    const project = await assertProjectPermission(ctx, 2, "canDeleteTasks");
    expect(project.id).toBe(2);
  });

  it("denies a read-only collaborator", async () => {
    const ctx = makeCtx("outsider", [
      [ORG_PROJECT],
      [],
      [{ permission: "read" }],
    ]);
    await expectTRPCError(
      assertProjectPermission(ctx, 2, "canEditProjects"),
      "FORBIDDEN",
    );
  });

  it("names the missing capability in the error, so it is actionable", async () => {
    const ctx = makeCtx("member-1", [
      [ORG_PROJECT],
      [membershipRow("member")],
      [],
    ]);

    await assertProjectPermission(ctx, 2, "canDeleteTasks").catch(
      (err: unknown) => {
        expect((err as TRPCError).message).toContain("delete tasks");
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Organization-level checks
// ---------------------------------------------------------------------------

describe("requireMembership", () => {
  it("returns the membership row for a member", async () => {
    const ctx = makeCtx("member-1", [[membershipRow("member")]]);
    const membership = await requireMembership(ctx, 42);
    expect(membership.role).toBe("member");
  });

  it("throws FORBIDDEN for a non-member", async () => {
    const ctx = makeCtx("stranger", [[]]);
    await expectTRPCError(requireMembership(ctx, 42), "FORBIDDEN");
  });
});

describe("assertOrgPermission", () => {
  it("allows a member who holds the flag", async () => {
    const ctx = makeCtx("member-1", [[membershipRow("member")]]);
    await expect(
      assertOrgPermission(ctx, 42, "canCreateProjects"),
    ).resolves.toMatchObject({ role: "member" });
  });

  it("denies a member who lacks it", async () => {
    const ctx = makeCtx("member-1", [[membershipRow("member")]]);
    await expectTRPCError(
      assertOrgPermission(ctx, 42, "canManageRoles"),
      "FORBIDDEN",
    );
  });

  it("denies a mentor the ability to create projects", async () => {
    const ctx = makeCtx("mentor-1", [[membershipRow("mentor")]]);
    await expectTRPCError(
      assertOrgPermission(ctx, 42, "canCreateProjects"),
      "FORBIDDEN",
    );
  });
});
