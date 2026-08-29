import { z } from "zod";

import { plainString } from "~/server/llm/core/plainText";

/* ─── Regions (mirrors event router enum) ─── */
const RegionEnum = z.enum([
  "sofia",
  "plovdiv",
  "varna",
  "burgas",
  "ruse",
  "stara_zagora",
  "pleven",
  "sliven",
  "dobrich",
  "shumen",
]);

/* ─── Individual operation schemas ─── */

export const EventCreateSchema = z
  .object({
    title: plainString(z.string().min(1).max(256)),
    description: z.string().min(1).max(5000),
    eventDate: z.string().describe("ISO-8601 UTC datetime"),
    region: RegionEnum,
    enableRsvp: z.boolean().default(false),
    sendReminders: z.boolean().default(false),
    imageUrl: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().url().optional(),
    ),
    clientRequestId: z.string().min(1).max(64),
  })
  .strict();

export const EventUpdateSchema = z
  .object({
    eventId: z.number().int().positive(),
    patch: z
      .object({
        title: plainString(z.string().min(1).max(256)).optional(),
        description: z.string().min(1).max(5000).optional(),
        eventDate: z.string().optional(),
        region: RegionEnum.optional(),
        enableRsvp: z.boolean().optional(),
        sendReminders: z.boolean().optional(),
        imageUrl: z.preprocess(
          (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
          z.string().url().nullable().optional(),
        ),
      })
      .strict(),
    reason: plainString(z.string().max(500)).optional(),
  })
  .strict();

export const EventDeleteSchema = z
  .object({
    eventId: z.number().int().positive(),
    reason: plainString(z.string().min(1).max(500)),
    dangerous: z.literal(true),
  })
  .strip();

export const EventCommentAddSchema = z
  .object({
    eventId: z.number().int().positive(),
    text: plainString(z.string().min(1).max(500)),
  })
  .strip();

export const EventCommentDeleteSchema = z
  .object({
    eventId: z.number().int().positive(),
    commentId: z.number().int().positive(),
    reason: plainString(z.string().min(1).max(500)),
    dangerous: z.literal(true),
  })
  .strip();

export const EventRsvpSchema = z
  .object({
    eventId: z.number().int().positive(),
    status: z.enum(["going", "maybe", "not_going"]),
  })
  .strip();

export const EventLikeToggleSchema = z
  .object({
    eventId: z.number().int().positive(),
  })
  .strip();

/* ─── Draft plan (full LLM output) ─── */

export const EventsPublisherDraftSchema = z
  .object({
    agentId: z.literal("events_publisher"),
    creates: z.array(EventCreateSchema).max(10).default([]),
    updates: z.array(EventUpdateSchema).max(20).default([]),
    deletes: z.array(EventDeleteSchema).max(5).default([]),
    comments: z
      .object({
        add: z.array(EventCommentAddSchema).max(20).default([]),
        remove: z.array(EventCommentDeleteSchema).max(10).default([]),
      })
      .strip()
      .default({ add: [], remove: [] }),
    rsvps: z.array(EventRsvpSchema).max(20).default([]),
    likes: z.array(EventLikeToggleSchema).max(20).default([]),
    summary: plainString(z.string().min(1).max(2000)),
    risks: z.array(plainString(z.string().max(500))).max(10).default([]),
    questionsForUser: z.array(plainString(z.string().max(500))).max(5).default([]),
    diffPreview: z
      .object({
        creates: z.array(plainString(z.string())).default([]),
        updates: z.array(plainString(z.string())).default([]),
        deletes: z.array(plainString(z.string())).default([]),
        comments: z.array(plainString(z.string())).default([]),
        rsvps: z.array(plainString(z.string())).default([]),
      })
      .strip()
      .default({ creates: [], updates: [], deletes: [], comments: [], rsvps: [] }),
    planHash: z.string().min(8).max(128).optional(),
  })
  .strip();

export type EventsPublisherDraft = z.infer<typeof EventsPublisherDraftSchema>;

/* ─── tRPC API schemas ─── */

export const EventsPublisherDraftInputSchema = z
  .object({
    message: z.string().min(1).max(20_000),
    handoffContext: z.record(z.unknown()).optional(),
  })
  .strict();

export const EventsPublisherDraftOutputSchema = z
  .object({
    draftId: z.string().min(1),
    plan: EventsPublisherDraftSchema,
  })
  .strict();

export type EventsPublisherDraftInput = z.infer<typeof EventsPublisherDraftInputSchema>;
export type EventsPublisherDraftOutput = z.infer<typeof EventsPublisherDraftOutputSchema>;

export const EventsPublisherConfirmInputSchema = z
  .object({ 
    draftId: z.string().min(1),
    /** Optional user edits to override draft content before confirming */
    edits: z.array(z.object({
      index: z.number().int().min(0),
      title: z.string().min(1).max(256).optional(),
      description: z.string().min(1).max(5000).optional(),
    })).optional(),
  })
  .strict();

export const EventsPublisherConfirmOutputSchema = z
  .object({
    confirmationToken: z.string().min(1),
    summary: z
      .object({
        creates: z.number().int().min(0),
        updates: z.number().int().min(0),
        deletes: z.number().int().min(0),
        commentsAdded: z.number().int().min(0),
        commentsRemoved: z.number().int().min(0),
        rsvps: z.number().int().min(0),
        likes: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export type EventsPublisherConfirmInput = z.infer<typeof EventsPublisherConfirmInputSchema>;
export type EventsPublisherConfirmOutput = z.infer<typeof EventsPublisherConfirmOutputSchema>;

export const EventsPublisherApplyInputSchema = z
  .object({
    draftId: z.string().min(1),
    confirmationToken: z.string().min(1),
  })
  .strict();

export const EventsPublisherApplyOutputSchema = z
  .object({
    applied: z.literal(true),
    results: z
      .object({
        createdEventIds: z.array(z.number().int().positive()),
        updatedEventIds: z.array(z.number().int().positive()),
        deletedEventIds: z.array(z.number().int().positive()),
        commentsAdded: z.number().int().min(0),
        commentsRemoved: z.number().int().min(0),
        rsvpsSet: z.number().int().min(0),
        likesToggled: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export type EventsPublisherApplyInput = z.infer<typeof EventsPublisherApplyInputSchema>;
export type EventsPublisherApplyOutput = z.infer<typeof EventsPublisherApplyOutputSchema>;
