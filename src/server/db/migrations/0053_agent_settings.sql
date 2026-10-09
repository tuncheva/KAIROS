-- Per-agent settings.
--
-- Additive only: two jsonb maps keyed by setting id, empty by default, so every
-- agent keeps its default behaviour until someone changes something.
-- `organizations` holds workspace-scoped settings (admin-written); `user` holds
-- personal ones, plus workspace-scoped ones for someone without a workspace.
-- The catalog, validators and defaults live in `~/lib/agentSettings`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "agent_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "agent_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
