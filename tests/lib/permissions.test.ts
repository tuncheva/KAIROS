import { describe, it, expect } from "vitest";
import {
  getPermissions,
  isViewOnlyRole,
  type RolePermissions,
} from "~/lib/permissions";

describe("getPermissions", () => {
  /* ── Admin ── */
  it("returns full permissions for admin", () => {
    const p = getPermissions("admin");
    expect(p.isViewOnly).toBe(false);
    expect(p.canCreateProjects).toBe(true);
    expect(p.canDeleteProjects).toBe(true);
    expect(p.canManageMembers).toBe(true);
    expect(p.canManageOrg).toBe(true);
  });

  it("admin can do everything", () => {
    const p = getPermissions("admin");
    const allTrue = Object.entries(p)
      .filter(([key]) => key !== "isViewOnly")
      .every(([, val]) => val === true);
    expect(allTrue).toBe(true);
  });

  /* ── Worker ── */
  it("worker cannot delete projects", () => {
    // Project deletion tracks `canDeleteTasks`, which the contributor template
    // withholds, so a worker may edit a project without being able to destroy it.
    const p = getPermissions("worker");
    expect(p.canDeleteProjects).toBe(false);
    expect(p.canDeleteTasks).toBe(false);
  });

  it("worker can delete their own events", () => {
    // Events are owned by their creator rather than being org-scoped, and the
    // server has always let a creator delete their own event. The old matrix said
    // otherwise, which only ever hid a button for an action that was permitted.
    expect(getPermissions("worker").canDeleteEvents).toBe(true);
  });

  it("worker cannot manage members or org", () => {
    const p = getPermissions("worker");
    expect(p.canManageMembers).toBe(false);
    expect(p.canManageOrg).toBe(false);
  });

  it("worker can create / edit projects and tasks", () => {
    const p = getPermissions("worker");
    expect(p.canCreateProjects).toBe(true);
    expect(p.canEditProjects).toBe(true);
    expect(p.canCreateTasks).toBe(true);
    expect(p.canEditTasks).toBe(true);
  });

  it("worker is not view-only", () => {
    expect(getPermissions("worker").isViewOnly).toBe(false);
  });

  /* ── Mentor ── */
  it("mentor is fully view-only", () => {
    const p = getPermissions("mentor");
    expect(p.isViewOnly).toBe(true);
  });

  it("mentor cannot do anything except view", () => {
    const p = getPermissions("mentor");
    const allFalse = Object.entries(p)
      .filter(([key]) => key !== "isViewOnly")
      .every(([, val]) => val === false);
    expect(allFalse).toBe(true);
  });

  /* ── Unknown roles fail closed ── */
  //
  // These previously asserted the opposite: an unrecognised role fell back to
  // WORKER_PERMISSIONS, i.e. write access. That made `member`, `guest` and every
  // typo a writer. The contract is now the safe direction — see
  // tests/server/permissions.test.ts for the full decision table.
  it("grants nothing for null", () => {
    expect(getPermissions(null)).toEqual(getPermissions("mentor"));
  });

  it("grants nothing for undefined", () => {
    expect(getPermissions(undefined)).toEqual(getPermissions("mentor"));
  });

  it("grants nothing for an unrecognised role", () => {
    expect(getPermissions("superuser").isViewOnly).toBe(true);
  });

  /* ── Return type ── */
  it("returns a RolePermissions object with all expected keys", () => {
    const expectedKeys: Array<keyof RolePermissions> = [
      "canCreateProjects",
      "canEditProjects",
      "canDeleteProjects",
      "canCreateTasks",
      "canEditTasks",
      "canDeleteTasks",
      "canCreateNotes",
      "canEditNotes",
      "canDeleteNotes",
      "canCreateEvents",
      "canEditEvents",
      "canDeleteEvents",
      "canManageMembers",
      "canManageOrg",
      "isViewOnly",
    ];
    const p = getPermissions("admin");
    for (const key of expectedKeys) {
      expect(typeof p[key]).toBe("boolean");
    }
  });
});

describe("isViewOnlyRole", () => {
  it("returns true for mentor", () => {
    expect(isViewOnlyRole("mentor")).toBe(true);
  });

  it("returns false for admin", () => {
    expect(isViewOnlyRole("admin")).toBe(false);
  });

  it("returns false for worker", () => {
    expect(isViewOnlyRole("worker")).toBe(false);
  });

  it("returns true for null — an unknown role is treated as view-only", () => {
    expect(isViewOnlyRole(null)).toBe(true);
  });

  it("returns true for undefined", () => {
    expect(isViewOnlyRole(undefined)).toBe(true);
  });
});
