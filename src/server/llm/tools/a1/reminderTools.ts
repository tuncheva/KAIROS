/**
 * A1 reminder tools — schedule, list, and cancel point-in-time reminders.
 *
 * Reminders are written to `ai_reminders` and delivered by the scheduled runner
 * (`runDueReminders`). They are scoped to the calling user and never touch any
 * other user's data.
 */

import "server-only";

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";

import { aiReminders } from "~/server/db/schema";
import { requireUser } from "./scope";
import type { A1Tool } from "./types";

// ---------------------------------------------------------------------------
// scheduleReminder
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

type ScheduleReminderInput = {
  text: string;
  fireAt: string;
  sourceConversationId?: string;
};

type ScheduleReminderOutput = {
  reminderId: number;
  fireAt: Date;
};

export const scheduleReminderTool: A1Tool<
  "scheduleReminder",
  ScheduleReminderInput,
  ScheduleReminderOutput
> = {
  name: "scheduleReminder",
  inputSchema: z
    .object({
      text: z.string().min(1).max(500),
      fireAt: z.string().regex(ISO_DATE, "Must be an ISO 8601 date or datetime"),
      sourceConversationId: z.string().max(80).optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      reminderId: z.number().int().positive(),
      fireAt: z.date(),
    })
    .strict(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);

    const fireAtDate = new Date(input.fireAt);
    if (Number.isNaN(fireAtDate.getTime())) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid fireAt date",
      });
    }
    if (fireAtDate <= new Date()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "fireAt must be in the future",
      });
    }

    const [inserted] = await ctx.db
      .insert(aiReminders)
      .values({
        userId,
        text: input.text,
        fireAt: fireAtDate,
        sourceConversationId: input.sourceConversationId ?? null,
      })
      .returning({ id: aiReminders.id, fireAt: aiReminders.fireAt });

    if (!inserted) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to schedule reminder",
      });
    }

    return { reminderId: inserted.id, fireAt: inserted.fireAt };
  },
};

// ---------------------------------------------------------------------------
// listReminders
// ---------------------------------------------------------------------------

type ListRemindersInput = Record<string, never>;

type ListRemindersOutput = Array<{
  id: number;
  text: string;
  fireAt: Date;
  sourceConversationId: string | null;
  createdAt: Date;
}>;

export const listRemindersTool: A1Tool<
  "listReminders",
  ListRemindersInput,
  ListRemindersOutput
> = {
  name: "listReminders",
  inputSchema: z.object({}).strict() as z.ZodType<ListRemindersInput>,
  outputSchema: z.array(
    z
      .object({
        id: z.number(),
        text: z.string(),
        fireAt: z.date(),
        sourceConversationId: z.string().nullable(),
        createdAt: z.date(),
      })
      .strict(),
  ),

  async execute(ctx) {
    const userId = requireUser(ctx);

    const rows = await ctx.db
      .select({
        id: aiReminders.id,
        text: aiReminders.text,
        fireAt: aiReminders.fireAt,
        sourceConversationId: aiReminders.sourceConversationId,
        createdAt: aiReminders.createdAt,
      })
      .from(aiReminders)
      .where(
        and(
          eq(aiReminders.userId, userId),
          isNull(aiReminders.firedAt),
          isNull(aiReminders.cancelledAt),
        ),
      )
      .orderBy(desc(aiReminders.createdAt))
      .limit(10);

    return rows;
  },
};

// ---------------------------------------------------------------------------
// cancelReminder
// ---------------------------------------------------------------------------

type CancelReminderInput = { reminderId: number };
type CancelReminderOutput = { cancelled: true };

export const cancelReminderTool: A1Tool<
  "cancelReminder",
  CancelReminderInput,
  CancelReminderOutput
> = {
  name: "cancelReminder",
  inputSchema: z
    .object({ reminderId: z.number().int().positive() })
    .strict(),
  outputSchema: z.object({ cancelled: z.literal(true) }).strict(),

  async execute(ctx, input) {
    const userId = requireUser(ctx);

    // Verify ownership before cancelling
    const [reminder] = await ctx.db
      .select({ id: aiReminders.id, userId: aiReminders.userId })
      .from(aiReminders)
      .where(eq(aiReminders.id, input.reminderId))
      .limit(1);

    if (!reminder) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Reminder not found",
      });
    }
    if (reminder.userId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not own this reminder",
      });
    }

    await ctx.db
      .update(aiReminders)
      .set({ cancelledAt: new Date() })
      .where(
        and(
          eq(aiReminders.id, input.reminderId),
          eq(aiReminders.userId, userId),
          isNull(aiReminders.cancelledAt),
        ),
      );

    return { cancelled: true as const };
  },
};
