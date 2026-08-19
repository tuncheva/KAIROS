/**
 * Task generation: turn a prompt, or an uploaded PDF, into draft tasks.
 *
 * Grouped with neither A1 nor A2 because it is a helper both reach for: it produces
 * candidate tasks without the draft/confirm/apply lifecycle.
 */

import {
  TRPCError,
} from "@trpc/server";
import {
  eq,
  desc,
  and,
} from "drizzle-orm";

import {
  TaskGenerationOutputSchema,
  type GenerateTaskDraftsOutput,
} from "~/server/llm/schemas/taskGenerationSchemas";

import {
  getTaskGenerationPrompt,
  getPdfTaskExtractionPrompt,
} from "~/server/llm/prompts/a1Prompts";

import {
  chatCompletion,
} from "~/server/llm/llm/modelClient";
import {
  parseAndValidate,
} from "~/server/llm/llm/jsonRepair";
import {
  extractTextFromPdf,
} from "~/server/llm/pdf/pdfExtractor";

import {
  projects,
  tasks,
  projectCollaborators,
  users,
} from "~/server/db/schema";
import {
  createDraftId,
  type TaskDraftInput,
  type PdfTaskInput,
} from "./shared";
export const taskGeneration = {
  async generateTaskDrafts(input: TaskDraftInput): Promise<GenerateTaskDraftsOutput> {
    const userId = input.ctx.session?.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // 1. Fetch project details
    const [project] = await input.ctx.db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        createdById: projects.createdById,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    if (!project) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    }

    // 2. Authorization check — user must be creator or collaborator
    if (project.createdById !== userId) {
      const [collab] = await input.ctx.db
        .select({ collaboratorId: projectCollaborators.collaboratorId })
        .from(projectCollaborators)
        .where(and(
          eq(projectCollaborators.projectId, input.projectId),
          eq(projectCollaborators.collaboratorId, userId),
        ))
        .limit(1);

      if (!collab) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      }
    }

    // 3. Fetch existing tasks to avoid duplication
    const existingTasks = await input.ctx.db
      .select({
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(eq(tasks.projectId, input.projectId))
      .orderBy(desc(tasks.createdAt))
      .limit(50);

    // 4. Fetch available team members
    const collaborators = await input.ctx.db
      .select({
        id: users.id,
        name: users.name,
      })
      .from(projectCollaborators)
      .innerJoin(users, eq(projectCollaborators.collaboratorId, users.id))
      .where(eq(projectCollaborators.projectId, input.projectId));

    // Include the project owner
    const [owner] = await input.ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, project.createdById))
      .limit(1);

    const availableUsers = [
      ...(owner ? [{ id: owner.id, name: owner.name }] : []),
      ...collaborators,
    ];

    // 5. Build the description-aware prompt
    const projectDescription = [
      project.description ?? "",
      input.message ? `\n\nAdditional instructions: ${input.message}` : "",
    ].join("");

    // If no description and no message, use the project title as minimal context
    const effectiveDescription = projectDescription.trim()
      || `Project: "${project.title}". Generate a reasonable set of tasks for a project with this name.`;

    const systemPrompt = getTaskGenerationPrompt({
      projectTitle: project.title,
      projectDescription: effectiveDescription,
      existingTasks,
      availableUsers,
    });

    // 6. Call LLM
    const draftId = createDraftId();

    try {
      const llmResponse = await chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              input.message ??
              `Analyze the project description and generate a comprehensive task breakdown for "${project.title}".`,
          },
        ],
        temperature: 0.3,
        jsonMode: true,
        maxTokens: 4096,
      });

      // 7. Parse + validate
      const parseResult = await parseAndValidate(
        llmResponse.content,
        TaskGenerationOutputSchema,
      );

      if (!parseResult.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to parse task generation output: ${parseResult.error}`,
        });
      }

      return {
        draftId,
        tasks: parseResult.data.tasks.map((t) => ({
          title: t.title,
          description: t.description ?? "",
          priority: t.priority ?? "medium",
          orderIndex: t.orderIndex ?? 0,
          estimatedDueDays: t.estimatedDueDays ?? null,
        })),
        reasoning: parseResult.data.reasoning ?? "",
        projectTitle: project.title,
        projectDescription: project.description ?? "",
      };
    } catch (err) {
      if (err instanceof TRPCError) throw err;

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          err instanceof Error
            ? `Agent error: ${err.message}`
            : "An unexpected error occurred while generating tasks",
      });
    }
  },

  /**
   * Extract tasks from a PDF document using the LLM.
   * Supports documents in EN, BG, ES, DE, FR (matching i18n config).
   */
  async extractTasksFromPdf(input: PdfTaskInput): Promise<GenerateTaskDraftsOutput> {
    const userId = input.ctx.session?.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // 1. Fetch project details
    const [project] = await input.ctx.db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        createdById: projects.createdById,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    if (!project) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }

    // 2. Authorization check
    if (project.createdById !== userId) {
      const [collab] = await input.ctx.db
        .select({ collaboratorId: projectCollaborators.collaboratorId })
        .from(projectCollaborators)
        .where(and(
          eq(projectCollaborators.projectId, input.projectId),
          // Without this predicate the query returned an arbitrary collaborator
          // and compared it to the caller, denying legitimate collaborators
          // whenever they were not the first row.
          eq(projectCollaborators.collaboratorId, userId),
        ))
        .limit(1);

      if (collab?.collaboratorId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      }
    }

    // 3. Extract text from PDF
    let pdfResult: Awaited<ReturnType<typeof extractTextFromPdf>>;
    try {
      pdfResult = await extractTextFromPdf(input.pdfBase64);
    } catch (err) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          err instanceof Error
            ? err.message
            : "Failed to extract text from the PDF",
      });
    }

    // 4. Fetch existing tasks to avoid duplication
    const existingTasks = await input.ctx.db
      .select({
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(eq(tasks.projectId, input.projectId))
      .orderBy(desc(tasks.createdAt))
      .limit(50);

    // 5. Build the PDF-aware prompt
    const systemPrompt = getPdfTaskExtractionPrompt({
      projectTitle: project.title,
      projectDescription: project.description ?? "",
      pdfText: pdfResult.text,
      pdfFileName: input.fileName,
      pdfTruncated: pdfResult.truncated,
      pdfPageCount: pdfResult.numPages,
      existingTasks,
      userMessage: input.message,
    });

    // 6. Call LLM
    const draftId = createDraftId();

    try {
      const llmResponse = await chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              input.message ??
              `Extract actionable tasks from this PDF document for the project "${project.title}".`,
          },
        ],
        temperature: 0.3,
        jsonMode: true,
        maxTokens: 4096,
      });

      // 7. Parse + validate
      const parseResult = await parseAndValidate(
        llmResponse.content,
        TaskGenerationOutputSchema,
      );

      if (!parseResult.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to parse PDF task extraction output: ${parseResult.error}`,
        });
      }

      return {
        draftId,
        tasks: parseResult.data.tasks.map((t) => ({
          title: t.title,
          description: t.description ?? "",
          priority: t.priority ?? "medium",
          orderIndex: t.orderIndex ?? 0,
          estimatedDueDays: t.estimatedDueDays ?? null,
        })),
        reasoning: parseResult.data.reasoning ?? "",
        projectTitle: project.title,
        projectDescription: project.description ?? "",
      };
    } catch (err) {
      if (err instanceof TRPCError) throw err;

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          err instanceof Error
            ? `Agent error: ${err.message}`
            : "An unexpected error occurred while extracting tasks from the PDF",
      });
    }
  },

  // ---------------------------------------------------------------------------
  // A4 Events Publisher API
  // ---------------------------------------------------------------------------
};
