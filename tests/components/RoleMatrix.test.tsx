import { describe, expect, it } from "vitest";

import {
  PERMISSION_GROUPS,
  driftedHolders,
  holdersByColumn,
  type MatrixMember,
  type MatrixRole,
} from "~/components/settings/RoleMatrix";
import { PERMISSION_DISPLAY_ORDER } from "~/components/orgs/PermissionGrid";
import { PERMISSION_FLAG_KEYS, ROLE_TEMPLATES, pickPermissionFlags } from "~/lib/permissions";

const member = (
  id: string,
  role: string,
  displayRole: string | null,
  flags = ROLE_TEMPLATES.member,
): MatrixMember => ({
  id,
  name: id,
  email: `${id}@example.test`,
  image: null,
  role,
  displayRole,
  ...flags,
});

const reviewer: MatrixRole = {
  id: 7,
  name: "Reviewer",
  ...pickPermissionFlags({ canEditProjects: true, canViewAnalytics: true }),
};

describe("PERMISSION_GROUPS", () => {
  it("lists every flag exactly once, in display order", () => {
    const flat = PERMISSION_GROUPS.flatMap((g) => g.flags);
    expect(flat).toEqual([...PERMISSION_DISPLAY_ORDER]);
    expect(new Set(flat).size).toBe(PERMISSION_FLAG_KEYS.length);
  });
});

describe("holdersByColumn", () => {
  it("files custom-role holders under the role, others under their base role", () => {
    const map = holdersByColumn(
      [
        member("ana", "member", "Reviewer"),
        member("bo", "worker", null),
        member("cy", "admin", null, ROLE_TEMPLATES.admin),
        member("di", "mentor", null, ROLE_TEMPLATES.mentor),
      ],
      [reviewer],
    );
    expect(map.get("custom:7")?.map((m) => m.id)).toEqual(["ana"]);
    // `worker` is `member` under its older name.
    expect(map.get("member")?.map((m) => m.id)).toEqual(["bo"]);
    expect(map.get("admin")?.map((m) => m.id)).toEqual(["cy"]);
    expect(map.get("mentor")?.map((m) => m.id)).toEqual(["di"]);
  });

  it("falls back to the base role when the named role no longer exists", () => {
    const map = holdersByColumn([member("ana", "member", "Deleted role")], [reviewer]);
    expect(map.get("member")?.map((m) => m.id)).toEqual(["ana"]);
    expect(map.get("custom:7")).toBeUndefined();
  });
});

describe("driftedHolders", () => {
  it("returns only holders whose flags differ from the role", () => {
    const exact = member("ana", "member", "Reviewer", pickPermissionFlags(reviewer));
    const extra = member("bo", "member", "Reviewer", {
      ...pickPermissionFlags(reviewer),
      canAddMembers: true,
    });
    expect(driftedHolders([exact, extra], pickPermissionFlags(reviewer)).map((m) => m.id)).toEqual([
      "bo",
    ]);
  });
});
