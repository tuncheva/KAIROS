import { z } from "zod";

import { plainString } from "~/server/llm/core/plainText";

// ---------------------------------------------------------------------------
// Enums (must match DB + task router)
// ---------------------------------------------------------------------------

export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

// Matches [`taskStatusEnum`](src/server/db/schema.ts:22) and
// [`taskRouter.updateStatus`](src/server/api/routers/task.ts:118)
export const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "blocked",
]);

// ---------------------------------------------------------------------------
// Draft primitives
// ---------------------------------------------------------------------------

const ISODateTimeStringSchema = z
  .string()
  // Accept both full ISO-8601 timestamp and date-only formats from the LLM
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}.*Z)?$/)
  .describe("ISO 8601 UTC timestamp, e.g. 2026-02-09T07:03:00.000Z, or date-only 2026-02-09");

/**
 * The fields the model is responsible for on a created task.
 *
 * Note what is absent: `clientRequestId`. Requiring the model to mint a unique
 * id per task made every plan a coin flip — a duplicate or a too-short string
 * failed validation for the whole plan, and the id carries no meaning the model
 * could reason about. The server assigns it at draft time; see
 * {@link TaskCreateDraftSchema}.
 */
export const TaskCreateModelSchema = z
  .object({
    title: plainString(z.string().min(1).max(256)),
    description: z.string().max(5000).default(""),
    priority: TaskPrioritySchema.default("medium"),
    assignedToId: z.string().min(1).optional(),
    acceptanceCriteria: z
      .array(plainString(z.string().min(1).max(200)))
      .max(20)
      .default([]),
    orderIndex: z.number().int().min(0).optional(),
    dueDate: ISODateTimeStringSchema.nullable().optional(),
  })
  .strip();

/** A created task as persisted: the model's fields plus the server's idempotency key. */
export const TaskCreateDraftSchema = TaskCreateModelSchema.extend({
  /** Required for idempotency; unique per project for a given plan. Server-assigned. */
  clientRequestId: z.string().min(8).max(128),
}).strip();

export const TaskUpdateDraftSchema = z
  .object({
    taskId: z.number().int().positive(),
    patch: z
      .object({
        title: plainString(z.string().min(1).max(256)).optional(),
        description: z.string().max(5000).optional(),
        priority: TaskPrioritySchema.optional(),
        assignedToId: z.string().min(1).nullable().optional(),
        dueDate: ISODateTimeStringSchema.nullable().optional(),
      })
      .strip(),
    reason: plainString(z.string().max(500)).optional(),
  })
  .strip();

export const TaskStatusChangeDraftSchema = z
  .object({
    taskId: z.number().int().positive(),
    status: TaskStatusSchema,
    reason: plainString(z.string().max(500)).optional(),
  })
  .strip();

export const TaskDeleteDraftSchema = z
  .object({
    taskId: z.number().int().positive(),
    reason: plainString(z.string().min(1).max(500)),
    /** Must be true for deletes to be considered at all */
    dangerous: z.boolean(),
  })
  .strip();

export const TaskPlanDiffPreviewSchema = z
  .object({
    // Models may omit individual arrays; default them so validation remains robust.
    creates: z.array(plainString(z.string().min(1))).max(50).default([]),
    updates: z.array(plainString(z.string().min(1))).max(50).default([]),
    statusChanges: z.array(plainString(z.string().min(1))).max(50).default([]),
    deletes: z.array(plainString(z.string().min(1))).max(50).default([]),
  })
  .strip();

export const TaskPlannerScopeSchema = z
  .object({
    orgId: z.union([z.string(), z.number()]).optional(),
    /**
     * Server-assigned. Optional only for the one plan that never reaches apply:
     * when no project could be resolved, A2 returns a questions-only plan that is
     * not persisted. Apply compares this against the draft's own `projectId`
     * column, so an absent value there fails closed.
     */
    projectId: z.number().int().positive().optional(),
  })
  .strip();

/**
 * The plan shape the model is asked to produce.
 *
 * `scope` is absent on purpose. It used to be required, which meant the model
 * had to echo back a project id it was only ever told in passing: get it wrong
 * and apply refused the plan ("Plan scope does not match"), omit it and the
 * whole response failed validation. The project is resolved by the server before
 * the model is called, so the server fills it in — see {@link TaskPlanDraftSchema}.
 */
