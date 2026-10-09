-- What a workspace calls its agents.
--
-- Additive only: two jsonb columns of overrides keyed by agent id, empty by
-- default, so every existing row keeps the Greek defaults. `organizations`
-- holds a workspace's names (shared by all members, admin-written); `user`
-- holds the names of someone working without a workspace. Validated in
-- `~/lib/agentNames` before they are written or read into a prompt.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "agent_names" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "agent_names" jsonb DEFAULT '{}'::jsonb NOT NULL;
