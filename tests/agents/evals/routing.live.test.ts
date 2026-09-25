/**
 * F-1 — the routing eval, against the real model.
 *
 * `routing.test.ts` replays hand-written responses, so it proves the schema and
 * the dispatch and scores 100% by construction. This file sends the same golden
 * set to the configured model and measures what the model actually does:
 *
 * - **Routing accuracy** — intent and target agents both correct. The headline.
 * - **First-pass schema validity** — output the schema accepts *without* a
 *   repair call. The gap between this and final validity is the repair rate,
 *   and every repair is an extra billed completion.
 * - **Tool selection** — for cases that name the tools a correct answer needs,
 *   whether the model called them. Offline this could not be checked at all.
 * - **Tool argument validity** — share of tool calls whose arguments passed the
 *   tool's Zod input schema.
 * - **Latency and tokens** per case, p50 and p95.
 *
 * It runs `runA1Turn`, the same function the product runs — same system prompt,
 * same message order, same tool loop, same parser. Only the tools are stubbed:
 * they answer from a fixed fictional workspace, so a result depends on the model
 * and the prompt and not on whatever the dev database holds today.
 *
 * Not part of `pnpm test`: it costs one to several model calls per case. Run it
 * with `pnpm eval:live`. Each run writes a JSON and a Markdown report to
 * `docs/diploma/evals/`, named by date and model, so runs can be compared.
 *
 * Knobs, all optional:
 *   EVAL_REPEAT=3          run every case N times, to measure consistency
 *   EVAL_FILTER=tasks.     only cases whose id starts with this
 *   EVAL_CONCURRENCY=2     cases in flight at once (free tiers rate-limit hard)
 *   EVAL_MIN_ROUTING=0.85  fail the run below this routing accuracy
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

// A repair or an extra tool hop records a hit against the caller's AI budget.
// The eval user does not exist, and the budget lives in the database.
vi.mock("~/server/security/rateLimit", () => ({
  recordExtraAiCall: async () => undefined,
}));
// Every tool is stubbed below, so nothing may reach a real connection.
vi.mock("~/server/db", () => ({ db: {} }));

import type { TRPCContext } from "~/server/api/trpc";
import type { A1ContextPack } from "~/server/llm/context/a1ContextBuilder";
import { resolveLlmConfig } from "~/server/llm/core/providers";
import { isLlmConfigured } from "~/server/llm/core/modelClient";
import type { LoopTool } from "~/server/llm/core/toolLoop";
import { runA1Turn } from "~/server/llm/orchestrator/a1Concierge";
import { a1WorkspaceConciergeProfile } from "~/server/llm/profiles/a1WorkspaceConcierge";
import { A1_READ_TOOLS } from "~/server/llm/tools/a1/readTools";
import type { A1ReadToolName } from "~/server/llm/tools/a1/types";

import { EVAL_CASES, type EvalCase, type TargetAgent } from "./cases";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const REPEAT = Math.max(1, Number(process.env.EVAL_REPEAT ?? 1));
const FILTER = process.env.EVAL_FILTER ?? "";
const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 1));
const MIN_ROUTING = Number(process.env.EVAL_MIN_ROUTING ?? 0.85);

/** A Monday, fixed, so "this week" means the same thing on every run. */
const NOW = "2026-09-21T09:00:00.000Z";
const EVAL_USER_ID = "eval-user";

// ---------------------------------------------------------------------------
// The fictional workspace
// ---------------------------------------------------------------------------

const PROJECTS = [
  { id: 1, title: "Project Alpha", status: "active" },
  { id: 2, title: "Website", status: "active" },
  { id: 3, title: "Internal Tools", status: "active" },
];

const MEMBERS = [
  { userId: "u-maria", name: "Maria Petrova", role: "member" },
  { userId: "u-martin", name: "Martin Ivanov", role: "member" },
  { userId: "u-ivan", name: "Ivan Georgiev", role: "member" },
  { userId: "u-peter", name: "Peter Dimitrov", role: "member" },
  { userId: EVAL_USER_ID, name: "Eval User", role: "owner" },
];

