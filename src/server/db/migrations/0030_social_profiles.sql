-- Social profiles: audience control, the follow graph, and last-seen.
--
-- Written by hand rather than generated. `db:generate` stamps the journal entry
-- with `Date.now()`, which is *behind* this repo's hand-set timestamps, and
-- `drizzle-kit migrate` then skips the file silently — see
-- `scripts/fix-migration-journal.ts`. The matching journal entry is appended
-- with a `when` above every prior entry.

DO $$ BEGIN
 CREATE TYPE "profile_audience" AS ENUM('everyone', 'organization', 'shared');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "profile_audience" "profile_audience" DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "allow_followers" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "show_activity_feed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_follow" (
	"follower_id" varchar(255) NOT NULL,
	"following_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_follow_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_follow" ADD CONSTRAINT "user_follow_follower_id_user_id_fk" FOREIGN KEY ("follower_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_follow" ADD CONSTRAINT "user_follow_following_id_user_id_fk" FOREIGN KEY ("following_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- A row cannot follow itself. Cheaper to refuse here than to filter in every read.
DO $$ BEGIN
 ALTER TABLE "user_follow" ADD CONSTRAINT "user_follow_no_self" CHECK ("follower_id" <> "following_id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_follow_following_idx" ON "user_follow" USING btree ("following_id");
