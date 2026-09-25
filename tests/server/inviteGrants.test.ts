/**
 * Invites grant exactly what was ticked — no more, no less.
 *
 * Before this, an invite stored only a role name and acceptance re-derived the
 * flags from that role's template, so every hand-picked tick and every custom
 * role was silently replaced on the way in. These pin the pieces the invite,
 * link and acceptance paths share.
 */

import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";

import {
  PERMISSION_FLAG_KEYS,
  ROLE_TEMPLATES,
  baseRoleForFlags,
  flagsBeyond,
  flagsForRole,
  pickPermissionFlags,
  sameFlags,
  type MemberPermissionFlags,
} from "~/lib/permissions";
import {
  generateInviteToken,
  hashInviteToken,
  inviteGrantSchema,
  resolveGrant,
  storedGrantFlags,
} from "~/server/orgs/inviteGrants";
import { renderOrganizationInviteEmailForTest } from "~/server/email/email";

const NONE = pickPermissionFlags({});
const ALL = flagsForRole("admin");

function flags(...keys: (keyof MemberPermissionFlags)[]): MemberPermissionFlags {
  return { ...NONE, ...Object.fromEntries(keys.map((k) => [k, true])) };
}

const roleManager = { role: "admin", ...ALL };
const delegate = { role: "member", ...flags("canAddMembers", "canCreateProjects", "canEditProjects") };

describe("pickPermissionFlags", () => {
  it("keeps exactly the eight flags, as strict booleans", () => {
    const picked = pickPermissionFlags({
      canAddMembers: true,
      canDeleteTasks: "yes",
      role: "admin",
      organizationId: 99,
    });
    expect(Object.keys(picked).sort()).toEqual([...PERMISSION_FLAG_KEYS].sort());
    expect(picked.canAddMembers).toBe(true);
    // Truthy is not enough: only `true` grants.
    expect(picked.canDeleteTasks).toBe(false);
    expect(picked).not.toHaveProperty("role");
  });

  it("reads null and missing keys as not granted", () => {
    expect(pickPermissionFlags(null)).toEqual(NONE);
  });
});

describe("baseRoleForFlags", () => {
  it("keeps an unedited template's role", () => {
    for (const role of ["member", "guest", "mentor", "admin"] as const) {
      expect(baseRoleForFlags(role, flagsForRole(role))).toBe(role);
    }
  });

  it("promotes a view-only template that was ticked into writing", () => {
    expect(baseRoleForFlags("guest", flags("canCreateProjects"))).toBe("member");
    expect(baseRoleForFlags("mentor", flags("canViewAnalytics"))).toBe("member");
  });

  it("demotes a contributor template with every tick cleared", () => {
    expect(baseRoleForFlags("member", NONE)).toBe("guest");
  });

  it("never invents or drops admin", () => {
    expect(baseRoleForFlags("admin", NONE)).toBe("admin");
    expect(baseRoleForFlags("member", ALL)).toBe("member");
  });
});

describe("resolveGrant", () => {
  it("returns the ticked flags verbatim — not the role template", () => {
    const ticked = flags("canDeleteTasks", "canViewAnalytics");
    const grant = resolveGrant(roleManager, { role: "member", permissions: ticked });
    expect(grant.permissions).toEqual(ticked);
    expect(sameFlags(grant.permissions, flagsForRole("member"))).toBe(false);
  });

  it("uses the template when no flags are passed", () => {
    const grant = resolveGrant(roleManager, { role: "member" });
    expect(grant.permissions).toEqual(flagsForRole("member"));
  });

  it("carries a custom role's label", () => {
    const grant = resolveGrant(roleManager, {
      role: "member",
      displayRole: "Designer",
      permissions: flags("canEditProjects"),
    });
    expect(grant.displayRole).toBe("Designer");
  });

  it("refuses an admin invite from anyone but a role manager", () => {
    expect(() => resolveGrant(delegate, { role: "admin", permissions: NONE })).toThrow(TRPCError);
    expect(() =>
      resolveGrant({ role: "admin", ...flags("canAddMembers") }, { role: "admin" }),
    ).toThrow(TRPCError);
    expect(resolveGrant(roleManager, { role: "admin" }).role).toBe("admin");
  });

  it("refuses a delegate granting a flag they don't hold", () => {
    expect(() =>
      resolveGrant(delegate, { role: "member", permissions: flags("canManageRoles") }),
    ).toThrow(/Manage roles/);
    // The member template includes flags this delegate lacks.
    expect(() => resolveGrant(delegate, { role: "member" })).toThrow(TRPCError);
  });

  it("lets a delegate grant a subset of their own flags", () => {
    const ticked = flags("canCreateProjects");
    expect(resolveGrant(delegate, { role: "member", permissions: ticked }).permissions).toEqual(
      ticked,
    );
  });

  it("rejects a flag set with a missing key at the schema", () => {
    const { canViewAnalytics: _drop, ...seven } = ALL;
    expect(inviteGrantSchema.safeParse({ role: "member", permissions: seven }).success).toBe(false);
  });
});

describe("flagsBeyond", () => {
  it("lists exactly the extra flags", () => {
    expect(flagsBeyond(flags("canAddMembers", "canKickMembers"), flags("canAddMembers"))).toEqual([
      "canKickMembers",
    ]);
    expect(flagsBeyond(NONE, NONE)).toEqual([]);
  });
});

describe("storedGrantFlags", () => {
  it("prefers the stored set, even an empty one", () => {
    expect(storedGrantFlags(NONE, ROLE_TEMPLATES.member)).toEqual(NONE);
  });

  it("falls back to the template for invites made before flags were stored", () => {
    expect(storedGrantFlags(null, ROLE_TEMPLATES.member)).toEqual(ROLE_TEMPLATES.member);
  });
});

describe("invite tokens", () => {
  it("are unique and hash deterministically", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashInviteToken(a)).toBe(hashInviteToken(a));
    expect(hashInviteToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(a)).not.toContain(a);
  });
});

describe("invitation email", () => {
  const base = {
    inviterName: "Ana",
    organizationName: "Acme",
    roleLabel: "Designer",
    permissionLabels: ["Create projects", "Edit projects"],
    acceptUrl: "https://kairos.example/invite/abc",
    expiresAt: new Date("2026-10-02T00:00:00Z"),
  };

  it("lists exactly the granted permissions and links to the invite", () => {
    const { subject, html, text } = renderOrganizationInviteEmailForTest(base);
    expect(subject).toContain("Ana");
    expect(subject).toContain("Acme");
    expect(html).toContain("Create projects");
    expect(html).toContain("Edit projects");
    expect(html).not.toContain("Delete tasks");
    expect(html).toContain("https://kairos.example/invite/abc");
    expect(text).toContain("- Create projects\n- Edit projects");
  });

  it("says view-only when nothing is granted", () => {
    const { html } = renderOrganizationInviteEmailForTest({ ...base, permissionLabels: [] });
    expect(html).toContain("View-only");
  });

  it("escapes user-authored names", () => {
    const { html } = renderOrganizationInviteEmailForTest({
      ...base,
      inviterName: "<img src=x onerror=alert(1)>",
      organizationName: "<b>Acme</b>",
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Acme");
    expect(html).toContain("&lt;img");
  });
});
