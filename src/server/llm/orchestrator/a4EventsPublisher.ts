/**
 * A4 — Events Publisher: draft, confirm and apply event changes.
 */

import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";

import {
  EventsPublisherDraftSchema,
  type EventsPublisherDraft,
  type EventsPublisherApplyOutput,
} from "~/server/llm/schemas/a4EventsPublisherSchemas";

import { buildA4Context } from "~/server/llm/context/a4ContextBuilder";

import { getA4SystemPrompt } from "~/server/llm/prompts/a4Prompts";
import { completeJson } from "~/server/llm/core/jsonRepair";

import { languageAnchorMessages } from "~/server/llm/prompts/languageRules";

import {
  events as eventsTable,
  eventComments,
  eventLikes,
  eventRsvps,
  agentEventsPublisherDrafts,
  agentEventsPublisherApplies,
} from "~/server/db/schema";
import {
  createDraftId,
  requireUserId,
  computePlanHash,
  mintConfirmationToken,
  readConfirmationToken,
} from "./shared";

/**
 * Load a draft and assert it belongs to the caller.
 *
 * Drafts used to live in a module-level `Map`, so they vanished on restart and
 * were invisible to every other instance. They are rows now, like A2's and A3's.
 */
async function loadDraft(ctx: TRPCContext, draftId: string, userId: string) {
  const [draft] = await ctx.db
    .select({
      id: agentEventsPublisherDrafts.id,
      userId: agentEventsPublisherDrafts.userId,
      planJson: agentEventsPublisherDrafts.planJson,
      planHash: agentEventsPublisherDrafts.planHash,
      status: agentEventsPublisherDrafts.status,
      confirmationToken: agentEventsPublisherDrafts.confirmationToken,
    })
    .from(agentEventsPublisherDrafts)
    .where(eq(agentEventsPublisherDrafts.id, draftId))
    .limit(1);

  if (!draft)
    throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
  if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
  return draft;
}

/** Hash a plan the same way `notesVaultDraft` does: over the plan minus its own hash. */
function hashPlan(plan: EventsPublisherDraft): string {
  const { planHash: _embedded, ...rest } = plan;
  return computePlanHash(rest);
}