const TASKS = [
  { id: 42, projectId: 1, title: "Build the payments API", status: "blocked", assignee: "Ivan Georgiev", dueDate: "2026-09-18", blockedBy: [41] },
  { id: 41, projectId: 1, title: "Agree the payment provider contract", status: "in_progress", assignee: "Maria Petrova", dueDate: "2026-09-17" },
  { id: 43, projectId: 1, title: "Deployment pipeline", status: "todo", assignee: "Eval User", dueDate: "2026-09-23" },
  { id: 44, projectId: 2, title: "Onboarding redesign", status: "todo", assignee: "Eval User", dueDate: "2026-09-25" },
  { id: 45, projectId: 2, title: "Onboarding redesign (copy)", status: "todo", assignee: null, dueDate: null },
];

/**
 * What each stubbed tool returns.
 *
 * Deliberately plausible rather than exhaustive: the eval scores routing and
 * tool choice, not the prose of the answer, so a tool only has to give the
 * model enough to answer instead of calling it again. Anything unlisted
 * returns an empty result.
 */
const FIXTURES: Partial<Record<A1ReadToolName, (input: Record<string, unknown>) => unknown>> = {
  getSessionContext: () => ({ userId: EVAL_USER_ID, email: "eval@example.com", name: "Eval User", activeOrganizationId: 1 }),
  listProjects: () => PROJECTS,
  listOrganizations: () => [{ id: 1, name: "Design", role: "owner", memberCount: MEMBERS.length }],
  listOrgMembers: () => MEMBERS,
  getProjectDetail: (i) => ({ ...(PROJECTS.find((p) => p.id === i.projectId) ?? PROJECTS[0]), collaborators: MEMBERS.slice(0, 3) }),
  getProjectHealth: (i) => ({ projectId: i.projectId ?? 1, completionRate: 0.62, overdue: 3, blocked: 1, risks: ["Payments API blocked on the provider contract"] }),
  listProjectCollaborators: () => MEMBERS.map((m) => ({ ...m, canEdit: m.role !== "member" || m.name === "Maria Petrova" })),
  listTasks: (i) => TASKS.filter((t) => i.projectId === undefined || t.projectId === i.projectId),
  getTaskDetail: (i) => TASKS.find((t) => t.id === i.taskId) ?? TASKS[0],
  listTaskComments: () => [{ author: "Maria Petrova", body: "Waiting on the signed contract.", createdAt: "2026-09-19T14:00:00Z" }],
  getTaskActivity: () => [{ at: "2026-09-21T08:00:00Z", by: "Ivan Georgiev", change: "status: in_progress → blocked" }],
  getTaskDependencies: () => ({ blockedBy: [TASKS[1]], blocks: [] }),
  listMyWork: () => TASKS.filter((t) => t.assignee === "Eval User"),
  getWorkloadByAssignee: () => [
    { assignee: "Ivan Georgiev", open: 14, overdue: 5 },
    { assignee: "Maria Petrova", open: 6, overdue: 0 },
  ],
  getCalendarRange: () => ({ tasks: TASKS.filter((t) => t.dueDate), events: [{ title: "Kickoff", startsAt: "2026-09-24T10:00:00Z" }] }),
  listEventsPublic: () => [{ id: 7, title: "Kickoff", startsAt: "2026-09-24T10:00:00Z", region: "Varna" }],
  listEventRsvps: () => ({ eventId: 7, going: 12, maybe: 3, notGoing: 1 }),
  listNotesMetadata: () => [{ id: 3, title: "Payment flow risks", updatedAt: "2026-09-15T10:00:00Z" }],
  listNotifications: () => [],
  searchWorkspace: () => [
    { kind: "task", id: 44, title: "Onboarding redesign", snippet: "Discussed in the Website project" },
    { kind: "note", id: 3, title: "Payment flow risks", snippet: "Provider contract is the blocker" },
  ],
  searchDocuments: () => [],
  rememberFact: (i) => ({ stored: true, key: i.key ?? "fact" }),
  forgetFact: () => ({ removed: true }),
  listReminders: () => [],
  scheduleReminder: () => ({ reminderId: 1, fireAt: "2026-09-25T09:00:00Z" }),
  cancelReminder: () => ({ cancelled: true }),
};

