/**
 * A3 — Notes Vault: draft, confirm and apply changes to a user's notes.
 */

import {
  TRPCError,
} from "@trpc/server";
import {
  and,
  eq,
  inArray,
} from "drizzle-orm";

import { buildBeforeImage } from "~/server/llm/beforeImage";

import type {
  TRPCContext,
} from "~/server/api/trpc";

import {
  NotesVaultDraftSchema,
  type NotesVaultDraft,
  type NotesVaultApplyOutput,
} from "~/server/llm/schemas/a3NotesVaultSchemas";

import {
  buildA3Context,
} from "~/server/llm/context/a3ContextBuilder";

import {
  getA3SystemPrompt,
} from "~/server/llm/prompts/a3Prompts";

import {
  completeJson,
} from "~/server/llm/core/jsonRepair";

import {
  languageAnchorMessages,
} from "~/server/llm/prompts/languageRules";

import {
  stickyNotes,
  agentNotesVaultDrafts,
  agentNotesVaultApplies,
} from "~/server/db/schema";
import {
  createDraftId,
  requireUserId,
  computePlanHash,
  mintConfirmationToken,
  readConfirmationToken,
} from "./shared";
export const a3NotesVault = {
  async notesVaultDraft(input: {
    ctx: TRPCContext;
    message: string;
    handoffContext?: Record<string, unknown>;
    /**
     * The user's own words this turn, when `message` is another agent's
     * paraphrase of them. Used to pin the reply language, nothing else.
     */
    originalMessage?: string;
  }): Promise<{ draftId: string; plan: NotesVaultDraft }> {
    const userId = requireUserId(input.ctx);
    const draftId = createDraftId();

    const contextPack = await buildA3Context({
      ctx: input.ctx,
      handoffContext: input.handoffContext,
    });

    const systemPrompt = getA3SystemPrompt(contextPack);

    const parseResult = await completeJson({
      messages: [
        { role: "system", content: systemPrompt },
        ...languageAnchorMessages(input.originalMessage, input.message),
        { role: "user", content: input.message },
      ],
      schema: NotesVaultDraftSchema,
      temperature: 0.2,
      purpose: "a3.draft",
      userId,
    });

    if (!parseResult.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid A3 plan JSON: ${parseResult.error}`,
      });
    }

    // Server-side guardrails: enforce requiresUnlocked for password-protected notes.
    const lockedIds = new Set(
      contextPack.notes.filter((n) => n.isLocked).map((n) => n.id),
    );

    const guardedPlan: NotesVaultDraft = {
      ...parseResult.data,
      operations: parseResult.data.operations.map((op) => {
        if (op.type !== "update") return op;
        const requiresUnlocked = lockedIds.has(op.noteId) ? true : op.requiresUnlocked;
        return { ...op, requiresUnlocked };
      }),
    };

    const planHash = computePlanHash(guardedPlan);
    const plan: NotesVaultDraft = { ...guardedPlan, planHash };

    await input.ctx.db.insert(agentNotesVaultDrafts).values({
      id: draftId,
      userId,
      message: input.message,
      planJson: JSON.stringify(plan),
      planHash,
      status: "draft",
    });

    return { draftId, plan };
  },

  async notesVaultConfirm(input: {
    ctx: TRPCContext;
    draftId: string;
    edits?: Array<{ index: number; content: string }>;
  }): Promise<{ confirmationToken: string; summary: { creates: number; updates: number; deletes: number; blocked: number } }> {
    const userId = requireUserId(input.ctx);

    const [draft] = await input.ctx.db
      .select({
        id: agentNotesVaultDrafts.id,
        userId: agentNotesVaultDrafts.userId,
        planJson: agentNotesVaultDrafts.planJson,
        planHash: agentNotesVaultDrafts.planHash,
        status: agentNotesVaultDrafts.status,
        confirmationToken: agentNotesVaultDrafts.confirmationToken,
      })
      .from(agentNotesVaultDrafts)
      .where(eq(agentNotesVaultDrafts.id, input.draftId))
      .limit(1);

    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
    if (draft.status === "confirmed") {
      // Idempotent confirm: allow the UI to recover if the user clicks Confirm twice.
      return {
        confirmationToken: draft.confirmationToken ?? mintConfirmationToken({
          userId,
          draftId: draft.id,
          planHash: draft.planHash,
          expiresAt: Date.now() + 10 * 60 * 1000,
        }),
        summary: {
          creates: 0,
          updates: 0,
          deletes: 0,
          blocked: 0,
        },
      };
    }

    if (draft.status !== "draft") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Draft is not confirmable (status=${draft.status})`,
      });
    }

    let plan = NotesVaultDraftSchema.parse(JSON.parse(draft.planJson) as unknown);

    // The hash the confirmation token is minted against. It must match whatever
    // ends up in the `planHash` column, or apply rejects every edited plan.
    let effectivePlanHash = draft.planHash;

    // Apply user edits if provided
    if (input.edits && input.edits.length > 0) {
      const updatedOperations = [...plan.operations];
      for (const edit of input.edits) {
        if (edit.index >= 0 && edit.index < updatedOperations.length) {
          const op = updatedOperations[edit.index];
          if (op?.type === "create") {
            updatedOperations[edit.index] = { ...op, content: edit.content };
          } else if (op?.type === "update") {
            updatedOperations[edit.index] = { ...op, nextContent: edit.content };
          }
          // Don't allow editing delete operations
        }
      }

      // Re-hash exactly the way the draft did: `computePlanHash` over the plan
      // *without* its own `planHash` field, then embed the result. A local
      // `crypto.createHash(JSON.stringify(...)).slice(0, 16)` here produced a
      // value the apply path could never reproduce, and — because the token was
      // still minted from the stale `draft.planHash` below — every edited plan
      // failed apply with "Plan hash mismatch".
      const { planHash: _previous, ...edited } = {
        ...plan,
        operations: updatedOperations,
      };
      effectivePlanHash = computePlanHash(edited);
      plan = { ...edited, planHash: effectivePlanHash };

      // Update the stored draft with edited plan
      await input.ctx.db
        .update(agentNotesVaultDrafts)
        .set({
          planJson: JSON.stringify(plan),
          planHash: effectivePlanHash,
          updatedAt: new Date(),
        })
        .where(eq(agentNotesVaultDrafts.id, draft.id));
    }

    const confirmationToken =
      // A token minted before an edit is bound to the pre-edit hash, so it is
      // only reusable when the plan did not change.
      (input.edits?.length ? null : draft.confirmationToken) ??
      mintConfirmationToken({
        userId,
        draftId: draft.id,
        planHash: effectivePlanHash,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

    await input.ctx.db
      .update(agentNotesVaultDrafts)
      .set({
        status: "confirmed",
        confirmationToken,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentNotesVaultDrafts.id, draft.id));

    const creates = plan.operations.filter((o) => o.type === "create").length;
    const updates = plan.operations.filter((o) => o.type === "update").length;
    const deletes = plan.operations.filter((o) => o.type === "delete").length;

    return {
      confirmationToken,
      summary: {
        creates,
        updates,
        deletes,
        blocked: plan.blocked.length,
      },
    };
  },

  async notesVaultApply(input: {
    ctx: TRPCContext;
    draftId: string;
    confirmationToken: string;
    handoffContext?: Record<string, unknown>;
  }): Promise<NotesVaultApplyOutput> {
    const userId = requireUserId(input.ctx);

    const payload = readConfirmationToken(input.confirmationToken);
    if (payload.userId !== userId || payload.draftId !== input.draftId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Confirmation token does not match user/draft" });
    }
    if (Date.now() > payload.expiresAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmation token expired" });
    }

    const [draft] = await input.ctx.db
      .select({
        id: agentNotesVaultDrafts.id,
        userId: agentNotesVaultDrafts.userId,
        planJson: agentNotesVaultDrafts.planJson,
        planHash: agentNotesVaultDrafts.planHash,
        status: agentNotesVaultDrafts.status,
        confirmationToken: agentNotesVaultDrafts.confirmationToken,
      })
      .from(agentNotesVaultDrafts)
      .where(eq(agentNotesVaultDrafts.id, input.draftId))
      .limit(1);

    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
    if (draft.status !== "confirmed") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Draft is not applicable (status=${draft.status})` });
    }
    if (draft.planHash !== payload.planHash) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Plan hash mismatch" });
    }
    if (draft.confirmationToken !== input.confirmationToken) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmation token mismatch" });
    }

    const plan = NotesVaultDraftSchema.parse(JSON.parse(draft.planJson) as unknown);

    // Apply-time guard: only allow locked-note updates/deletes if the plaintext is present in handoffContext.
    const contextPack = await buildA3Context({ ctx: input.ctx, handoffContext: input.handoffContext });
    const unlockedIds = new Set(
      contextPack.notes.filter((n) => n.isLocked && n.unlockedContent).map((n) => n.id),
    );

    const lockedIds = new Set(contextPack.notes.filter((n) => n.isLocked).map((n) => n.id));

    const createdNoteIds: number[] = [];
    const updatedNoteIds: number[] = [];
    const deletedNoteIds: number[] = [];
    const blockedNoteIds: number[] = [];

    // The notes this plan may change, as they are now — captured before the loop
    // touches any of them, so an edit can be rolled back. See `beforeImage.ts`.
    //
    // Locked notes are read here even though their content is otherwise withheld:
    // the plan can only reach one that the user unlocked for this turn, and a
    // rollback that skipped locked notes would restore some of a plan and not the
    // rest without saying so. The image lives on an apply row the owner alone can
    // read, and is culled with it.
    const touchedNoteIds = [
      ...new Set(
        plan.operations
          .filter((op) => op.type === "update" || op.type === "delete")
          .map((op) => (op as { noteId: number }).noteId),
      ),
    ];

    const beforeNotes = touchedNoteIds.length
      ? await input.ctx.db
          .select({
            id: stickyNotes.id,
            title: stickyNotes.title,
            content: stickyNotes.content,
          })
          .from(stickyNotes)
          .where(
            and(
              inArray(stickyNotes.id, touchedNoteIds),
              eq(stickyNotes.createdById, userId),
            ),
          )
      : [];

    const beforeImage = buildBeforeImage({ notes: beforeNotes });

    for (const op of plan.operations) {
      if (op.type === "create") {
        const inserted = await input.ctx.db
          .insert(stickyNotes)
          .values({
            content: op.content,
            createdById: userId,
            shareStatus: "private",
          })
          .returning({ id: stickyNotes.id });
        if (inserted[0]?.id) createdNoteIds.push(inserted[0].id);
        continue;
      }

      if (op.type === "update") {
        if (op.requiresUnlocked && !unlockedIds.has(op.noteId)) {
          blockedNoteIds.push(op.noteId);
          continue;
        }

        await input.ctx.db
          .update(stickyNotes)
          .set({ content: op.nextContent })
          .where(and(eq(stickyNotes.id, op.noteId), eq(stickyNotes.createdById, userId)));
        updatedNoteIds.push(op.noteId);
        continue;
      }

      if (op.type === "delete") {
        if (!op.dangerous) {
          blockedNoteIds.push(op.noteId);
          continue;
        }

        // Require unlocked handoff content for locked note deletes.
        if (lockedIds.has(op.noteId) && !unlockedIds.has(op.noteId)) {
          blockedNoteIds.push(op.noteId);
          continue;
        }

        await input.ctx.db
          .delete(stickyNotes)
          .where(and(eq(stickyNotes.id, op.noteId), eq(stickyNotes.createdById, userId)));
        deletedNoteIds.push(op.noteId);
      }
    }

    await input.ctx.db
      .insert(agentNotesVaultApplies)
      .values({
        draftId: draft.id,
        userId,
        planHash: draft.planHash,
        resultJson: JSON.stringify({ createdNoteIds, updatedNoteIds, deletedNoteIds, blockedNoteIds }),
        beforeJson: JSON.stringify(beforeImage),
      });

    await input.ctx.db
      .update(agentNotesVaultDrafts)
      .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentNotesVaultDrafts.id, draft.id));

    return {
      applied: true as const,
      results: { createdNoteIds, updatedNoteIds, deletedNoteIds, blockedNoteIds },
    };
  },

  // ---------------------------------------------------------------------------
  // A2 Task Planner API
  // ---------------------------------------------------------------------------
};
