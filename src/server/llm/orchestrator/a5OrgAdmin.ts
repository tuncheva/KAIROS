/**
 * A5 — Org Admin: draft, confirm and apply membership changes.
 *
 * Same lifecycle as A2/A3/A4 — a persisted draft, a hash, an HMAC confirmation
 * token, an audit row — with one difference that runs through the whole module:
 * **every operation is authorized individually at apply time.**
 *
 * The other agents check access once per plan, which is right for them: a task
 * plan touches one project, so one `assertProjectAccess` covers it. An org plan
 * can span several organizations, and each operation within it depends on a
 * different capability flag — `canManageRoles` for a role change, `canKickMembers`
 * for a removal, `canAddMembers` for an invite. Checking once would mean the
 * weakest operation in the plan rode in on the strongest one's permission.
 *
 * Refusals do not abort the apply. If the plan asks for four things and the
 * caller may do three, three happen and the fourth comes back in `refused` with
 * a reason — an all-or-nothing failure here would mean one stale row in the
 * draft (someone left the org between draft and apply) discards work the user
 * already reviewed and approved.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { flagsForRole, type PermissionFlag } from "~/lib/permissions";
import type { TRPCContext } from "~/server/api/trpc";
import {
  agentOrgAdminApplies,
  agentOrgAdminDrafts,
  organizationInvites,
  organizationMembers,
} from "~/server/db/schema";
import { buildA5Context } from "~/server/llm/context/a5ContextBuilder";
import { completeJson } from "~/server/llm/core/jsonRepair";
import { getA5SystemPrompt } from "~/server/llm/prompts/a5Prompts";
import { languageAnchorMessages } from "~/server/llm/prompts/languageRules";
import { localized, type LocalizedText } from "~/server/llm/locale";
import {
  OrgAdminDraftSchema,
  type OrgAdminApplyOutput,
  type OrgAdminDraft,
} from "~/server/llm/schemas/a5OrgAdminSchemas";
import { createLogger } from "~/server/logger";

import {
  computePlanHash,
  createDraftId,
  mintConfirmationToken,
  readConfirmationToken,
  requireUserId,
} from "./shared";

const log = createLogger("agent.a5");

/** Invites live for a week, matching the organization router's own flow. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function loadDraft(ctx: TRPCContext, draftId: string, userId: string) {
  const [draft] = await ctx.db
    .select({
      id: agentOrgAdminDrafts.id,
      userId: agentOrgAdminDrafts.userId,
      planJson: agentOrgAdminDrafts.planJson,
      planHash: agentOrgAdminDrafts.planHash,
      status: agentOrgAdminDrafts.status,
      confirmationToken: agentOrgAdminDrafts.confirmationToken,
    })
    .from(agentOrgAdminDrafts)
    .where(eq(agentOrgAdminDrafts.id, draftId))
    .limit(1);

  if (!draft) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
  }
  if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
  return draft;
}

/** Hash over the plan minus its own embedded hash, as the other agents do. */
function hashPlan(plan: OrgAdminDraft): string {
  const { planHash: _embedded, ...rest } = plan;
  return computePlanHash(rest);
}

interface CallerMembership {
  role: string;
  canAddMembers: boolean;
  canKickMembers: boolean;
  canManageRoles: boolean;
}

/**
 * The caller's live membership row, read at apply time.
 *
 * Deliberately not taken from the draft: minutes can pass between drafting and
 * applying, and an admin who was demoted in that window must not still be able
 * to run the plan they drafted while they had the role.
 */
async function callerMembership(
  ctx: TRPCContext,
  organizationId: number,
  userId: string,
): Promise<CallerMembership | null> {
  const [row] = await ctx.db
    .select({
      role: organizationMembers.role,
      canAddMembers: organizationMembers.canAddMembers,
      canKickMembers: organizationMembers.canKickMembers,
      canManageRoles: organizationMembers.canManageRoles,
    })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** How many members currently hold a role that can manage roles. */
async function adminCount(
  ctx: TRPCContext,
  organizationId: number,
): Promise<number> {
  const rows = await ctx.db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId));

  return rows.filter((r) => flagsForRole(r.role).canManageRoles).length;
}

