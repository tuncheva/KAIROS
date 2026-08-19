-- Backfill the permission columns on organization_members from each row's role.
--
-- Why this is needed: the eight boolean columns have existed since organizations
-- shipped, but only `organization.create` and `updateMemberRole` ever populated
-- them. The two paths most members actually arrive through — `join` by access
-- code and `acceptInvite` — inserted every flag as `false` regardless of role.
-- Nothing read the columns, so it never showed.
--
-- Those columns are now the source of truth for server-side authorization
-- (see src/lib/permissions.ts and src/server/api/authz.ts). Without this
-- backfill, every existing contributor would be indistinguishable from a
-- view-only member and would lose write access.
--
-- Safety: only rows where *every* flag is false are touched. A row with any flag
-- set has been managed deliberately — by role assignment or by an admin granting
-- an individual capability — and is left exactly as it is. That makes this
-- migration idempotent and safe to re-run.
--
-- Templates must stay in step with ROLE_TEMPLATES in src/lib/permissions.ts.
--   admin           → every capability
--   member, worker  → assign tasks, create/edit projects, view analytics
--   guest, mentor   → none (view-only; already all-false, so no-op)

UPDATE "organization_members"
SET
  "can_add_members" = true,
  "can_assign_tasks" = true,
  "can_create_projects" = true,
  "can_delete_tasks" = true,
  "can_kick_members" = true,
  "can_manage_roles" = true,
  "can_edit_projects" = true,
  "can_view_analytics" = true
WHERE "role" = 'admin'
  AND NOT (
    "can_add_members" OR "can_assign_tasks" OR "can_create_projects"
    OR "can_delete_tasks" OR "can_kick_members" OR "can_manage_roles"
    OR "can_edit_projects" OR "can_view_analytics"
  );
--> statement-breakpoint
UPDATE "organization_members"
SET
  "can_assign_tasks" = true,
  "can_create_projects" = true,
  "can_edit_projects" = true,
  "can_view_analytics" = true
WHERE "role" IN ('member', 'worker')
  AND NOT (
    "can_add_members" OR "can_assign_tasks" OR "can_create_projects"
    OR "can_delete_tasks" OR "can_kick_members" OR "can_manage_roles"
    OR "can_edit_projects" OR "can_view_analytics"
  );
