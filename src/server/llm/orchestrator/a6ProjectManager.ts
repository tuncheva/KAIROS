/**
 * A6 — Project Manager: draft, confirm and apply project lifecycle changes.
 *
 * Same lifecycle as A2–A5 — a persisted draft, a hash, an HMAC confirmation
 * token, an audit row — with per-operation authorization at apply time.
 *
 * Authorization follows the same split the data model does:
 * - Personal projects (no org): the caller must be the creator.
 * - Org projects: the caller's live org membership flags govern each operation.
 *
 * Refusals do not abort the apply. If the plan asks for three things and the
 * caller may do two, two happen and the third comes back in `refused` with a reason.
 */

import "server-only";

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import {
  agentProjectManagerApplies,
  agentProjectManagerDrafts,
  organizationMembers,
  projects,
} from "~/server/db/schema";
import { buildA6Context } from "~/server/llm/context/a6ContextBuilder";
import { completeJson } from "~/server/llm/core/jsonRepair";
import { getA6SystemPrompt } from "~/server/llm/prompts/a6Prompts";
import { replyLanguageMessages } from "~/server/llm/prompts/replyLanguage";
import { localized, type LocalizedText } from "~/server/llm/locale";
import {
  ProjectManagerDraftSchema,
  type ProjectManagerApplyOutput,
  type ProjectManagerDraft,
} from "~/server/llm/schemas/a6ProjectManagerSchemas";
import { createLogger } from "~/server/logger";

import {
  computePlanHash,
  createDraftId,
  mintConfirmationToken,
  readConfirmationToken,
  requireUserId,
} from "./shared";

const log = createLogger("agent.a6");

async function loadDraft(ctx: TRPCContext, draftId: string, userId: string) {
  const [draft] = await ctx.db
    .select({
      id: agentProjectManagerDrafts.id,
      userId: agentProjectManagerDrafts.userId,
      planJson: agentProjectManagerDrafts.planJson,
      planHash: agentProjectManagerDrafts.planHash,
      status: agentProjectManagerDrafts.status,
      confirmationToken: agentProjectManagerDrafts.confirmationToken,
    })
    .from(agentProjectManagerDrafts)
    .where(eq(agentProjectManagerDrafts.id, draftId))
    .limit(1);

  if (!draft) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
  }
  if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
  return draft;
}

function hashPlan(plan: ProjectManagerDraft): string {
  const { planHash: _embedded, ...rest } = plan;
  return computePlanHash(rest);
}

const NO_PROJECTS_SUMMARY: LocalizedText = {
  en: "You don't have any projects yet, and I couldn't find any organizations to create a project in. Create a personal project or join an organization first.",
  bg: "Все още нямате проекти и не намерих организации, в които да създадете такъв. Първо създайте личен проект или се присъединете към организация.",
};

