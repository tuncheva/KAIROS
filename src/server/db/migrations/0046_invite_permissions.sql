-- Invites carry the exact permissions the inviter ticked.
--
-- Until now an invite stored only a role name, and acceptance re-derived the
-- flags from that role's template — so the permission ticks in the UI, and any
-- custom role, were dropped on the way. These columns hold the hand-picked set
-- so acceptance can write it verbatim.
--
-- Additive only. Existing rows keep NULL `permissions` and fall back to the
-- role template, which is what they always got.
--
-- `accept_token_hash` is deliberately not named `token_hash`: the live database
-- already holds an undeclared `organization_invites.token_hash` of unknown type
-- (see 0021), and reusing the name would collide with it.

ALTER TABLE "organization_invites" ADD COLUMN IF NOT EXISTS "permissions" jsonb;
--> statement-breakpoint
ALTER TABLE "organization_invites" ADD COLUMN IF NOT EXISTS "accept_token_hash" varchar(64);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_accept_token_hash_unique" UNIQUE ("accept_token_hash");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "organization_join_codes" ADD COLUMN IF NOT EXISTS "kind" varchar(10) DEFAULT 'qr' NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_join_codes" ADD COLUMN IF NOT EXISTS "display_role" varchar(100);
--> statement-breakpoint
ALTER TABLE "organization_join_codes" ADD COLUMN IF NOT EXISTS "permissions" jsonb;
--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "display_role" varchar(100);
