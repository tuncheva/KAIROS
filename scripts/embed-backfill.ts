/**
 * Embed every task, note and document chunk that has no embedding yet.
 *
 * Usage:
 *   pnpm db:embed
 *
 * The scheduled tick does the same work 256 rows at a time; this drains the
 * whole backlog in one go — after first configuring `LLM_EMBEDDING_MODEL`, or
 * after changing the model, which needs every existing vector cleared first
 * (vectors from two models are not comparable, and nothing records which model
 * made a row's vector):
 *
 *   UPDATE tasks SET embedding = NULL;
 *   UPDATE sticky_notes SET embedding = NULL;
 *   UPDATE document_chunks SET embedding = NULL;
 *
 * Safe to interrupt and re-run: it only ever fills NULLs. Stops at the first
 * failed request — usually a rate limit — and says so; run it again later.
 *
 * Runs with the `react-server` export condition so the app's `server-only`
 * modules resolve to their no-op build outside Next.js.
 */

import { embedPending } from "../src/server/llm/core/embedPending";

const ROWS_PER_ROUND = 512;

async function main(): Promise<void> {
  const total = { tasks: 0, notes: 0, chunks: 0 };

  for (;;) {
    const report = await embedPending({ maxRows: ROWS_PER_ROUND });

    if (report.skipped === "not-configured") {
      console.error("LLM_EMBEDDING_MODEL is not set (or no base URL / key resolves). Nothing to do.");
      process.exitCode = 1;
      return;
    }

    total.tasks += report.tasks;
    total.notes += report.notes;
    total.chunks += report.chunks;
    console.log(`round   tasks +${report.tasks}  notes +${report.notes}  chunks +${report.chunks}`);

    if (report.stoppedEarly) {
      console.error("An embedding request failed; stopping. Re-run later to continue.");
      process.exitCode = 1;
      break;
    }
    if (report.tasks + report.notes + report.chunks === 0) break;
  }

  console.log(`total   tasks ${total.tasks}  notes ${total.notes}  chunks ${total.chunks}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  // The postgres client holds the event loop open.
  .finally(() => process.exit());
