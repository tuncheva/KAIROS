-- Web Push subscriptions, one row per browser/device that enabled push.
--
-- Additive only. `endpoint` is unique because it identifies a browser install,
-- not a person: signing into another account on the same phone moves the row.
-- Rows are deleted when the push service answers 404/410 (subscription gone).

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "push_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar(255) NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" varchar(512),
	"created_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscription_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscription_user_idx" ON "push_subscriptions" USING btree ("user_id");
