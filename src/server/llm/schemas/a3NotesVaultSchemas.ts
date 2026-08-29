import { z } from "zod";

import { plainString } from "~/server/llm/core/plainText";

export const NotesVaultOperationCreateSchema = z
  .object({
    type: z.literal("create"),
    content: z.string().min(1).max(20_000),
    reason: plainString(z.string().max(500)).optional(),
  })
  // Use strip() instead of strict() — LLMs sometimes add extra keys
  .strip();

export const NotesVaultOperationUpdateSchema = z
  .object({
    type: z.literal("update"),
    noteId: z.number().int().positive(),
    nextContent: z.string().min(1).max(20_000),
    reason: plainString(z.string().max(500)).optional(),
    /**
     * Must be true when the target note is password-protected.
     * Enforced server-side at draft validation time.
     */
    requiresUnlocked: z.boolean(),
  })
  .strip();

export const NotesVaultOperationDeleteSchema = z
  .object({
    type: z.literal("delete"),
    noteId: z.number().int().positive(),
    reason: plainString(z.string().min(1).max(500)),
    /** Must be true for deletes to be considered at all */
    dangerous: z.literal(true),
  })
  .strip();

export const NotesVaultOperationSchema = z.discriminatedUnion("type", [
  NotesVaultOperationCreateSchema,
  NotesVaultOperationUpdateSchema,
  NotesVaultOperationDeleteSchema,
]);

export const NotesVaultDraftSchema = z
  .object({
    agentId: z.literal("notes_vault"),
    operations: z.array(NotesVaultOperationSchema).max(50).default([]),
    blocked: z
      .array(
        z
          .object({
            noteId: z.number().int().positive(),
            reason: plainString(z.string().min(1).max(500)),
          })
          .strip(),
      )
      .max(50)
      .default([]),
    summary: plainString(z.string().min(1).max(2000)),
    /** Computed server-side from normalized plan JSON; model may omit */
    planHash: z.string().min(8).max(128).optional(),
  })
  .strip();

export type NotesVaultDraft = z.infer<typeof NotesVaultDraftSchema>;

// ---------------------------------------------------------------------------
// A3 API shapes (tRPC)
// ---------------------------------------------------------------------------

export const NotesVaultDraftInputSchema = z
  .object({
    message: z.string().min(1).max(20_000),
    handoffContext: z.record(z.unknown()).optional(),
  })
  .strict();

export const NotesVaultDraftOutputSchema = z
  .object({
    draftId: z.string().min(1),
    plan: NotesVaultDraftSchema,
  })
  .strict();

export type NotesVaultDraftInput = z.infer<typeof NotesVaultDraftInputSchema>;
export type NotesVaultDraftOutput = z.infer<typeof NotesVaultDraftOutputSchema>;

export const NotesVaultConfirmInputSchema = z
  .object({
    draftId: z.string().min(1),
    /** Optional user edits to override draft content before confirming */
    edits: z.array(z.object({
      index: z.number().int().min(0),
      content: z.string().min(1).max(20_000),
    })).optional(),
  })
  .strict();

export const NotesVaultConfirmOutputSchema = z
  .object({
    confirmationToken: z.string().min(1),
    summary: z
      .object({
        creates: z.number().int().min(0),
        updates: z.number().int().min(0),
        deletes: z.number().int().min(0),
        blocked: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export type NotesVaultConfirmInput = z.infer<typeof NotesVaultConfirmInputSchema>;
export type NotesVaultConfirmOutput = z.infer<typeof NotesVaultConfirmOutputSchema>;

export const NotesVaultApplyInputSchema = z
  .object({
    draftId: z.string().min(1),
    confirmationToken: z.string().min(1),
    handoffContext: z.record(z.unknown()).optional(),
  })
  .strict();

export const NotesVaultApplyOutputSchema = z
  .object({
    applied: z.literal(true),
    results: z
      .object({
        createdNoteIds: z.array(z.number().int().positive()),
        updatedNoteIds: z.array(z.number().int().positive()),
        deletedNoteIds: z.array(z.number().int().positive()),
        blockedNoteIds: z.array(z.number().int().positive()),
      })
      .strict(),
  })
  .strict();

export type NotesVaultApplyInput = z.infer<typeof NotesVaultApplyInputSchema>;
export type NotesVaultApplyOutput = z.infer<typeof NotesVaultApplyOutputSchema>;
