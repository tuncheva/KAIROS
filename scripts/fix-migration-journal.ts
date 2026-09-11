/**
 * Validate `meta/_journal.json`, and repair the one fault that is safe to repair
 * automatically.
 *
 * ## What goes wrong
 *
 * `drizzle-kit migrate` walks the journal in recorded order and applies an entry
 * only when its `when` is greater than the newest `created_at` already in
 * `__drizzle_migrations` (see `migration.folderMillis` in drizzle-orm's pg
 * dialect). An entry whose `when` is lower than the one before it is therefore
 * skipped — and skipped *in silence*: generate succeeds, the SQL is correct,
 * migrate reports success, and the column is not there.
 *
 * drizzle-kit stamps new entries with `Date.now()`, which is fine in a repo whose
 * history was written in real time. This repo's earlier entries carry hand-set
 * timestamps *ahead* of the wall clock, so a freshly generated entry lands below
 * its predecessor. That fired on five consecutive migrations, which is why this
 * runs as part of `db:generate` rather than living in somebody's memory.
 *
 * ## Why it now checks more than the last entry
 *
 * The original version only compared the final entry against its predecessor.
 * That is enough to catch the fault at the moment it is introduced, but not to
 * notice one already in the file: `0041_phase1_4_features` sat mid-journal with a
 * `when` ~31 days below its predecessor and was skipped by every `migrate` for
 * as long as it existed, while later entries kept the tail monotonic and the
 * check green. Two more faults were invisible for the same reason — a `.sql`
 * file that no journal entry referenced (so it was never applied at all), and
 * `idx` values that had drifted from the filename prefixes, which made
 * drizzle-kit reuse a prefix already on disk and produced two `0020_*` and two
 * `0033_*` migrations.
 *
 * So this validates the whole file: monotonicity across every entry, `idx`
 * uniqueness, the next generated prefix being free, and journal↔directory
 * parity in both directions.
 *
 * ## What it will and will not fix
 *
 * It raises the last entry's `when` when that alone makes the journal monotonic
 * — the fault a fresh `generate` introduces, where the fix is unambiguous.
 * Everything else exits non-zero with an explanation, because the repair depends
 * on which migrations have already reached which database and picking wrong
 * either skips a migration or re-runs one. Reordering an entry means knowing the
 * high-water mark of every deployed database, and this script cannot see them.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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

const MIGRATIONS_DIR = resolve("src/server/db/migrations");
const JOURNAL_PATH = resolve(MIGRATIONS_DIR, "meta/_journal.json");

/** Problems that need a human; the script exits non-zero if any are collected. */
const problems: string[] = [];

function checkMonotonic(entries: JournalEntry[]): void {
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]!;
    const cur = entries[i]!;
    if (cur.when <= prev.when) {
      problems.push(
        `${cur.tag} (when=${String(cur.when)}) is not above ${prev.tag} ` +
          `(when=${String(prev.when)}), so migrate will skip it in silence. ` +
          `Raise it above every prior entry — and above the newest created_at in ` +
          `__drizzle_migrations on each deployed database, or it will be skipped there too.`,
      );
    }
  }
}

function checkIdxUnique(entries: JournalEntry[]): void {
  const seen = new Map<number, string>();
  for (const entry of entries) {
    const first = seen.get(entry.idx);
    if (first !== undefined) {
      problems.push(
        `idx ${String(entry.idx)} is used by both ${first} and ${entry.tag}. ` +
          `drizzle-kit derives generated filenames and embedded-migration import ` +
          `names from idx, so duplicates collide.`,
      );
      continue;
    }
    seen.set(entry.idx, entry.tag);
  }
}

/**
 * drizzle-kit names the next migration from `lastEntry.idx + 1`. When idx has
 * drifted below the highest filename prefix that number is already taken, and
 * the new file lands beside an existing one sharing its prefix.
 */
function checkNextPrefixFree(entries: JournalEntry[], files: string[]): void {
  const last = entries[entries.length - 1];
  if (!last) return;

  const nextPrefix = String(last.idx + 1).padStart(4, "0");
  const clash = files.find((file) => file.startsWith(`${nextPrefix}_`));
  if (clash) {
    problems.push(
      `the next generated migration will be prefixed ${nextPrefix}, but ${clash}.sql ` +
        `already uses it. Raise the last entry's idx above the highest filename prefix.`,
    );
  }
}

function checkParity(entries: JournalEntry[], files: string[]): void {
  const tags = new Set(entries.map((entry) => entry.tag));

  for (const file of files) {
    if (!tags.has(file)) {
      problems.push(
        `${file}.sql is on disk but absent from the journal, so migrate never reads it. ` +
          `Add an entry whose when is above every existing one.`,
      );
    }
  }

  for (const tag of tags) {
    if (!files.includes(tag)) {
      problems.push(`the journal references ${tag} but ${tag}.sql does not exist.`);
    }
  }
}

/**
 * Raise the final entry when it alone is out of order. Returns true if the file
 * was rewritten.
 */
function repairTrailingEntry(journal: Journal): boolean {
  const entries = journal.entries;
  if (entries.length < 2) return false;

  const last = entries[entries.length - 1]!;
  const priorMax = Math.max(...entries.slice(0, -1).map((entry) => entry.when));
  if (last.when > priorMax) return false;

  // Only safe when everything *before* the tail is already in order — otherwise
  // the journal has a fault this script is not allowed to guess at.
  for (let i = 1; i < entries.length - 1; i++) {
    if (entries[i]!.when <= entries[i - 1]!.when) return false;
  }

  // +1000 rather than Date.now(): the point is ordering, not accuracy, and a real
  // clock value would reintroduce the same problem on the next generate.
  const corrected = priorMax + 1000;
  console.warn(
    `[journal] ${last.tag} would have been SKIPPED (when=${String(last.when)} <= ${String(priorMax)})`,
  );
  console.warn(`[journal] raised to ${String(corrected)}`);
  last.when = corrected;
  writeFileSync(JOURNAL_PATH, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  return true;
}

function main(): void {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as Journal;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.slice(0, -".sql".length));

  const repaired = repairTrailingEntry(journal);

  checkMonotonic(journal.entries);
  checkIdxUnique(journal.entries);
  checkNextPrefixFree(journal.entries, files);
  checkParity(journal.entries, files);

  if (problems.length > 0) {
    console.error(`\n[journal] ${String(problems.length)} problem(s) need a human:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\nA migration that is skipped or never read leaves the schema silently behind the code. " +
        "Run `pnpm db:verify` against the database to see what actually landed.\n",
    );
    process.exit(1);
  }

  console.log(
    repaired
      ? `[journal] repaired and verified — ${String(journal.entries.length)} entries, ${String(files.length)} files`
      : `[journal] ok — ${String(journal.entries.length)} entries, ${String(files.length)} files, monotonic`,
  );
}

main();
