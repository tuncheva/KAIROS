/**
 * Page context, against the real model: the same message with and without it.
 *
 * The TopBar's AI button sends "look at this note and tell me what you can do
 * with it". Without a page the model cannot know which note — the honest answer
 * is a question back, the dishonest one a guess. With the page it should answer
 * about that note at once. This eval measures exactly that difference, so the
 * claim "the agent understands where the user is" rests on a run rather than on
 * the prompt reading well.
 *
 * Every scenario runs twice through `runA1Turn` — the product's own prompt,
 * message order, tool loop and parser — once bare and once with the page
 * message the server would add. Tools are stubbed over a small fixed
 * workspace, as in the routing eval.
 *
 * Checked automatically, on the with-page run:
 *   - no clarify: it did not ask which note/project was meant
 *   - grounded: it cited the page, or looked it up by its id
 *   - follow-ups: the opener came back with next steps to tap
 *   - language: a Bulgarian message got a Bulgarian answer
 * The bare run is recorded, not scored — it is the baseline.
 *
 * Run: `pnpm eval:live tests/agents/evals/pageContext.live.test.ts` (no `--`).
 * Writes `docs/diploma/evals/page-context-<date>-<model>.{json,md}`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/security/rateLimit", () => ({
  recordExtraAiCall: async () => undefined,
}));
vi.mock("~/server/db", () => ({ db: {} }));

import type { TRPCContext } from "~/server/api/trpc";
import type { A1ContextPack } from "~/server/llm/context/a1ContextBuilder";
import { isLlmConfigured } from "~/server/llm/core/modelClient";
import { resolveLlmConfig } from "~/server/llm/core/providers";
import type { LoopTool } from "~/server/llm/core/toolLoop";
import { runA1Turn } from "~/server/llm/orchestrator/a1Concierge";
import { a1WorkspaceConciergeProfile } from "~/server/llm/profiles/a1WorkspaceConcierge";
import type { ResolvedPageContext } from "~/server/llm/prompts/pageContext";
import type { A1Output } from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import { A1_READ_TOOLS } from "~/server/llm/tools/a1/readTools";
import type { A1ReadToolName } from "~/server/llm/tools/a1/types";

const NOW = "2026-10-19T06:30:00.000Z";
const USER = "eval-user";

// ---------------------------------------------------------------------------
// The workspace
// ---------------------------------------------------------------------------

const PROJECTS = [
  { id: 1, title: "Project Alpha", status: "active" },
  { id: 2, title: "Website", status: "active" },
];

const NOTES = [
  {
    id: 3,
    title: "Payment flow risks",
    content: `Payment flow — risks from Thursday's review

- Provider contract still unsigned; legal says next Wednesday at the earliest
- Refunds are not designed at all
- Ivan is the only one who knows the webhook code

Action items:
- Maria: chase legal on the contract
- Ivan: write down how the webhooks work
- Me: draft the refunds flow before the next review`,
  },
  { id: 8, title: "Website copy ideas", content: "Hero: shorter. Pricing page: add FAQ." },
  { id: 11, title: "Retro 12 Oct", content: "Went well: demo. Went badly: deploys on Friday." },
];

const TASKS = [
  { id: 42, projectId: 1, title: "Build the payments API", status: "blocked", assignee: "Ivan Georgiev", dueDate: "2026-10-16", blockedBy: [41] },
  { id: 41, projectId: 1, title: "Agree the payment provider contract", status: "in_progress", assignee: "Maria Petrova", dueDate: "2026-10-15" },
  { id: 43, projectId: 1, title: "Deployment pipeline", status: "todo", assignee: "Eval User", dueDate: "2026-10-23" },
  { id: 44, projectId: 2, title: "Onboarding redesign", status: "todo", assignee: "Eval User", dueDate: "2026-10-25" },
];

const FIXTURES: Partial<Record<A1ReadToolName, (input: Record<string, unknown>) => unknown>> = {
  getSessionContext: () => ({ userId: USER, email: "eval@example.com", name: "Eval User", activeOrganizationId: 1 }),
  listProjects: () => PROJECTS,
  getProjectDetail: (i) => ({ ...(PROJECTS.find((p) => p.id === i.projectId) ?? PROJECTS[0]), collaborators: [] }),
  getProjectHealth: (i) => ({ projectId: i.projectId ?? 1, completionRate: 0.41, overdue: 2, blocked: 1, risks: ["Payments API blocked on the provider contract"] }),
  listTasks: (i) => TASKS.filter((t) => i.projectId === undefined || t.projectId === i.projectId),
  getTaskDetail: (i) => TASKS.find((t) => t.id === i.taskId) ?? TASKS[0],
  getTaskDependencies: () => ({ blockedBy: [TASKS[1]], blocks: [] }),
  listMyWork: () => TASKS.filter((t) => t.assignee === "Eval User"),
  listNotesMetadata: () =>
    NOTES.map((n) => ({ id: n.id, title: n.title, locked: false, preview: n.content.slice(0, 140), updatedAt: "2026-10-16T10:00:00Z" })),
  searchWorkspace: () => NOTES.map((n) => ({ kind: "note", id: n.id, title: n.title, snippet: n.content.slice(0, 80) })),
};

function stubRegistry(calls: Array<{ name: string; input: unknown }>): Record<string, LoopTool> {
  const registry: Record<string, LoopTool> = {};
  for (const name of a1WorkspaceConciergeProfile.draftToolAllowlist) {
    registry[name] = {
      name,
      inputSchema: A1_READ_TOOLS[name].inputSchema,
      execute: async (_ctx, input: never) => {
        calls.push({ name, input });
        return FIXTURES[name]?.(input as Record<string, unknown>) ?? [];
      },
    };
  }
  return registry;
}

const CONTEXT: A1ContextPack = {
  session: { userId: USER, email: "eval@example.com", name: "Eval User", activeOrganizationId: 1 },
  projects: PROJECTS,
  scopedProjectId: null,
  locale: "en",
  memory: [],
  now: NOW,
};

const FAKE_CTX = { session: { user: { id: USER } }, db: {} } as unknown as TRPCContext;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface Scenario {
  id: string;
  message: string;
  page: ResolvedPageContext;
  /** The opener the AI button sends: it should come back with next steps. */
  opener?: boolean;
  bulgarian?: boolean;
}

