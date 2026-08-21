-- GIN indexes backing `searchWorkspace` (src/server/llm/tools/a1/searchTools.ts).
--
-- Kept out of the Drizzle schema on purpose: these are expression indexes over
-- `to_tsvector`, drizzle-kit renders them inconsistently across versions, and a
-- push that silently drops one would turn every agent search into a sequential
-- scan with nothing to show for it. The search query is *correct* without them;
-- these only make it fast.
--
-- The configuration is `simple`, not `english`. KAIROS ships five locales and
-- notes are routinely written in Bulgarian — English stemming would degrade
-- every other language, and the index must use the same configuration as the
-- query or the planner will not use it at all.
--
-- Run once per environment:
--   psql "$DATABASE_DIRECT_URL" -f scripts/sql/search-indexes.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_fts_idx
  ON tasks
  USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS projects_fts_idx
  ON projects
  USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS sticky_notes_fts_idx
  ON sticky_notes
  USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS event_fts_idx
  ON event
  USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS task_comments_fts_idx
  ON task_comments
  USING gin (to_tsvector('simple', coalesce(content, '')));

-- The ILIKE arm of the search cannot use the GIN indexes above. pg_trgm covers
-- it, and is what makes prefix queries ("paym") fast rather than merely correct.
-- Optional: skip this block if the extension is unavailable on your host.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_title_trgm_idx
  ON tasks USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS projects_title_trgm_idx
  ON projects USING gin (title gin_trgm_ops);
