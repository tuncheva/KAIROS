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
-- Safety, and why the two branches differ.
--
-- For member/worker, only rows where *every* flag is false are touched. Any flag
-- being set means the row has been managed deliberately, and is left alone.
--
-- For admin the condition is "not already complete", not "all false". Verified
-- against the live database before writing this: three organization *owners* hold
-- role='admin' with only can_add_members and can_assign_tasks — a legacy insert
-- path, not a deliberate revocation. The all-false guard would have skipped them
-- and, once the columns became authoritative, those owners would have lost the
-- ability to create or edit projects in their own organization.
--
-- Re-granting is safe for admin specifically because `updateMemberRole` already
-- rewrites all eight columns from the role template whenever a role is assigned,
-- so "admin with a partial flag set" is not a state the current code can produce
-- on purpose.
--
-- Both branches only ever set flags to true, and both are guarded, so this
-- migration is idempotent and safe to re-run.
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
    "can_add_members" AND "can_assign_tasks" AND "can_create_projects"
    AND "can_delete_tasks" AND "can_kick_members" AND "can_manage_roles"
    AND "can_edit_projects" AND "can_view_analytics"
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