const NOTE_PAGE: ResolvedPageContext = { kind: "note", id: 3, title: NOTES[0]!.title, content: NOTES[0]!.content };
const PROJECT_PAGE: ResolvedPageContext = { kind: "project", id: 1, title: "Project Alpha" };

const SCENARIOS: Scenario[] = [
  { id: "note.opener.en", message: "Look at this note and tell me what you can do with it.", page: NOTE_PAGE, opener: true },
  { id: "note.opener.bg", message: "Разгледай тази бележка и ми кажи какво можеш да направиш с нея.", page: NOTE_PAGE, opener: true, bulgarian: true },
  { id: "note.question", message: "Who is supposed to chase legal here?", page: NOTE_PAGE },
  { id: "project.opener.en", message: "Look at this project and tell me what you can do with it.", page: PROJECT_PAGE, opener: true },
];

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------

interface Run {
  intent: string;
  clarified: boolean;
  grounded: boolean;
  followUps: number;
  cyrillic: boolean;
  tools: string[];
  latencyMs: number;
  text: string;
  error?: string;
}

function visibleText(out: A1Output): string {
  return [out.answer?.summary, ...(out.answer?.details ?? []), out.clarify?.question]
    .filter(Boolean)
    .join("\n");
}

/** Did it act on the page: cite it, name it, or look it up by its id? */
function isGrounded(s: Scenario, out: A1Output, calls: Array<{ name: string; input: unknown }>): boolean {
  const ref = `${s.page.kind}:${String(s.page.id)}`;
  const cited = (out.citations ?? []).some((c) => c.ref === ref);
  const text = visibleText(out).toLowerCase();
  const named =
    s.page.kind === "note"
      ? /contract|refund|webhook|legal|договор|възстановяван|уебхук|правн/.test(text)
      : /alpha|payment|blocked|блокир|плащан/.test(text);
  const lookedUp = calls.some(
    (c) => (c.input as { projectId?: unknown } | null)?.projectId === s.page.id,
  );
  return cited || named || lookedUp;
}

async function runOnce(s: Scenario, withPage: boolean): Promise<Run> {
  const calls: Array<{ name: string; input: unknown }> = [];
  const startedAt = Date.now();
  try {
    const { parsed } = await runA1Turn({
      ctx: FAKE_CTX,
      userId: USER,
      contextPack: CONTEXT,
      message: s.message,
      pageContext: withPage ? s.page : null,
      registry: stubRegistry(calls),
    });
    const latencyMs = Date.now() - startedAt;
    if (!parsed?.success) {
      return { intent: "(invalid)", clarified: false, grounded: false, followUps: 0, cyrillic: false, tools: calls.map((c) => c.name), latencyMs, text: "", error: parsed ? parsed.error : "tool budget exhausted" };
    }
    const out = parsed.data;
    const text = visibleText(out);
    return {
      intent: out.intent.type,
      clarified: out.intent.type === "clarify" || Boolean(out.clarify),
      grounded: isGrounded(s, out, calls),
      followUps: out.followUps?.length ?? 0,
      cyrillic: /[Ѐ-ӿ]/.test(text),
      tools: calls.map((c) => c.name),
      latencyMs,
      text,
    };
  } catch (err) {
    return { intent: "(error)", clarified: false, grounded: false, followUps: 0, cyrillic: false, tools: [], latencyMs: Date.now() - startedAt, text: "", error: err instanceof Error ? err.message : String(err) };
  }
}

