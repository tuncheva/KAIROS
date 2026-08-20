"use client";

import { useMemo } from "react";
import { api } from "~/trpc/react";
import {
  getPermissions,
  permissionsFromFlags,
  personalModePermissions,
  type OrgRole,
  type RolePermissions,
} from "~/lib/permissions";

/**
 * The current user's permissions inside their active organization.
 *
 * This is presentation only — it decides which controls to render and whether to
 * show the view-only banner. Every mutation is authorized again on the server
 * against the same permission columns (`~/server/api/authz`), so a client that
 * lies to itself here gains nothing.
 *
 * Two behaviours changed when the permission model was unified:
 *
 *  - While the profile query is in flight this used to return **admin**
 *    permissions, so a view-only user saw every edit control until the query
 *    landed. It now returns no permissions until the answer is known; read
 *    `isLoading` if you want to render a skeleton instead of a disabled control.
 *  - Permissions come from the membership row's flag columns when the server
 *    provides them, falling back to the role template only for older payloads.
 */
export function useRolePermissions(): {
  role: OrgRole | null;
  permissions: RolePermissions;
  isLoading: boolean;
} {
  const { data: profile, isLoading } = api.user.getProfile.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const role = (profile?.role as OrgRole | null) ?? null;

  const permissions = useMemo(() => {
    // Fail closed until we know who this is. `isLoading` distinguishes "not yet
    // known" from "genuinely has no permissions".
    if (isLoading || !profile) return getPermissions(null);

    // Outside an organization the user is working on their own data, where
    // ownership rather than org role is the authority.
    if (!profile.organization || profile.usageMode === "personal") {
      return personalModePermissions();
    }

    if (profile.permissions) return permissionsFromFlags(profile.permissions);

    return getPermissions(role);
  }, [isLoading, profile, role]);

  return { role, permissions, isLoading };
}
