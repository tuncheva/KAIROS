-- Stripe billing: plan state on the two things that can hold a subscription.
--
-- Hand-written for the same reason 0041 was: the drizzle-kit snapshot in meta/
-- trails the live journal, so `drizzle-kit generate` would propose re-creating
-- everything added since 0020. Every statement is idempotent.
--
-- Sections:
--   A. Enums: plan, subscription_status
--   B. Billing columns on "user"
--   C. Billing columns on organizations (+ seats)
--   D. Indexes
--
-- Note on the defaults. `plan` defaults to 'free' and is NOT NULL, so every
-- existing row is backfilled to Free by the ADD COLUMN itself. That is the
-- correct historical answer — nobody has paid yet — but it is also the moment
-- the product stops being free for everyone, because
-- `server/billing/entitlements.ts` reads this column instead of returning the
-- Pro constant. Applying this migration and deploying that change are the same
-- release; splitting them locks existing users out of features they had.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Enums
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "plan" AS ENUM ('free', 'pro', 'team');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM (
    'active', 'trialing', 'past_due', 'canceled', 'incomplete'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Personal subscriptions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "plan" "plan" DEFAULT 'free' NOT NULL;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar(255);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar(255);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "subscription_status" "subscription_status";
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "current_period_end" timestamp with time zone;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL;

-- Unique, not merely indexed. A Stripe customer belongs to exactly one account,
-- and the webhook resolves the account *by* this column — two rows sharing one
-- customer id means a payment applying to whichever row Postgres returns first.
DO $$ BEGIN
  ALTER TABLE "user" ADD CONSTRAINT "user_stripe_customer_id_unique" UNIQUE ("stripe_customer_id");
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "user" ADD CONSTRAINT "user_stripe_subscription_id_unique" UNIQUE ("stripe_subscription_id");
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Organization subscriptions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "plan" "plan" DEFAULT 'free' NOT NULL;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar(255);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar(255);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_status" "subscription_status";
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "current_period_end" timestamp with time zone;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "seats" integer DEFAULT 0 NOT NULL;

DO $$ BEGIN
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_stripe_customer_id_unique" UNIQUE ("stripe_customer_id");
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_stripe_subscription_id_unique" UNIQUE ("stripe_subscription_id");
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Indexes
-- ─────────────────────────────────────────────────────────────────────────────
-- The entitlements resolver reads a member's org plan on request paths that
-- already join organization_members; this supports the reverse lookup the
-- webhook does, from a subscription back to the org that owns it.
CREATE INDEX IF NOT EXISTS "org_subscription_idx" ON "organizations" ("stripe_subscription_id");
CREATE INDEX IF NOT EXISTS "user_subscription_idx" ON "user" ("stripe_subscription_id");
