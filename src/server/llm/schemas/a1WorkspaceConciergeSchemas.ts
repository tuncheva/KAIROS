import { z } from "zod";

import { plainString } from "~/server/llm/core/plainText";

/**
 * A1's output contract.
 *
 * Three additions over the original answer/handoff pair:
 *
 * - **`clarify`** (E-1). There was no way for A1 to ask a question back, so an
 *   ambiguous request — "add the tasks we talked about", with two candidate
 *   projects — had to resolve into a guess, and a wrong guess costs the user a
 *   whole draft/confirm cycle to undo. Asking is cheaper than being wrong.
 * - **`handoffs`** (E-2). One handoff per turn meant "break down Alpha, note the
 *   risks, and schedule the kickoff" silently became whichever third of the
 *   request A1 picked. The array is capped at three: enough for a compound
 *   sentence, small enough that a turn stays bounded.
 * - **`followUps`** (G-4). Two or three next questions, produced in the same
 *   call, so continuing a conversation costs the user no typing.
 */

export const ConciergeIntentSchema = z
  .object({
    type: z.enum(["answer", "handoff", "clarify", "draft_plan"]),
    scope: z
      .object({
        orgId: z.union([z.string(), z.number()]).optional(),
        projectId: z.union([z.string(), z.number()]).optional(),
      })
      .default({}),
  })
  .strip();

export const TargetAgentSchema = z.enum([
  "task_planner",
  "notes_vault",
  "events_publisher",
  "org_admin",
]);

export type TargetAgent = z.infer<typeof TargetAgentSchema>;

export const HandoffPlanSchema = z
  .object({
    targetAgent: TargetAgentSchema,
    context: z.record(z.unknown()).default({}),
    userIntent: z.string().min(1),
  })
  .strip();

export type HandoffPlan = z.infer<typeof HandoffPlanSchema>;

/**
 * A question back to the user, with the answers worth offering as one tap.
 *
 * `options` is deliberately short: a clarification with eight choices is not a
 * clarification, it is a menu, and it means A1 should have narrowed first.
 */
export const ClarifySchema = z
  .object({
    question: plainString(z.string().min(1).max(300)),
    options: z.array(plainString(z.string().min(1).max(80))).max(4).default([]),
  })
  .strip();

export const ActionPlanDraftSchema = z
  .object({
    readQueries: z.array(
      z
        .object({
          tool: z.string().min(1),
          input: z.unknown(),
        })
        .strip(),
    ),
    proposedChanges: z.array(
      z
        .object({
          summary: z.string().min(1),
          affectedEntities: z.array(
            z
              .object({
                type: z.string().min(1),
                id: z.union([z.string(), z.number()]).optional(),
              })
              .strip(),
          ),
        })
        .strip(),
    ),
    applyCalls: z.array(
      z
        .object({
          tool: z.string().min(1),
          input: z.unknown(),
        })
        .strip(),
    ),
  })
  .strip();

/**
 * A citation the UI can turn into a link.
 *
 * `ref` was free-form and rendered nowhere. It now carries a `kind:id` pair when
 * the model is pointing at a record, which is what lets the client deep-link it —
 * the whole value of a citation is that the reader can go and check it.
 */
export const CitationSchema = z
  .object({
    label: plainString(z.string().min(1)),
    ref: z.string().min(1),
  })
  .strip();

const A1BaseSchema = z
  .object({
    intent: ConciergeIntentSchema,
    answer: z
      .object({
        summary: plainString(z.string().min(1)),
        details: z.array(plainString(z.string())).optional(),
      })
      .strip()
      .optional(),
    handoff: HandoffPlanSchema.optional(),
    /** Preferred over `handoff` when the request needs more than one agent. */
    handoffs: z.array(HandoffPlanSchema).max(3).optional(),
    clarify: ClarifySchema.optional(),
    draftPlan: ActionPlanDraftSchema.optional(),
    citations: z.array(CitationSchema).optional(),
    followUps: z.array(plainString(z.string().min(1).max(120))).max(3).optional(),
  })
  .strip();

/**
 * Normalize the two handoff shapes into one.
 *
 * Models emit whichever of `handoff` / `handoffs` the prompt most recently
 * mentioned, and sometimes both. Rather than make every caller handle that,
 * validation collapses them: `handoffs` is always the authoritative list, and
 * `handoff` always mirrors its first entry so existing call sites keep working.
 */
export const A1OutputSchema = A1BaseSchema.transform((out) => {
  const list = out.handoffs?.length
    ? out.handoffs
    : out.handoff
      ? [out.handoff]
      : [];

  // Two handoffs to the same agent are one handoff with a confused prompt; the
  // sub-agent would draft twice against the same domain and the user would get
  // two confirm cards for one request.
  const deduped: typeof list = [];
  for (const h of list) {
    if (!deduped.some((d) => d.targetAgent === h.targetAgent)) deduped.push(h);
  }

  return {
    ...out,
    handoff: deduped[0],
    handoffs: deduped,
  };
});

export type A1Output = z.infer<typeof A1OutputSchema>;
