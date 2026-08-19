/**
 * Shared plumbing for the agent orchestrators.
 *
 * `agentOrchestrator.ts` was 1,647 lines holding four unrelated agents in one
 * object literal. It splits cleanly along the A1/A2/A3/A4 seams it already had as
 * comment banners, and this module is what they all depend on: the draft-id and
 * plan-hash helpers, the confirmation-token codec, and the caller-identity guards.
 *
 * Everything here was previously private to that file. It is exported now because
 * the agents live in separate modules; none of it is part of the public API, which
 * remains the `agentOrchestrator` object.
 */

import {
  TRPCError,
} from "@trpc/server";
import crypto from "node:crypto";
import {
} from "drizzle-orm";
import {
  env,
} from "~/env";
import type {
  TRPCContext,
} from "~/server/api/trpc";

import {
  type A1Output,
} from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import {
  type TaskPlanDraft,
} from "~/server/llm/schemas/a2TaskPlannerSchemas";
import {
  type NotesVaultDraft,
} from "~/server/llm/schemas/a3NotesVaultSchemas";

import {
  createLogger,
} from "~/server/logger";

/** Shared scope, so every agent logs under the same name as before the split. */
export const log = createLogger("agent.orchestrator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentId = "workspace_concierge" | "task_planner" | "notes_vault" | "events_publisher";

export interface AgentDraftInput {
  ctx: TRPCContext;
  agentId: AgentId;
  message: string;
  scope?: {
    orgId?: string | number;
    projectId?: string | number;
  };
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AgentDraftResult {
  draftId: string;
  outputJson: A1Output | TaskPlanDraft | NotesVaultDraft;
}

export interface TaskDraftInput {
  ctx: TRPCContext;
  projectId: number;
  message?: string;
}

export interface PdfTaskInput {
  ctx: TRPCContext;
  projectId: number;
  pdfBase64: string;
  fileName?: string;
  message?: string;
}

export function createDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function requireUserId(ctx: TRPCContext): string {
  const userId = ctx.session?.user?.id;
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return userId;
}

export function requireProjectId(scope?: { projectId?: string | number }): number {
  const pid = scope?.projectId;
  if (typeof pid === "number") return pid;
  throw new TRPCError({ code: "BAD_REQUEST", message: "projectId is required" });
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

export function computePlanHash(plan: unknown): string {
  return crypto.createHash("sha256").update(stableJson(plan)).digest("hex");
}

export type ConfirmationTokenPayload = {
  userId: string;
  draftId: string;
  planHash: string;
  expiresAt: number;
};

export function mintConfirmationToken(payload: ConfirmationTokenPayload): string {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AUTH_SECRET is not configured" });
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

export function readConfirmationToken(token: string): ConfirmationTokenPayload {
  try {
    const secret = env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not configured");

    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) throw new Error("Malformed token");

    const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
    if (expected.length !== sig.length) throw new Error("Signature mismatch");

    const sigBuf = Buffer.from(sig, "base64url");
    const expectedBuf = Buffer.from(expected, "base64url");
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) throw new Error("Signature mismatch");

    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    return JSON.parse(raw) as ConfirmationTokenPayload;
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid confirmation token" });
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
