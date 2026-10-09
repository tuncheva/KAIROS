-- Invitation privacy: opt-in discovery, an opt-out list, capped resends.
--
-- Additive only. `discoverable_by_email` defaults to false, so nobody becomes
-- findable by email until they turn it on. `invite_suppressions` holds keyed
-- hashes, never addresses. See docs/invite-email-legal-research-2026-10-08.md.

CREATE TABLE IF NOT EXISTS "invite_suppressions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "invite_suppressions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email_hash" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "invite_suppressions_email_hash_unique" UNIQUE("email_hash")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "discoverable_by_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD COLUMN IF NOT EXISTS "send_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamp with time zone;
