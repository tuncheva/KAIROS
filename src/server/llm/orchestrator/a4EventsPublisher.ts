/**
 * A4 — Events Publisher: draft, confirm and apply event changes.
 */

import {
  TRPCError,
} from "@trpc/server";
import {
  eq,
  and,
} from "drizzle-orm";

import type {
  TRPCContext,
} from "~/server/api/trpc";

import {
  EventsPublisherDraftSchema,
  type EventsPublisherDraft,
  type EventsPublisherApplyOutput,
} from "~/server/llm/schemas/a4EventsPublisherSchemas";

import {
  buildA4Context,
} from "~/server/llm/context/a4ContextBuilder";

import {
  getA4SystemPrompt,
} from "~/server/llm/prompts/a4Prompts";
import {
  chatCompletion,
} from "~/server/llm/core/modelClient";
import {
  parseAndValidate,
} from "~/server/llm/core/jsonRepair";

import {
  events as eventsTable,
  eventComments,
  eventLikes,
  eventRsvps,
} from "~/server/db/schema";
import {
  createDraftId,
  requireUserId,
  computePlanHash,
  mintConfirmationToken,
  readConfirmationToken,
} from "./shared";
/**
 * In-memory draft store for A4.
 *
 * Unlike the task planner, event drafts are not persisted — they live only until
 * confirm/apply, so a process restart discards them. Moved here with the agent that
 * owns it; nothing else ever read it.
 */
const a4DraftStore = new Map<
  string,
  { userId: string; plan: EventsPublisherDraft }
>();

export const a4EventsPublisher = {
  async eventsPublisherDraft(input: {
    ctx: TRPCContext;
    message: string;
    handoffContext?: Record<string, unknown>;
  }): Promise<{ draftId: string; plan: EventsPublisherDraft }> {
    const userId = requireUserId(input.ctx);
    const draftId = createDraftId();

    const contextPack = await buildA4Context({ ctx: input.ctx });
    const systemPrompt = getA4SystemPrompt(contextPack);

    const llmResponse = await chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.message },
      ],
      temperature: 0.2,
      jsonMode: true,
    });

    const parseResult = await parseAndValidate(
      llmResponse.content,
      EventsPublisherDraftSchema,
    );
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

    guardedPlan.planHash = computePlanHash(guardedPlan);

    // Persist draft in memory (could be DB-backed like A2/A3)
    a4DraftStore.set(draftId, { userId, plan: guardedPlan });

    return { draftId, plan: guardedPlan };
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
    const stored = a4DraftStore.get(input.draftId);
    if (stored?.userId !== userId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    }

    let plan = stored.plan;

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
        } else if (edit.index >= plan.creates.length && edit.index < editableItems.length) {
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
      // Update stored plan
      a4DraftStore.set(input.draftId, { ...stored, plan });
    }

    const planHash = computePlanHash(plan);
    const token = mintConfirmationToken({
      userId,
      draftId: input.draftId,
      planHash,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

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
      throw new TRPCError({ code: "FORBIDDEN", message: "Token user mismatch" });
    }
    if (tokenPayload.draftId !== input.draftId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Token/draft mismatch" });
    }
    if (Date.now() > tokenPayload.expiresAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmation token expired" });
    }

    const stored = a4DraftStore.get(input.draftId);
    if (stored?.userId !== userId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
    }

    const plan = stored.plan;
    const currentHash = computePlanHash(plan);
    if (currentHash !== tokenPayload.planHash) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Plan was modified after confirmation" });
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
    for (const update of plan.updates) {
      await db
        .update(eventsTable)
        .set({
          ...(update.patch.title !== undefined && { title: update.patch.title }),
          ...(update.patch.description !== undefined && { description: update.patch.description }),
          ...(update.patch.eventDate !== undefined && { eventDate: new Date(update.patch.eventDate) }),
          ...(update.patch.region !== undefined && { region: update.patch.region }),
          ...(update.patch.enableRsvp !== undefined && { enableRsvp: update.patch.enableRsvp }),
          ...(update.patch.sendReminders !== undefined && { sendReminders: update.patch.sendReminders }),
        })
        .where(eq(eventsTable.id, update.eventId));
      results.updatedEventIds.push(update.eventId);
    }

    // Deletes
    for (const del of plan.deletes) {
      await db.delete(eventsTable).where(eq(eventsTable.id, del.eventId));
      results.deletedEventIds.push(del.eventId);
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
    for (const comment of plan.comments.remove) {
      await db.delete(eventComments).where(eq(eventComments.id, comment.commentId));
      results.commentsRemoved++;
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
        await db.delete(eventLikes).where(
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

    // Cleanup draft
    a4DraftStore.delete(input.draftId);

    return { applied: true as const, results };
  },
};