export const a6ProjectManager = {
  async projectManagerDraft(input: {
    ctx: TRPCContext;
    message: string;
    organizationId?: number;
    handoffContext?: Record<string, unknown>;
    originalMessage?: string;
  }): Promise<{ draftId: string; plan: ProjectManagerDraft }> {
    const userId = requireUserId(input.ctx);
    const draftId = createDraftId();

    const contextPack = await buildA6Context({
      ctx: input.ctx,
      organizationId: input.organizationId,
    });

    if (contextPack.projects.length === 0 && contextPack.orgMemberships.length === 0) {
      const plan: ProjectManagerDraft = {
        summary: localized(NO_PROJECTS_SUMMARY, contextPack.locale),
        creates: [],
        updates: [],
        archives: [],
        warnings: [],
        questions: [],
      };
      const planHash = hashPlan(plan);
      const stored = { ...plan, planHash };

      await input.ctx.db.insert(agentProjectManagerDrafts).values({
        id: draftId,
        userId,
        message: input.message,
        planJson: JSON.stringify(stored),
        planHash,
        status: "draft",
      });

      return { draftId, plan: stored };
    }

    const systemPrompt = getA6SystemPrompt(
      contextPack,
      input.originalMessage,
      input.message,
    );

    const parseResult = await completeJson({
      messages: [
        { role: "system", content: systemPrompt },
        ...replyLanguageMessages({
          locale: contextPack.locale,
          message: input.message,
          originalMessage: input.originalMessage,
        }),
        { role: "user", content: input.message },
      ],
      schema: ProjectManagerDraftSchema,
      temperature: 0.2,
      purpose: "a6.draft",
      userId,
    });

    if (!parseResult.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid A6 plan JSON: ${parseResult.error}`,
      });
    }

    const raw = parseResult.data;

    // Draft-time guardrails: strip operations on projects the user cannot see.
    const visibleProjectIds = new Set(contextPack.projects.map((p) => p.id));
    const orgMembershipMap = new Map(
      contextPack.orgMemberships.map((m) => [m.orgId, m]),
    );

    // Get visible projects map for ownership checks
    const visibleProjectMap = new Map(contextPack.projects.map((p) => [p.id, p]));

    const canUpdateProject = (projectId: number): boolean => {
      const project = visibleProjectMap.get(projectId);
      if (!project) return false;
      if (project.organizationId === null) {
        // Personal project — only the creator may update
        return project.status !== "archived";
      }
      const membership = orgMembershipMap.get(project.organizationId);
      return membership?.canEditProjects ?? false;
    };

    const canArchiveProject = (projectId: number): boolean => {
      const project = visibleProjectMap.get(projectId);
      if (!project) return false;
      if (project.organizationId === null) {
        // Personal project — creator can archive
        return true;
      }
      const membership = orgMembershipMap.get(project.organizationId);
      return membership?.canDeleteTasks ?? false;
    };

    const canCreateInOrg = (organizationId: number | undefined): boolean => {
      if (!organizationId) return true; // personal project, always allowed
      const membership = orgMembershipMap.get(organizationId);
      return membership?.canCreateProjects ?? false;
    };

    const guarded: ProjectManagerDraft = {
      ...raw,
      creates: raw.creates.filter((op) => canCreateInOrg(op.organizationId)),
      updates: raw.updates.filter(
        (op) => visibleProjectIds.has(op.projectId) && canUpdateProject(op.projectId),
      ),
      archives: raw.archives.filter(
        (op) => visibleProjectIds.has(op.projectId) && canArchiveProject(op.projectId),
      ),
    };

    const planHash = hashPlan(guarded);
    const plan: ProjectManagerDraft = { ...guarded, planHash };

    await input.ctx.db.insert(agentProjectManagerDrafts).values({
      id: draftId,
      userId,
      message: input.message,
      planJson: JSON.stringify(plan),
      planHash,
      status: "draft",
    });

    return { draftId, plan };
  },

  async projectManagerConfirm(input: {
    ctx: TRPCContext;
    draftId: string;
  }): Promise<{
    confirmationToken: string;
    summary: {
      creates: number;
      updates: number;
      archives: number;
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

    const plan = ProjectManagerDraftSchema.parse(
      JSON.parse(draft.planJson) as unknown,
    );

    const total = plan.creates.length + plan.updates.length + plan.archives.length;

    if (total === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "There is nothing to apply in this plan.",
      });
    }

    const token = mintConfirmationToken({
      userId,
      draftId: input.draftId,
      planHash: draft.planHash,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    await input.ctx.db
      .update(agentProjectManagerDrafts)
      .set({
        status: "confirmed",
        confirmationToken: token,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentProjectManagerDrafts.id, input.draftId));

    return {
      confirmationToken: token,
      summary: {
        creates: plan.creates.length,
        updates: plan.updates.length,
        archives: plan.archives.length,
      },
    };
  },

  async projectManagerApply(input: {
    ctx: TRPCContext;
    draftId: string;
    confirmationToken: string;
  }): Promise<ProjectManagerApplyOutput> {
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

    const plan = ProjectManagerDraftSchema.parse(
      JSON.parse(draft.planJson) as unknown,
    );
    if (hashPlan(plan) !== draft.planHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Plan was modified after confirmation",
      });
    }

    const db = input.ctx.db;
    const results: ProjectManagerApplyOutput["results"] = {
      created: 0,
      updated: 0,
      archived: 0,
      refused: [],
    };

    /** Live org membership, read once and cached per org. */
    const membershipCache = new Map<
      number,
      {
        canCreateProjects: boolean;
        canEditProjects: boolean;
        canDeleteTasks: boolean;
      } | null
    >();

    const getOrgMembership = async (orgId: number) => {
      if (!membershipCache.has(orgId)) {
        const [row] = await db
          .select({
            canCreateProjects: organizationMembers.canCreateProjects,
            canEditProjects: organizationMembers.canEditProjects,
            canDeleteTasks: organizationMembers.canDeleteTasks,
          })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, orgId),
              eq(organizationMembers.userId, userId),
            ),
          )
          .limit(1);
        membershipCache.set(orgId, row ?? null);
      }
      return membershipCache.get(orgId) ?? null;
    };

    // ---- creates
    for (const op of plan.creates) {
      if (op.organizationId !== undefined) {
        const membership = await getOrgMembership(op.organizationId);
        if (!membership?.canCreateProjects) {
          results.refused.push(
            `"${op.title}": you don't have permission to create projects in that organization.`,
          );
          continue;
        }
      }

      await db.insert(projects).values({
        title: op.title,
        description: op.description ?? null,
        createdById: userId,
        organizationId: op.organizationId ?? null,
        status: "active",
      });

      results.created += 1;
      log.info("A6 created project", { title: op.title });
    }

    // ---- updates
    for (const op of plan.updates) {
      const [project] = await db
        .select({
          id: projects.id,
          createdById: projects.createdById,
          organizationId: projects.organizationId,
        })
        .from(projects)
        .where(eq(projects.id, op.projectId))
        .limit(1);

      if (!project) {
        results.refused.push(`"${op.projectTitle}": project not found.`);
        continue;
      }

      if (project.organizationId !== null) {
        const membership = await getOrgMembership(project.organizationId);
        if (!membership?.canEditProjects) {
          results.refused.push(
            `"${op.projectTitle}": you don't have permission to edit projects in that organization.`,
          );
          continue;
        }
      } else if (project.createdById !== userId) {
        results.refused.push(
          `"${op.projectTitle}": you can only edit your own personal projects.`,
        );
        continue;
      }

      const patch: Partial<{
        title: string;
        description: string | null;
        status: "active" | "archived";
        updatedAt: Date;
      }> = { updatedAt: new Date() };
      if (op.patch.title !== undefined) patch.title = op.patch.title;
      if (op.patch.description !== undefined) patch.description = op.patch.description;
      if (op.patch.status !== undefined) patch.status = op.patch.status;

      await db.update(projects).set(patch).where(eq(projects.id, op.projectId));

      results.updated += 1;
    }

    // ---- archives
    for (const op of plan.archives) {
      const [project] = await db
        .select({
          id: projects.id,
          createdById: projects.createdById,
          organizationId: projects.organizationId,
        })
        .from(projects)
        .where(eq(projects.id, op.projectId))
        .limit(1);

      if (!project) {
        results.refused.push(`"${op.projectTitle}": project not found.`);
        continue;
      }

      if (project.organizationId !== null) {
        const membership = await getOrgMembership(project.organizationId);
        if (!membership?.canDeleteTasks) {
          results.refused.push(
            `"${op.projectTitle}": you don't have permission to archive projects in that organization.`,
          );
          continue;
        }
      } else if (project.createdById !== userId) {
        results.refused.push(
          `"${op.projectTitle}": you can only archive your own personal projects.`,
        );
        continue;
      }

      await db
        .update(projects)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(projects.id, op.projectId));

      results.archived += 1;
    }

    await db.insert(agentProjectManagerApplies).values({
      draftId: draft.id,
      userId,
      planHash: draft.planHash,
      resultJson: JSON.stringify(results),
    });

    await db
      .update(agentProjectManagerDrafts)
      .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentProjectManagerDrafts.id, draft.id));

    if (results.refused.length) {
      log.warn("A6 refused part of an approved plan", {
        draftId: draft.id,
        refused: results.refused.length,
      });
    }

    return { applied: true as const, results };
  },
};
