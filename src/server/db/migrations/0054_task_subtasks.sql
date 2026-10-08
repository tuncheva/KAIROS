-- Subtasks.
--
-- Additive only: a nullable self-reference, so every existing task stays a
-- top-level task. One level deep is enforced in the task router, not here.
-- Deleting a parent deletes its subtasks.

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_task_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_parent_idx" ON "tasks" USING btree ("parent_task_id");
