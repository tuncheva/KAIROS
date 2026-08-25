CREATE TABLE "conversation_participants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "conversation_participants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"last_read_message_id" integer,
	"cleared_before" integer,
	"muted_until" timestamp,
	"archived_at" timestamp,
	"joined_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"left_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "direct_message_attachments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "direct_message_attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"url" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"mime" varchar(127) NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_message_reactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "direct_message_reactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"emoji" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "direct_messages" ADD COLUMN "reply_to_id" integer;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD COLUMN "pinned_at" timestamp;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD COLUMN "pinned_by" varchar(255);--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_direct_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."direct_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_message_attachments" ADD CONSTRAINT "direct_message_attachments_message_id_direct_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."direct_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_message_reactions" ADD CONSTRAINT "direct_message_reactions_message_id_direct_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."direct_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_message_reactions" ADD CONSTRAINT "direct_message_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participant_unique" ON "conversation_participants" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "conversation_participant_user_idx" ON "conversation_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "direct_msg_attachment_message_idx" ON "direct_message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "direct_message_reaction_unique" ON "direct_message_reactions" USING btree ("message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "direct_msg_reaction_message_idx" ON "direct_message_reactions" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_reply_to_id_direct_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."direct_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_pinned_by_user_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direct_msg_reply_to_idx" ON "direct_messages" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "direct_msg_pinned_idx" ON "direct_messages" USING btree ("conversation_id") WHERE "direct_messages"."pinned_at" is not null;
--> statement-breakpoint
-- Backfill participants from the two columns that used to hold them.
-- `last_read_message_id` is seeded to the newest message in each conversation:
-- history that predates this migration was already seen, and seeding NULL would
-- hand every user an unread badge for their entire archive on first load.
INSERT INTO "conversation_participants"
  ("conversation_id", "user_id", "last_read_message_id", "joined_at")
SELECT
  c."id",
  m."user_id",
  (SELECT MAX(dm."id") FROM "direct_messages" dm WHERE dm."conversation_id" = c."id"),
  c."created_at"
FROM "direct_conversations" c
CROSS JOIN LATERAL (VALUES (c."user_one_id"), (c."user_two_id")) AS m("user_id")
ON CONFLICT ("conversation_id", "user_id") DO NOTHING;
