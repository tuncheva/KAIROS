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
  it("worker cannot delete projects or events", () => {
    const p = getPermissions("worker");
    expect(p.canDeleteProjects).toBe(false);
    expect(p.canDeleteEvents).toBe(false);
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

  /* ── Fallback ── */
  it("falls back to worker for null", () => {
    const p = getPermissions(null);
    expect(p).toEqual(getPermissions("worker"));
  });

  it("falls back to worker for undefined", () => {
    const p = getPermissions(undefined);
    expect(p).toEqual(getPermissions("worker"));
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

  it("returns false for null", () => {
    expect(isViewOnlyRole(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isViewOnlyRole(undefined)).toBe(false);
  });
});