/**
 * Stubs with the real input schemas.
 *
 * The arguments are still validated by each tool's own Zod schema, so a model
 * that calls the right tool with the wrong arguments is scored as it would be
 * in production: the call fails and the model has to recover.
 */
function stubRegistry(calls: string[]): Record<string, LoopTool> {
  const registry: Record<string, LoopTool> = {};
  for (const name of a1WorkspaceConciergeProfile.draftToolAllowlist) {
    registry[name] = {
      name,
      inputSchema: A1_READ_TOOLS[name].inputSchema,
      execute: async (_ctx, input: never) => {
        calls.push(name);
        return FIXTURES[name]?.(input as Record<string, unknown>) ?? [];
      },
    };
  }
  return registry;
}

function contextFor(testCase: EvalCase): A1ContextPack {
  return {
    session: { userId: EVAL_USER_ID, email: "eval@example.com", name: "Eval User", activeOrganizationId: 1 },
    projects: PROJECTS,
    scopedProjectId: testCase.live?.scopedProjectId ?? null,
    locale: "en",
    memory: [],
    now: NOW,
  };
}

const FAKE_CTX = {
  session: { user: { id: EVAL_USER_ID } },
  db: {},
} as unknown as TRPCContext;

// ---------------------------------------------------------------------------
// One run of one case
// ---------------------------------------------------------------------------

interface CaseRun {
  id: string;
  category: string;
  nonEnglish: boolean;
  routed: boolean;
  schemaFirstPass: boolean;
  schemaFinal: boolean;
  /** `null` when the case names no required tools. */
  toolsOk: boolean | null;
  toolCalls: number;
  toolCallsValid: number;
  latencyMs: number;
  totalTokens: number;
  expected: string;
  actual: string;
  error?: string;
  /** The model's final text, kept only for misrouted runs so they can be read. */
  raw?: string;
}

function describeRoute(intent: string, agents: readonly string[]): string {
  return agents.length > 0 ? `${intent} → ${[...agents].sort().join(", ")}` : intent;
}

