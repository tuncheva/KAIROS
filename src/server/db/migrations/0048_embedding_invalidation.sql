-- Clear an embedding when the text it was computed from changes.
--
-- Tasks and notes are written from the routers, the agents, the undo log and the
-- reminder sweep. Rather than have each write path remember to re-embed, the
-- database decides: any UPDATE that changes the embedded text sets `embedding`
-- to NULL, and ~/server/llm/core/embedPending.ts drains NULL rows on the
-- scheduled tick. A stale vector — one describing text the row no longer has —
-- therefore cannot survive an edit, whichever code made it.
--
-- Notes also lose their embedding when locked (`password_hash` changes): a
-- locked note's content is encrypted, and a vector of the plaintext outliving
-- the lock would leak what the lock hides. The sweep never embeds locked notes.
--
-- Nothing here writes data. `CREATE OR REPLACE` and `DROP TRIGGER IF EXISTS`
-- make the migration safe to re-run.

CREATE OR REPLACE FUNCTION "kairos_task_embedding_invalidate"() RETURNS trigger AS $$
BEGIN
  IF NEW."title" IS DISTINCT FROM OLD."title"
     OR NEW."description" IS DISTINCT FROM OLD."description" THEN
    NEW."embedding" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "task_embedding_invalidate" ON "tasks";
--> statement-breakpoint
CREATE TRIGGER "task_embedding_invalidate"
  BEFORE UPDATE OF "title", "description" ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "kairos_task_embedding_invalidate"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "kairos_note_embedding_invalidate"() RETURNS trigger AS $$
BEGIN
  IF NEW."title" IS DISTINCT FROM OLD."title"
     OR NEW."content" IS DISTINCT FROM OLD."content"
     OR NEW."password_hash" IS DISTINCT FROM OLD."password_hash" THEN
    NEW."embedding" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "note_embedding_invalidate" ON "sticky_notes";
--> statement-breakpoint
CREATE TRIGGER "note_embedding_invalidate"
  BEFORE UPDATE OF "title", "content", "password_hash" ON "sticky_notes"
  FOR EACH ROW EXECUTE FUNCTION "kairos_note_embedding_invalidate"();
