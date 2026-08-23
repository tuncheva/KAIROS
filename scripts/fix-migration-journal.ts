/**
 * Keep `meta/_journal.json` timestamps monotonic after a generate.
 *
 * drizzle-kit stamps each new entry with `Date.now()`, which is fine in a repo
 * whose history was written in real time. This repo's earlier entries carry
 * hand-set timestamps that are *ahead* of the wall clock, so every freshly
 * generated entry lands with a `when` lower than the one before it — and
 * `drizzle-kit migrate` walks the journal in recorded order and silently skips
 * anything that looks older than what it has already applied.
 *
 * The failure is invisible in every way that matters: generate succeeds, the SQL
 * file is correct, migrate reports success, and the column is not there. It has
 * fired on every migration added to this project — five for five — which is why
 * this now runs automatically as part of `db:generate` rather than living in
 * somebody's memory.
 *
 * It only ever raises the last entry, and only when it is out of order. A journal
 * that is already monotonic is left untouched.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const JOURNAL_PATH = resolve("src/server/db/migrations/meta/_journal.json");

function main(): void {
  const raw = readFileSync(JOURNAL_PATH, "utf8");
  const journal = JSON.parse(raw) as Journal;
  const entries = journal.entries;

  if (entries.length < 2) {
    console.log("[journal] nothing to check");
    return;
  }

  const last = entries[entries.length - 1]!;
  const priorMax = Math.max(...entries.slice(0, -1).map((e) => e.when));

  if (last.when > priorMax) {
    console.log(`[journal] ok — ${last.tag} is in order`);
    return;
  }

  // +1000 rather than `Date.now()`: the point is ordering, not accuracy, and a
  // real clock value would reintroduce the same problem on the next generate.
  const corrected = priorMax + 1000;

  console.warn(
    `[journal] ${last.tag} would have been SKIPPED (when=${String(last.when)} <= ${String(priorMax)})`,
  );
  console.warn(`[journal] raised to ${String(corrected)}`);

  last.when = corrected;
  writeFileSync(JOURNAL_PATH, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
}

main();