export const TaskPlanModelOutputSchema = z
  .object({
    // Use .catch() to default to "task_planner" if the LLM omits or returns wrong value
    agentId: z.literal("task_planner").catch("task_planner"),

    creates: z.array(TaskCreateModelSchema).max(30).default([]),
    updates: z.array(TaskUpdateDraftSchema).max(50).default([]),
    statusChanges: z.array(TaskStatusChangeDraftSchema).max(50).default([]),
    deletes: z.array(TaskDeleteDraftSchema).max(10).default([]),

    orderingRationale: z.string().max(2000).optional(),
    assigneeRationale: z.string().max(2000).optional(),

    risks: z.array(plainString(z.string().min(1).max(300))).max(20).default([]),
    questionsForUser: z.array(plainString(z.string().min(1).max(300))).max(10).default([]),

    diffPreview: TaskPlanDiffPreviewSchema.default({
      creates: [],
      updates: [],
      statusChanges: [],
      deletes: [],
    }),
  })
  // Use strip() instead of strict() — LLMs sometimes add extra keys like "type"
  // that would cause validation to fail. strip() silently removes unknown keys.
  .strip();

export type TaskPlanModelOutput = z.infer<typeof TaskPlanModelOutputSchema>;

/** The plan as persisted and applied: model output plus the server's scope and ids. */
export const TaskPlanDraftSchema = z
  .object({
    // Use .catch() to default to "task_planner" if the LLM omits or returns wrong value
    agentId: z.literal("task_planner").catch("task_planner"),
    scope: TaskPlannerScopeSchema,

    creates: z.array(TaskCreateDraftSchema).max(30).default([]),
    updates: z.array(TaskUpdateDraftSchema).max(50).default([]),
    statusChanges: z.array(TaskStatusChangeDraftSchema).max(50).default([]),
    deletes: z.array(TaskDeleteDraftSchema).max(10).default([]),

    orderingRationale: z.string().max(2000).optional(),
    assigneeRationale: z.string().max(2000).optional(),

    risks: z.array(plainString(z.string().min(1).max(300))).max(20).default([]),
    questionsForUser: z.array(plainString(z.string().min(1).max(300))).max(10).default([]),

    // Models sometimes omit this; default it so the backend can still persist + show a plan.
    diffPreview: TaskPlanDiffPreviewSchema.default({
      creates: [],
      updates: [],
      statusChanges: [],
      deletes: [],
    }),

    /** Computed server-side from normalized plan JSON; model may omit */
    planHash: z.string().min(8).max(128).optional(),
  })
  // Use strip() instead of strict() — LLMs sometimes add extra keys like "type"
  // that would cause validation to fail. strip() silently removes unknown keys.
  .strip();

export type TaskPlanDraft = z.infer<typeof TaskPlanDraftSchema>;

// ---------------------------------------------------------------------------
// API shapes (tRPC)
// ---------------------------------------------------------------------------

export const TaskPlannerDraftInputSchema = z
  .object({
    message: z.string().min(1).max(20_000),
    scope: z
      .object({
        orgId: z.union([z.string(), z.number()]).optional(),
        projectId: z.number().int().positive().optional(),
      })
      .optional(),
    handoffContext: z.record(z.unknown()).optional(),
    /**
     * E-3 — the draft this message refines.
     *
     * Set when the user replies to a plan with a change ("push the third one to
     * Friday") rather than with a new request. See `a2TaskPlanner.taskPlannerDraft`.
     */
    priorDraftId: z.string().min(1).optional(),
  })
  .strict();

export const TaskPlannerDraftOutputSchema = z
  .object({
    draftId: z.string().min(1),
    plan: TaskPlanDraftSchema,
  })
  .strict();

export type TaskPlannerDraftInput = z.infer<typeof TaskPlannerDraftInputSchema>;
export type TaskPlannerDraftOutput = z.infer<typeof TaskPlannerDraftOutputSchema>;

export const TaskPlannerConfirmInputSchema = z
  .object({
    draftId: z.string().min(1),
  })
  .strict();

export const TaskPlannerConfirmOutputSchema = z
  .object({
    confirmationToken: z.string().min(1),
    summary: z
      .object({
        creates: z.number().int().min(0),
        updates: z.number().int().min(0),
        statusChanges: z.number().int().min(0),
        deletes: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export type TaskPlannerConfirmInput = z.infer<typeof TaskPlannerConfirmInputSchema>;
export type TaskPlannerConfirmOutput = z.infer<typeof TaskPlannerConfirmOutputSchema>;

export const TaskPlannerApplyInputSchema = z
  .object({
    draftId: z.string().min(1),
    confirmationToken: z.string().min(1),
  })
  .strict();

export const TaskPlannerApplyOutputSchema = z
  .object({
    applied: z.literal(true),
    results: z
      .object({
        createdTaskIds: z.array(z.number().int().positive()),
        updatedTaskIds: z.array(z.number().int().positive()),
        statusChangedTaskIds: z.array(z.number().int().positive()),
        deletedTaskIds: z.array(z.number().int().positive()),
      })
      .strict(),
  })
  .strict();

export type TaskPlannerApplyInput = z.infer<typeof TaskPlannerApplyInputSchema>;
export type TaskPlannerApplyOutput = z.infer<typeof TaskPlannerApplyOutputSchema>;