function checks(s: Scenario, r: Run): Array<{ name: string; ok: boolean }> {
  return [
    { name: "valid output", ok: !r.error },
    { name: "no clarify", ok: !r.clarified },
    { name: "grounded in the page", ok: r.grounded },
    ...(s.opener ? [{ name: "offers follow-ups", ok: r.followUps > 0 }] : []),
    ...(s.bulgarian ? [{ name: "answers in Bulgarian", ok: r.cyrillic }] : []),
  ];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface Result {
  scenario: Scenario;
  without: Run;
  with: Run;
  checks: Array<{ name: string; ok: boolean }>;
}

const describeRun = (r: Run) =>
  r.error ? `error — ${r.error.slice(0, 60)}` : `${r.clarified ? "asked which" : r.grounded ? "grounded" : "ungrounded"} · ${r.intent} · ${String(r.followUps)} follow-ups`;

function markdown(meta: { date: string; models: string }, results: Result[]): string {
  const all = results.flatMap((r) => r.checks);
  const passed = all.filter((c) => c.ok).length;
  const baselineClarified = results.filter((r) => r.without.clarified).length;
  const baselineGrounded = results.filter((r) => r.without.grounded && !r.without.clarified).length;
  const withGrounded = results.filter((r) => r.with.grounded && !r.with.clarified).length;
  const q = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ").slice(0, 280);

  return [
    `# Page context eval — ${meta.date}`,
    "",
    `Model chain: \`${meta.models}\` · scenarios: ${String(results.length)} · each run without and with the page`,
    "",
    "| | Without page | With page |",
    "|---|---|---|",
    `| Answered about the page (grounded, no clarify) | ${String(baselineGrounded)}/${String(results.length)} | ${String(withGrounded)}/${String(results.length)} |`,
    `| Asked which note/project was meant | ${String(baselineClarified)}/${String(results.length)} | ${String(results.filter((r) => r.with.clarified).length)}/${String(results.length)} |`,
    `| Checks passed (with page) | — | ${String(passed)}/${String(all.length)} |`,
    "",
    "## Per scenario",
    "",
    "| Scenario | Without page | With page | Failed checks |",
    "|---|---|---|---|",
    ...results.map(
      (r) =>
        `| \`${r.scenario.id}\` | ${describeRun(r.without)} | ${describeRun(r.with)} | ${r.checks.filter((c) => !c.ok).map((c) => c.name).join(", ") || "—"} |`,
    ),
    "",
    "## What it said",
    "",
    ...results.flatMap((r) => [
      `### \`${r.scenario.id}\` — “${r.scenario.message}”`,
      "",
      `- **Without page:** ${q(r.without.text) || "_(nothing)_"}`,
      `- **With page:** ${q(r.with.text) || "_(nothing)_"}`,
      `- Tools with page: ${r.with.tools.join(", ") || "none"}`,
      "",
    ]),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

describe.skipIf(!isLlmConfigured())("page context (live model)", () => {
  it("answers about the page it was opened from", async () => {
    const models = resolveLlmConfig(process.env).models.join(" → ");
    const date = new Date().toISOString().slice(0, 10);
    const slug = (resolveLlmConfig(process.env).models[0] ?? "model").replace(/[^a-z0-9.-]+/gi, "-");
    const dir = path.resolve(process.cwd(), "docs/diploma/evals");
    mkdirSync(dir, { recursive: true });
    const base = path.join(dir, `page-context-${date}-${slug}`);

    // The clock is faked only now, after the run date is read: "this week"
    // has to mean the same week on every run.
    vi.useFakeTimers({ now: new Date(NOW), toFake: ["Date"] });

    const results: Result[] = [];
    for (const s of SCENARIOS) {
      const without = await runOnce(s, false);
      const withPage = await runOnce(s, true);
      const result = { scenario: s, without, with: withPage, checks: checks(s, withPage) };
      results.push(result);
      console.log(`  ${s.id}: without → ${describeRun(without)} | with → ${describeRun(withPage)}`);
      writeFileSync(`${base}.json`, JSON.stringify({ date, models, results }, null, 2));
      writeFileSync(`${base}.md`, markdown({ date, models }, results));
    }

    vi.useRealTimers();
    console.log(`\n  report: ${path.relative(process.cwd(), base)}.md`);

    const failed = results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `${r.scenario.id}: ${c.name}`));
    expect(failed).toEqual([]);
  });
});