/**
 * Written by this server, not the model — there is no model call on this path —
 * so it needs its own translation rather than inheriting the reply language.
 */
const NO_ADMIN_RIGHTS_SUMMARY: LocalizedText = {
  en: "You don't have permission to manage membership in any of your organizations, so there's nothing I can change here. An organization admin can grant you that.",
  bg: "Нямате права да управлявате членството в нито една от вашите организации, затова тук няма какво да променя. Администратор на организацията може да ви ги даде.",
};

export const a5OrgAdmin = {
  async orgAdminDraft(input: {
    ctx: TRPCContext;
    message: string;
    organizationId?: number;
    handoffContext?: Record<string, unknown>;
    /**
     * The user's own words this turn, when `message` is another agent's
     * paraphrase of them. Used to pin the reply language, nothing else.
     */
    originalMessage?: string;
  }): Promise<{ draftId: string; plan: OrgAdminDraft }> {
    const userId = requireUserId(input.ctx);
    const draftId = createDraftId();

    const contextPack = await buildA5Context({
      ctx: input.ctx,
      organizationId: input.organizationId,
    });

    // Nothing to draft against. Said here rather than letting the model produce
    // a plausible plan for an organization the user cannot administer.
    if (contextPack.organizations.length === 0) {
      const plan: OrgAdminDraft = {
        summary: localized(NO_ADMIN_RIGHTS_SUMMARY, contextPack.locale),
        roleChanges: [],
        permissionChanges: [],
        removals: [],
        invites: [],
        warnings: [],
        questions: [],
      };
      const planHash = hashPlan(plan);
      const stored = { ...plan, planHash };

      await input.ctx.db.insert(agentOrgAdminDrafts).values({
        id: draftId,
        userId,
        message: input.message,
        planJson: JSON.stringify(stored),
        planHash,
        status: "draft",
      });

      return { draftId, plan: stored };
    }

    const systemPrompt = getA5SystemPrompt(
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
      schema: OrgAdminDraftSchema,
      temperature: 0.2,
      purpose: "a5.draft",
      userId,
    });

    if (!parseResult.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid A5 plan JSON: ${parseResult.error}`,
      });
    }

    // Draft-time guardrails. These are a relevance filter, not the authorization
    // boundary — apply re-checks everything — but dropping impossible operations
    // here keeps them off the confirmation card, where their presence would read
    // as a promise.
    const administrable = new Map(
      contextPack.organizations.map((o) => [o.id, o]),
    );

    const inScope = <T extends { organizationId: number }>(op: T): boolean =>
      administrable.has(op.organizationId);

    const notSelf = <T extends { targetUserId: string }>(op: T): boolean =>
      op.targetUserId !== userId;

    const raw = parseResult.data;
    const guarded: OrgAdminDraft = {
      ...raw,
      roleChanges: raw.roleChanges.filter(
        (op) =>
          inScope(op) &&
          notSelf(op) &&
          (administrable.get(op.organizationId)?.myFlags.canManageRoles ??
            false),
      ),
      permissionChanges: raw.permissionChanges.filter(
        (op) =>
          inScope(op) &&
          notSelf(op) &&
          (administrable.get(op.organizationId)?.myFlags.canManageRoles ??
            false),
      ),
      removals: raw.removals.filter(
        (op) =>
          inScope(op) &&
          notSelf(op) &&
          (administrable.get(op.organizationId)?.myFlags.canKickMembers ??
            false),
      ),
      invites: raw.invites.filter(
        (op) =>
          inScope(op) &&
          (administrable.get(op.organizationId)?.myFlags.canAddMembers ??
            false),
      ),
    };

    const planHash = hashPlan(guarded);
    const plan: OrgAdminDraft = { ...guarded, planHash };

    await input.ctx.db.insert(agentOrgAdminDrafts).values({
      id: draftId,
      userId,
      message: input.message,
      planJson: JSON.stringify(plan),
      planHash,
      status: "draft",
    });

    return { draftId, plan };
  },

  async orgAdminConfirm(input: { ctx: TRPCContext; draftId: string }): Promise<{
    confirmationToken: string;
    summary: {
      roleChanges: number;
      permissionChanges: number;
      removals: number;
      invites: number;
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

    const plan = OrgAdminDraftSchema.parse(
      JSON.parse(draft.planJson) as unknown,
    );

    const total =
      plan.roleChanges.length +
      plan.permissionChanges.length +
      plan.removals.length +
      plan.invites.length;

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
      .update(agentOrgAdminDrafts)
      .set({
        status: "confirmed",
        confirmationToken: token,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentOrgAdminDrafts.id, input.draftId));

    return {
      confirmationToken: token,
      summary: {
        roleChanges: plan.roleChanges.length,
        permissionChanges: plan.permissionChanges.length,
        removals: plan.removals.length,
        invites: plan.invites.length,
      },
    };
  },

  async orgAdminApply(input: {
    ctx: TRPCContext;
    draftId: string;
    confirmationToken: string;
  }): Promise<OrgAdminApplyOutput> {
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

    const plan = OrgAdminDraftSchema.parse(
      JSON.parse(draft.planJson) as unknown,
    );
    if (hashPlan(plan) !== draft.planHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Plan was modified after confirmation",
      });
    }

    const db = input.ctx.db;
    const results: OrgAdminApplyOutput["results"] = {
      rolesChanged: 0,
      permissionsChanged: 0,
      membersRemoved: 0,
      invitesSent: 0,
      refused: [],
    };

    /** Live membership per org, read once and reused across operations. */
    const callerCache = new Map<number, CallerMembership | null>();
    const caller = async (orgId: number) => {
      if (!callerCache.has(orgId)) {
        callerCache.set(
          orgId,
          await callerMembership(db as never, orgId, userId),
        );
      }
      return callerCache.get(orgId) ?? null;
    };

    // ---- role changes
    for (const op of plan.roleChanges) {
      const me = await caller(op.organizationId);

      // Mirrors `organization.updateMemberRole` exactly: the flag alone is not
      // enough, the role must be admin too. Two paths to the same write must not
      // disagree about who may take it.
      if (me?.role !== "admin" || !me.canManageRoles) {
        results.refused.push(
          `${op.targetName}: you no longer have permission to change roles in that organization.`,
        );
        continue;
      }
      if (op.targetUserId === userId) {
        results.refused.push(
          `${op.targetName}: you cannot change your own role.`,
        );
        continue;
      }

      // Would this demote the last remaining administrator?
      if (!flagsForRole(op.newRole).canManageRoles) {
        const [target] = await db
          .select({ role: organizationMembers.role })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, op.organizationId),
              eq(organizationMembers.userId, op.targetUserId),
            ),
          )
          .limit(1);

        if (target && flagsForRole(target.role).canManageRoles) {
          const admins = await adminCount(db as never, op.organizationId);
          if (admins <= 1) {
            results.refused.push(
              `${op.targetName}: they are the only administrator left, so this would lock the organization out of its own settings.`,
            );
            continue;
          }
        }
      }

      const updated = await db
        .update(organizationMembers)
        .set({ role: op.newRole, ...flagsForRole(op.newRole) })
        .where(
          and(
            eq(organizationMembers.organizationId, op.organizationId),
            eq(organizationMembers.userId, op.targetUserId),
          ),
        )
        .returning({ id: organizationMembers.id });

      if (updated[0]) results.rolesChanged += 1;
      else
        results.refused.push(`${op.targetName}: they are no longer a member.`);
    }

    // ---- permission changes
    for (const op of plan.permissionChanges) {
      const me = await caller(op.organizationId);
      if (me?.role !== "admin" || !me.canManageRoles) {
        results.refused.push(
          `${op.targetName}: you no longer have permission to change capabilities in that organization.`,
        );
        continue;
      }
      if (op.targetUserId === userId) {
        results.refused.push(
          `${op.targetName}: you cannot change your own permissions.`,
        );
        continue;
      }

      // Revoking the last `canManageRoles` is the same lockout as a demotion.
      if (op.revoke.includes("canManageRoles")) {
        const admins = await adminCount(db as never, op.organizationId);
        if (admins <= 1) {
          results.refused.push(
            `${op.targetName}: that would remove the last administrator's ability to manage roles.`,
          );
          continue;
        }
      }

      const patch: Partial<Record<PermissionFlag, boolean>> = {};
      for (const flag of op.grant) patch[flag] = true;
      // Revoke wins on a flag named in both — the safer reading of a
      // contradictory plan.
      for (const flag of op.revoke) patch[flag] = false;

      if (Object.keys(patch).length === 0) continue;

      const updated = await db
        .update(organizationMembers)
        .set(patch)
        .where(
          and(
            eq(organizationMembers.organizationId, op.organizationId),
            eq(organizationMembers.userId, op.targetUserId),
          ),
        )
        .returning({ id: organizationMembers.id });

      if (updated[0]) results.permissionsChanged += 1;
      else
        results.refused.push(`${op.targetName}: they are no longer a member.`);
    }

    // ---- removals
    for (const op of plan.removals) {
      const me = await caller(op.organizationId);
      if (!me?.canKickMembers) {
        results.refused.push(
          `${op.targetName}: you no longer have permission to remove members from that organization.`,
        );
        continue;
      }
      if (op.targetUserId === userId) {
        results.refused.push(
          `${op.targetName}: use "leave organization" to remove yourself.`,
        );
        continue;
      }

      const [target] = await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, op.organizationId),
            eq(organizationMembers.userId, op.targetUserId),
          ),
        )
        .limit(1);

      if (!target) {
        results.refused.push(`${op.targetName}: they are no longer a member.`);
        continue;
      }

      if (flagsForRole(target.role).canManageRoles) {
        const admins = await adminCount(db as never, op.organizationId);
        if (admins <= 1) {
          results.refused.push(
            `${op.targetName}: they are the only administrator left.`,
          );
          continue;
        }
      }

      const removed = await db
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, op.organizationId),
            eq(organizationMembers.userId, op.targetUserId),
          ),
        )
        .returning({ id: organizationMembers.id });

      if (removed[0]) results.membersRemoved += 1;
    }

    // ---- invites
    for (const op of plan.invites) {
      const me = await caller(op.organizationId);
      if (!me?.canAddMembers) {
        results.refused.push(
          `${op.email}: you no longer have permission to invite people to that organization.`,
        );
        continue;
      }

      // Only an admin may invite somebody straight into an administrative role.
      // Without this, `canAddMembers` alone would be a privilege-escalation path:
      // invite an accomplice as admin, and the organization has a second owner.
      if (flagsForRole(op.role).canManageRoles && me.role !== "admin") {
        results.refused.push(
          `${op.email}: only an admin can invite someone as an administrator.`,
        );
        continue;
      }

      await db.insert(organizationInvites).values({
        organizationId: op.organizationId,
        email: op.email.toLowerCase(),
        role: op.role,
        invitedById: userId,
        status: "pending",
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      });
      results.invitesSent += 1;
    }

    await db.insert(agentOrgAdminApplies).values({
      draftId: draft.id,
      userId,
      planHash: draft.planHash,
      resultJson: JSON.stringify(results),
    });

    await db
      .update(agentOrgAdminDrafts)
      .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentOrgAdminDrafts.id, draft.id));

    if (results.refused.length) {
      log.warn("A5 refused part of an approved plan", {
        draftId: draft.id,
        refused: results.refused.length,
      });
    }

    return { applied: true as const, results };
  },
};