export const a4EventsPublisher = {
  async eventsPublisherDraft(input: {
    ctx: TRPCContext;
    message: string;
    handoffContext?: Record<string, unknown>;
    /**
     * The user's own words this turn, when `message` is another agent's
     * paraphrase of them. Used to pin the reply language, nothing else.
     */
    originalMessage?: string;
  }): Promise<{ draftId: string; plan: EventsPublisherDraft }> {
    const userId = requireUserId(input.ctx);
    const draftId = createDraftId();

    const contextPack = await buildA4Context({ ctx: input.ctx });
    const systemPrompt = getA4SystemPrompt(
      contextPack,
      input.originalMessage,
      input.message,
    );

    const parseResult = await completeJson({
      messages: [
        { role: "system", content: systemPrompt },
        ...languageAnchorMessages(input.originalMessage, input.message),
        { role: "user", content: input.message },
      ],
      schema: EventsPublisherDraftSchema,
      temperature: 0.2,
      purpose: "a4.draft",
      userId,
    });

    if (!parseResult.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid A4 plan JSON: ${parseResult.error}`,
      });
    }

    // Server-side guardrail: only allow deletes for events the user owns
    const ownedEventIds = new Set(
      contextPack.events.filter((e) => e.isOwner).map((e) => e.id),
    );
    const guardedPlan: EventsPublisherDraft = {
      ...parseResult.data,
      deletes: parseResult.data.deletes.filter((d) =>
        ownedEventIds.has(d.eventId),
      ),
      updates: parseResult.data.updates.filter((u) =>
        ownedEventIds.has(u.eventId),
      ),
    };

    const planHash = hashPlan(guardedPlan);
    const plan: EventsPublisherDraft = { ...guardedPlan, planHash };

    await input.ctx.db.insert(agentEventsPublisherDrafts).values({
      id: draftId,
      userId,
      message: input.message,
      planJson: JSON.stringify(plan),
      planHash,
      status: "draft",
    });

    return { draftId, plan };
  },

  async eventsPublisherConfirm(input: {
    ctx: TRPCContext;
    draftId: string;
    edits?: Array<{ index: number; title?: string; description?: string }>;
  }): Promise<{
    confirmationToken: string;
    summary: {
      creates: number;
      updates: number;
      deletes: number;
      commentsAdded: number;
      commentsRemoved: number;
      rsvps: number;
      likes: number;
    };
  }> {
    const userId = requireUserId(input.ctx);
    const draft = await loadDraft(input.ctx, input.draftId, userId);

    if (draft.status === "applied" || draft.status === "expired") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Draft is not confirmable (status=${draft.status})`,
      });
    }

    let plan = EventsPublisherDraftSchema.parse(
      JSON.parse(draft.planJson) as unknown,
    );

    // Apply user edits if provided
    if (input.edits && input.edits.length > 0) {
      // Combine creates and updates into a single list for indexing
      // (creates come first, then updates)
      const editableItems = [...plan.creates, ...plan.updates];
      const updatedCreates = [...plan.creates];
      const updatedUpdates = [...plan.updates];

      for (const edit of input.edits) {
        if (edit.index >= 0 && edit.index < plan.creates.length) {
          // Edit a create item
          const existing = updatedCreates[edit.index];
          if (existing) {
            updatedCreates[edit.index] = {
              ...existing,
              ...(edit.title && { title: edit.title }),
              ...(edit.description && { description: edit.description }),
            };
          }
        } else if (
          edit.index >= plan.creates.length &&
          edit.index < editableItems.length
        ) {
          // Edit an update item
          const updateIdx = edit.index - plan.creates.length;
          const existing = updatedUpdates[updateIdx];
          if (existing) {
            updatedUpdates[updateIdx] = {
              ...existing,
              patch: {
                ...existing.patch,
                ...(edit.title && { title: edit.title }),
                ...(edit.description && { description: edit.description }),
              },
            };
          }
        }
      }

      plan = { ...plan, creates: updatedCreates, updates: updatedUpdates };
    }

    // Recomputed after edits so the token, the stored row and the plan always
    // agree — apply compares all three and refuses on any divergence.
    const planHash = hashPlan(plan);
    plan = { ...plan, planHash };

    const token = mintConfirmationToken({
      userId,
      draftId: input.draftId,
      planHash,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    await input.ctx.db
      .update(agentEventsPublisherDrafts)
      .set({
        planJson: JSON.stringify(plan),
        planHash,
        status: "confirmed",
        confirmationToken: token,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentEventsPublisherDrafts.id, input.draftId));

    return {
      confirmationToken: token,
      summary: {
        creates: plan.creates.length,
        updates: plan.updates.length,
        deletes: plan.deletes.length,
        commentsAdded: plan.comments.add.length,
        commentsRemoved: plan.comments.remove.length,
        rsvps: plan.rsvps.length,
        likes: plan.likes.length,
      },
    };
  },

  async eventsPublisherApply(input: {
    ctx: TRPCContext;
    draftId: string;
    confirmationToken: string;
  }): Promise<EventsPublisherApplyOutput> {
    const userId = requireUserId(input.ctx);
    const tokenPayload = readConfirmationToken(input.confirmationToken);

    if (tokenPayload.userId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Token user mismatch",
      });
    }
    if (tokenPayload.draftId !== input.draftId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Token/draft mismatch",
      });
    }
    if (Date.now() > tokenPayload.expiresAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Confirmation token expired",
      });
    }

    const draft = await loadDraft(input.ctx, input.draftId, userId);
    if (draft.status !== "confirmed") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Draft is not applicable (status=${draft.status})`,
      });
    }
    if (draft.planHash !== tokenPayload.planHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Plan was modified after confirmation",
      });
    }
    if (draft.confirmationToken !== input.confirmationToken) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Confirmation token mismatch",
      });
    }

    const plan = EventsPublisherDraftSchema.parse(
      JSON.parse(draft.planJson) as unknown,
    );
    if (hashPlan(plan) !== draft.planHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Plan was modified after confirmation",
      });
    }

    const results: EventsPublisherApplyOutput["results"] = {
      createdEventIds: [],
      updatedEventIds: [],
      deletedEventIds: [],
      commentsAdded: 0,
      commentsRemoved: 0,
      rsvpsSet: 0,
      likesToggled: 0,
    };

    const db = input.ctx.db;

    // Creates
    for (const create of plan.creates) {
      const [inserted] = await db
        .insert(eventsTable)
        .values({
          title: create.title,
          description: create.description,
          eventDate: new Date(create.eventDate),
          region: create.region,
          enableRsvp: create.enableRsvp,
          sendReminders: create.sendReminders,
          imageUrl: create.imageUrl ?? null,
          createdById: userId,
        })
        .returning({ id: eventsTable.id });
      if (inserted) results.createdEventIds.push(inserted.id);
    }

    // Updates
    //
    // Every mutation below is scoped by `createdById` as well as by id. Draft
    // time filtered these against the 30-event context pack, but that is a
    // relevance filter, not an authorization boundary: it runs before the plan
    // round-trips through storage, and it only ever saw a slice of the table.
    // A2 re-checks permissions at apply time for the same reason.
    for (const update of plan.updates) {
      const patched = await db
        .update(eventsTable)
        .set({
          ...(update.patch.title !== undefined && {
            title: update.patch.title,
          }),
          ...(update.patch.description !== undefined && {
            description: update.patch.description,
          }),
          ...(update.patch.eventDate !== undefined && {
            eventDate: new Date(update.patch.eventDate),
          }),
          ...(update.patch.region !== undefined && {
            region: update.patch.region,
          }),
          ...(update.patch.enableRsvp !== undefined && {
            enableRsvp: update.patch.enableRsvp,
          }),
          ...(update.patch.sendReminders !== undefined && {
            sendReminders: update.patch.sendReminders,
          }),
        })
        .where(
          and(
            eq(eventsTable.id, update.eventId),
            eq(eventsTable.createdById, userId),
          ),
        )
        .returning({ id: eventsTable.id });
      if (patched[0]) results.updatedEventIds.push(update.eventId);
    }

    // Deletes
    for (const del of plan.deletes) {
      const removed = await db
        .delete(eventsTable)
        .where(
          and(
            eq(eventsTable.id, del.eventId),
            eq(eventsTable.createdById, userId),
          ),
        )
        .returning({ id: eventsTable.id });
      if (removed[0]) results.deletedEventIds.push(del.eventId);
    }

    // Comments add
    for (const comment of plan.comments.add) {
      await db.insert(eventComments).values({
        eventId: comment.eventId,
        text: comment.text,
        createdById: userId,
      });
      results.commentsAdded++;
    }

    // Comments remove
    //
    // Scoped to the caller's own comments. Deleting by id alone let any user
    // remove anybody's comment simply by naming its id — the model was never
    // required to justify the target, and nothing downstream checked.
    for (const comment of plan.comments.remove) {
      const removed = await db
        .delete(eventComments)
        .where(
          and(
            eq(eventComments.id, comment.commentId),
            eq(eventComments.createdById, userId),
          ),
        )
        .returning({ id: eventComments.id });
      if (removed[0]) results.commentsRemoved++;
    }

    // RSVPs
    for (const rsvp of plan.rsvps) {
      // Upsert: delete existing then insert
      await db
        .delete(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, rsvp.eventId),
            eq(eventRsvps.userId, userId),
          ),
        );
      await db.insert(eventRsvps).values({
        eventId: rsvp.eventId,
        status: rsvp.status,
        userId: userId,
      });
      results.rsvpsSet++;
    }

    // Likes
    for (const like of plan.likes) {
      const existing = await db.query.eventLikes.findFirst({
        where: and(
          eq(eventLikes.eventId, like.eventId),
          eq(eventLikes.createdById, userId),
        ),
      });
      if (existing) {
        await db
          .delete(eventLikes)
          .where(
            and(
              eq(eventLikes.eventId, like.eventId),
              eq(eventLikes.createdById, userId),
            ),
          );
      } else {
        await db.insert(eventLikes).values({
          eventId: like.eventId,
          createdById: userId,
        });
      }
      results.likesToggled++;
    }

    await db.insert(agentEventsPublisherApplies).values({
      draftId: draft.id,
      userId,
      planHash: draft.planHash,
      resultJson: JSON.stringify(results),
    });

    await db
      .update(agentEventsPublisherDrafts)
      .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentEventsPublisherDrafts.id, draft.id));

    return { applied: true as const, results };
  },
};