async function runCase(testCase: EvalCase): Promise<CaseRun> {
  const calls: string[] = [];
  const expectedAgents: readonly TargetAgent[] = testCase.expect.agents ?? [];
  const base = {
    id: testCase.id,
    category: testCase.id.split(".")[0] ?? "other",
    // Anything outside ASCII: Cyrillic, accented Latin, Japanese.
    nonEnglish: /[^\x00-\x7F]/.test(testCase.message),
    expected: describeRoute(testCase.expect.intent, expectedAgents),
  };

  const startedAt = Date.now();
  try {
    const { loop, parsed } = await runA1Turn({
      ctx: FAKE_CTX,
      userId: EVAL_USER_ID,
      contextPack: contextFor(testCase),
      message: testCase.message,
      conversationHistory: testCase.live?.history,
      registry: stubRegistry(calls),
    });
    const latencyMs = Date.now() - startedAt;

    const required = testCase.expect.toolsUsed;
    const toolsOk = required ? required.every((t) => calls.includes(t)) : null;
    const toolCallsValid = loop.toolCallsMade.filter((c) => c.ok).length;
    const common = {
      ...base,
      toolsOk,
      toolCalls: loop.toolCallsMade.length,
      toolCallsValid,
      latencyMs,
      totalTokens: loop.usage.totalTokens,
    };

    if (!parsed?.success) {
      return {
        ...common,
        routed: false,
        schemaFirstPass: false,
        schemaFinal: false,
        actual: parsed === null ? "(tool budget exhausted)" : "(invalid output)",
        error: parsed === null ? "tool budget exhausted" : parsed.error,
        raw: loop.content,
      };
    }

    const out = parsed.data;
    const agents = out.intent.type === "handoff" ? out.handoffs.map((h) => h.targetAgent) : [];
    const routed =
      out.intent.type === testCase.expect.intent &&
      [...agents].sort().join(",") === [...expectedAgents].sort().join(",");

    return {
      ...common,
      routed,
      schemaFirstPass: parsed.repairCount === 0,
      schemaFinal: true,
      actual: describeRoute(out.intent.type, agents),
      ...(routed ? {} : { raw: loop.content }),
    };
  } catch (err) {
    return {
      ...base,
      routed: false,
      schemaFirstPass: false,
      schemaFinal: false,
      toolsOk: testCase.expect.toolsUsed ? false : null,
      toolCalls: 0,
      toolCallsValid: 0,
      latencyMs: Date.now() - startedAt,
      totalTokens: 0,
      actual: "(model error)",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runAll(
  cases: EvalCase[],
  onProgress: (runs: CaseRun[]) => void,
): Promise<CaseRun[]> {
  const queue = Array.from({ length: REPEAT }, () => cases).flat();
  const results: CaseRun[] = [];
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < queue.length) {
      const testCase = queue[next++]!;
      const run = await runCase(testCase);
      results.push(run);
      done++;
      // Written after every case, not once at the end: a slow free tier can
      // outlast the test timeout, and a run that dies at 40/55 should still
      // leave its 40 results behind.
      onProgress(results);
      console.log(
        `  [${String(done)}/${String(queue.length)}] ${run.routed ? "✓" : "✗"} ${run.id}` +
          (run.routed ? "" : `  expected ${run.expected}, got ${run.actual}`),
      );
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function rate(runs: CaseRun[], pick: (r: CaseRun) => boolean | null): { hit: number; of: number; pct: number } {
  const scored = runs.filter((r) => pick(r) !== null);
  const hit = scored.filter((r) => pick(r) === true).length;
  return { hit, of: scored.length, pct: scored.length ? hit / scored.length : 0 };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function summarize(runs: CaseRun[]) {
  const toolCalls = runs.reduce((n, r) => n + r.toolCalls, 0);
  const toolCallsValid = runs.reduce((n, r) => n + r.toolCallsValid, 0);
  const latencies = runs.map((r) => r.latencyMs);

  const categories = [...new Set(runs.map((r) => r.category))].sort();
  const byCategory = Object.fromEntries(
    categories.map((c) => [c, rate(runs.filter((r) => r.category === c), (r) => r.routed)]),
  );

  // A case is consistent when every repeat routed it correctly. Only
  // meaningful with EVAL_REPEAT > 1.
  const ids = [...new Set(runs.map((r) => r.id))];
  const consistent = ids.filter((id) => runs.filter((r) => r.id === id).every((r) => r.routed)).length;

  return {
    routing: rate(runs, (r) => r.routed),
    schemaFirstPass: rate(runs, (r) => r.schemaFirstPass),
    schemaFinal: rate(runs, (r) => r.schemaFinal),
    toolSelection: rate(runs, (r) => r.toolsOk),
    toolArgValidity: { hit: toolCallsValid, of: toolCalls, pct: toolCalls ? toolCallsValid / toolCalls : 0 },
    english: rate(runs.filter((r) => !r.nonEnglish), (r) => r.routed),
    nonEnglish: rate(runs.filter((r) => r.nonEnglish), (r) => r.routed),
    byCategory,
    consistency: { hit: consistent, of: ids.length, pct: ids.length ? consistent / ids.length : 0 },
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    avgTokens: runs.length ? Math.round(runs.reduce((n, r) => n + r.totalTokens, 0) / runs.length) : 0,
    errors: runs.filter((r) => r.actual === "(model error)").length,
  };
}

const pct = (r: { hit: number; of: number; pct: number }) =>
  `${(r.pct * 100).toFixed(1)}% (${String(r.hit)}/${String(r.of)})`;

function markdownReport(meta: Record<string, unknown>, s: ReturnType<typeof summarize>, runs: CaseRun[]): string {
  const failures = runs.filter((r) => !r.routed);
  return [
    `# A1 routing eval — ${String(meta.date)}`,
    "",
    `Model chain: \`${String(meta.models)}\` · cases: ${String(meta.cases)} · repeats: ${String(meta.repeat)}${FILTER ? ` · filter: \`${FILTER}\`` : ""}`,
    "",
    "| Metric | Result |",
    "|---|---|",
    `| Routing accuracy | ${pct(s.routing)} |`,
    `| Schema validity, first pass | ${pct(s.schemaFirstPass)} |`,
    `| Schema validity, after repair | ${pct(s.schemaFinal)} |`,
    `| Tool selection | ${pct(s.toolSelection)} |`,
    `| Tool argument validity | ${pct(s.toolArgValidity)} |`,
    `| Routing, English | ${pct(s.english)} |`,
    `| Routing, other languages | ${pct(s.nonEnglish)} |`,
    ...(REPEAT > 1 ? [`| Consistent across repeats | ${pct(s.consistency)} |`] : []),
    `| Latency p50 / p95 | ${String(s.latencyMs.p50)} ms / ${String(s.latencyMs.p95)} ms |`,
    `| Tokens per case (avg) | ${String(s.avgTokens)} |`,
    `| Model errors | ${String(s.errors)} |`,
    "",
    "## By category",
    "",
    "| Category | Routing |",
    "|---|---|",
    ...Object.entries(s.byCategory).map(([c, r]) => `| ${c} | ${pct(r)} |`),
    "",
    "## Misrouted",
    "",
    ...(failures.length === 0
      ? ["None."]
      : [
          "| Case | Expected | Got |",
          "|---|---|---|",
          ...failures.map((f) => `| \`${f.id}\` | ${f.expected} | ${f.actual}${f.error ? ` — ${f.error.slice(0, 80)}` : ""} |`),
        ]),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

describe.skipIf(!isLlmConfigured())("A1 routing eval (live model)", () => {
  it("routes the golden set correctly", async () => {
    const cases = EVAL_CASES.filter((c) => c.id.startsWith(FILTER));
    expect(cases.length, `no case id starts with "${FILTER}"`).toBeGreaterThan(0);

    const models = resolveLlmConfig(process.env).models.join(" → ");
    const date = new Date().toISOString().slice(0, 10);

    const dir = path.resolve(process.cwd(), "docs/diploma/evals");
    mkdirSync(dir, { recursive: true });
    const slug = (resolveLlmConfig(process.env).models[0] ?? "model").replace(/[^a-z0-9.-]+/gi, "-");
    // A filtered run is a probe, not a result: it must not overwrite the full
    // report for the same day and model.
    const suffix = FILTER ? `-only-${FILTER.replace(/[^a-z0-9-]+/gi, "-")}` : "";
    const base = path.join(dir, `a1-routing-${date}-${slug}${suffix}`);
    const write = (runs: CaseRun[]) => {
      const summary = summarize(runs);
      const total = cases.length * REPEAT;
      const meta = {
        date,
        models,
        cases: cases.length,
        repeat: REPEAT,
        filter: FILTER || null,
        completed: `${String(runs.length)}/${String(total)}`,
      };
      writeFileSync(`${base}.json`, JSON.stringify({ meta, summary, runs }, null, 2));
      const md = markdownReport(meta, summary, runs);
      writeFileSync(
        `${base}.md`,
        runs.length === total ? md : `${md}\n_Incomplete: ${meta.completed} runs finished._\n`,
      );
      return summary;
    };

    const runs = await runAll(cases, write);
    const summary = write(runs);

    console.log(
      `\n  live eval: routing ${pct(summary.routing)} · schema first pass ${pct(summary.schemaFirstPass)}` +
        ` · tools ${pct(summary.toolSelection)} · p50 ${String(summary.latencyMs.p50)} ms` +
        `\n  report: ${path.relative(process.cwd(), base)}.md`,
    );

    expect(summary.routing.pct).toBeGreaterThanOrEqual(MIN_ROUTING);
  });
});
