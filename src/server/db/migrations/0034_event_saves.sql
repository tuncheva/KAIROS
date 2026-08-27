-- Phase 5 of the events rebuild: bookmarking without pretending to attend.
--
-- Hand-written for the journal-timestamp reason described in 0030.
--
-- "I want to remember this" and "I am coming" are different claims, and people
-- have been using *Maybe* to make the first — which lands in the count the host
-- plans catering from. A save is private to the person who made it and is never
-- counted anywhere the host can see.

CREATE TABLE IF NOT EXISTS "event_save" (
	"event_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_save_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_save" ADD CONSTRAINT "event_save_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_save" ADD CONSTRAINT "event_save_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "save_user_idx" ON "event_save" ("user_id");
