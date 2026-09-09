import { z } from "zod";

import { plainString } from "~/server/llm/core/plainText";

/**
 * A6 — Project Manager plan shapes.
 *
 * The agent creates, renames, updates description/status and archives projects.
 * Each operation is authorized individually at apply time against the caller's
 * live org membership flags, just as A5 does for membership changes.
 */

export const ProjectStatusSchema = z.enum(["active", "archived"]);

export const ProjectCreateSchema = z
  .object({
    title: plainString(z.string().min(1).max(256)),
    description: z.string().max(5000).optional(),
    organizationId: z.number().int().positive().optional(),
    rationale: plainString(z.string().min(1).max(300)),
  })
  .strip();

export const ProjectUpdateSchema = z
  .object({
    projectId: z.number().int().positive(),
    projectTitle: z.string().min(1).max(256).describe("Display name shown on the confirm card"),
    patch: z
      .object({
        title: plainString(z.string().min(1).max(256)).optional(),
        description: z.string().max(5000).optional(),
        status: ProjectStatusSchema.optional(),
      })
      .strip(),
    rationale: plainString(z.string().min(1).max(300)),
  })
  .strip();

export const ProjectArchiveSchema = z
  .object({
    projectId: z.number().int().positive(),
    projectTitle: z.string().min(1).max(256).describe("Display name shown on the confirm card"),
    rationale: plainString(z.string().min(1).max(300)),
  })
  .strip();

export const ProjectManagerDraftSchema = z
  .object({
    /** One or two sentences the user reads before deciding. */
    summary: plainString(z.string().min(1).max(600)),
    creates: z.array(ProjectCreateSchema).max(10).default([]),
    updates: z.array(ProjectUpdateSchema).max(20).default([]),
    archives: z.array(ProjectArchiveSchema).max(10).default([]),
    warnings: z.array(plainString(z.string().min(1).max(300))).max(10).default([]),
    questions: z.array(plainString(z.string().min(1).max(300))).max(5).default([]),
    planHash: z.string().optional(),
  })
  .strip();

export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type ProjectArchive = z.infer<typeof ProjectArchiveSchema>;
export type ProjectManagerDraft = z.infer<typeof ProjectManagerDraftSchema>;

export interface ProjectManagerApplyOutput {
  applied: true;
  results: {
    created: number;
    updated: number;
    archived: number;
    /** Operations the plan asked for that the server refused, and why. */
    refused: string[];
  };
}

// ---------------------------------------------------------------------------
// Router input schemas
// ---------------------------------------------------------------------------

export const ProjectManagerDraftInputSchema = z.object({
  message: z.string().min(1).max(20_000),
  organizationId: z.number().int().positive().optional(),
});

export const ProjectManagerConfirmInputSchema = z.object({
  draftId: z.string().min(1),
});

export const ProjectManagerApplyInputSchema = z.object({
  draftId: z.string().min(1),
  confirmationToken: z.string().min(1),
});
