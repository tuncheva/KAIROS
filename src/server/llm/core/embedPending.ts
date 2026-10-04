/**
 * Fill in missing embeddings for tasks, notes and document chunks.
 *
 * ## Why a sweep rather than a hook on every write
 *
 * Tasks and notes are written from two routers, two agents, the undo log and the
 * reminder sweep — more than twenty call sites. Hooking each one would leave the
 * next write path to forget. Instead the database owns invalidation: migration
 * 0048_embedding_invalidation adds triggers that set `embedding` to NULL
 * whenever the embedded text changes. "Needs an embedding" is then simply
 * `embedding IS NULL`, whichever code path made it so, and this sweep drains it
 * on the scheduled tick. Search stays correct in the gap because it fuses
 * vector hits with keyword hits (see ~/server/llm/core/rankFusion.ts), and the
 * keyword arm sees a row the moment it is written.
 *
 * ## Why the UPDATE re-checks the text
 *
 * A user can edit a row between the SELECT and the UPDATE. The trigger nulls the
 * embedding, and without a guard the sweep would then write the vector of the
 * old text over it — a stale embedding that nothing would ever revisit. So the
 * write only lands if the text is still what was embedded.
 *
 * ## What is never embedded
 *
 * Locked notes. Their content is encrypted at rest, and embedding it would mean
 * sending the plaintext to a third party — or, for the ciphertext, storing a
 * vector of noise. The trigger also clears the embedding when a note is locked,
 * so one made while it was open does not outlive the lock.
 */
import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { documentChunks, documents, stickyNotes, tasks } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import { embedTexts, isEmbeddingConfigured, serializeEmbedding } from "./embeddings";

const log = createLogger("llm.embedPending");

/** Inputs per embedding request. Small enough for free-tier request-size limits. */
const BATCH_SIZE = 32;

/** Rows embedded per scheduled tick, across all kinds. Bounds a tick's API spend. */
const DEFAULT_MAX_ROWS = 256;

export interface EmbedPendingReport {
  tasks: number;
  notes: number;
  chunks: number;
  /** Set when a request failed and the sweep stopped early; the rest waits for the next run. */
  stoppedEarly?: true;
  /** Set when no embedding provider is configured; nothing was attempted. */
  skipped?: "not-configured";
}

/** What a task is embedded as. Mirrors the keyword arm's `title || description`. */
export function taskEmbeddingInput(t: { title: string; description: string | null }): string {
  return t.description ? `${t.title}\n\n${t.description}` : t.title;
}

/** What a note is embedded as. */
export function noteEmbeddingInput(n: { title: string | null; content: string }): string {
  return n.title ? `${n.title}\n\n${n.content}` : n.content;
}

/**
 * Embed a kind's pending rows in batches until `budget` runs out or none remain.
 * Returns rows written and budget spent, or null if a request failed.
 */
async function drain<T>(
  budget: number,
  pending: (limit: number) => Promise<T[]>,
  toInput: (row: T) => string,
  write: (row: T, vector: string) => Promise<boolean>,
): Promise<{ written: number; spent: number } | null> {
  let written = 0;
  let spent = 0;

  while (spent < budget) {
    const rows = await pending(Math.min(BATCH_SIZE, budget - spent));
    if (rows.length === 0) break;

    const vectors = await embedTexts(rows.map(toInput), "passage");
    if (!vectors) return null;
    spent += rows.length;

    let batchWritten = 0;
    for (const [i, row] of rows.entries()) {
      if (await write(row, serializeEmbedding(vectors[i]!))) batchWritten++;
    }
    written += batchWritten;
    // Every row lost its race with an edit. Their new text is picked up next run;
    // looping now could spin on a row being edited continuously.
    if (batchWritten === 0) break;
  }

  return { written, spent };
}

async function pendingTasks(limit: number) {
  return db
    .select({ id: tasks.id, title: tasks.title, description: tasks.description })
    .from(tasks)
    .where(sql`"tasks"."embedding" IS NULL`)
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);
}

async function writeTask(
  row: { id: number; title: string; description: string | null },
  vector: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE "tasks" SET "embedding" = ${vector}::halfvec
    WHERE "id" = ${row.id}
      AND "embedding" IS NULL
      AND "title" = ${row.title}
      AND "description" IS NOT DISTINCT FROM ${row.description}
  `);
  return result.count > 0;
}

async function pendingNotes(limit: number) {
  return db
    .select({ id: stickyNotes.id, title: stickyNotes.title, content: stickyNotes.content })
    .from(stickyNotes)
    .where(
      and(
        sql`"sticky_notes"."embedding" IS NULL`,
        isNull(stickyNotes.passwordHash),
        // A blank note has nothing to embed, and selecting it would pin it at the
        // head of every sweep.
        sql`btrim(coalesce(${stickyNotes.title}, '') || ${stickyNotes.content}) <> ''`,
      ),
    )
    .orderBy(desc(stickyNotes.updatedAt))
    .limit(limit);
}

async function writeNote(
  row: { id: number; title: string | null; content: string },
  vector: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE "sticky_notes" SET "embedding" = ${vector}::halfvec
    WHERE "id" = ${row.id}
      AND "embedding" IS NULL
      AND "password_hash" IS NULL
      AND "title" IS NOT DISTINCT FROM ${row.title}
      AND "content" = ${row.content}
  `);
  return result.count > 0;
}

/**
 * Chunks are immutable once written — a re-index deletes and re-inserts them —
 * so they need no text guard. This covers documents uploaded before a provider
 * was configured, and ingests whose fire-and-forget embedding call failed.
 */
async function pendingChunks(limit: number) {
  return db
    .select({ id: documentChunks.id, content: documentChunks.content })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(and(sql`"document_chunks"."embedding" IS NULL`, eq(documents.status, "ready")))
    .orderBy(desc(documentChunks.id))
    .limit(limit);
}

async function writeChunk(row: { id: number }, vector: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE "document_chunks" SET "embedding" = ${vector}::halfvec
    WHERE "id" = ${row.id} AND "embedding" IS NULL
  `);
  return result.count > 0;
}

/**
 * Embed up to `maxRows` rows that have no embedding, newest first.
 *
 * Stops at the first failed request rather than pressing on: a failure is almost
 * always the provider (rate limit, outage, bad key), and every further request
 * in the same tick would fail the same way while spending quota.
 */
export async function embedPending(
  { maxRows = DEFAULT_MAX_ROWS }: { maxRows?: number } = {},
): Promise<EmbedPendingReport> {
  const report: EmbedPendingReport = { tasks: 0, notes: 0, chunks: 0 };
  if (!isEmbeddingConfigured()) return { ...report, skipped: "not-configured" };

  let budget = maxRows;

  const runs = [
    ["tasks", () => drain(budget, pendingTasks, taskEmbeddingInput, writeTask)],
    ["notes", () => drain(budget, pendingNotes, noteEmbeddingInput, writeNote)],
    ["chunks", () => drain(budget, pendingChunks, (c) => c.content, writeChunk)],
  ] as const;

  for (const [key, run] of runs) {
    if (budget <= 0) break;
    const result = await run();
    if (!result) {
      log.warn("embedding sweep stopped early", { kind: key, ...report });
      return { ...report, stoppedEarly: true };
    }
    report[key] = result.written;
    budget -= result.spent;
  }

  if (report.tasks || report.notes || report.chunks) log.info("embedded pending rows", { ...report });
  return report;
}
