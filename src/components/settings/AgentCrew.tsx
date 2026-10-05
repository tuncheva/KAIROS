"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";

import { useAgentLabel } from "~/components/agents/useAgentLabel";
import {
  AGENT_NAME_MAX,
  agentNameProblem,
  normalizeAgentName,
  type AgentId,
  type AgentNameProblem,
} from "~/lib/agentNames";
import { api } from "~/trpc/react";

import {
  LedgerAction,
  LedgerInput,
  LedgerRowView,
  LedgerValue,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

/**
 * Settings → AI → Your crew.
 *
 * The agents drawn as what they are to the user: one they talk to, five that
 * draft changes for approval, four that run on a clock. Picking one opens what
 * it does and what can be tuned about it — its name now, and the settings that
 * are planned, marked as such rather than hidden, so the panel doubles as the
 * roadmap for per-agent customisation.
 *
 * The orbit is decoration over a plain list of buttons: every agent is
 * reachable by keyboard, the motion stops under the pointer so a moving target
 * is never what you are trying to click, and it does not move at all under
 * `prefers-reduced-motion`.
 */

type Kind = "concierge" | "specialist" | "scheduled";

/** Who sits on which ring. Rings are a product statement, not data, so they live here. */
const CREW: ReadonlyArray<{ id: AgentId; kind: Kind }> = [
  { id: "workspace_concierge", kind: "concierge" },
  { id: "task_planner", kind: "specialist" },
  { id: "notes_vault", kind: "specialist" },
  { id: "events_publisher", kind: "specialist" },
  { id: "org_admin", kind: "specialist" },
  { id: "project_manager", kind: "specialist" },
  { id: "daily_brief", kind: "scheduled" },
  { id: "risk_radar", kind: "scheduled" },
  { id: "weekly_retro", kind: "scheduled" },
  { id: "meeting_prep", kind: "scheduled" },
];

const RINGS: Record<Kind, { r: number; period: number; dir: 1 | -1; dot: number }> = {
  concierge: { r: 74, period: 60, dir: 1, dot: 5.5 },
  specialist: { r: 126, period: 110, dir: 1, dot: 4 },
  scheduled: { r: 178, period: 170, dir: -1, dot: 4 },
};

const C = 200;
const CORE_R = 32;

/** Even spacing per ring, each ring turned a little so labels do not line up. */
const PHASE: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  (["concierge", "specialist", "scheduled"] as const).forEach((kind, ringIndex) => {
    const members = CREW.filter((a) => a.kind === kind);
    members.forEach((a, i) => {
      out[a.id] = -Math.PI / 2 + (i / members.length) * Math.PI * 2 + ringIndex * 0.45;
    });
  });
  return out;
})();

/** Settings each agent will have. `live` ones exist today; the rest are planned. */
type OptionKey =
  | "effort"
  | "memory"
  | "schedule"
  | "tone"
  | "language"
  | "approval"
  | "scope"
  | "taskDefaults"
  | "noteTemplate"
  | "eventDefaults"
  | "secondApprover"
  | "namingPattern"
  | "briefSections"
  | "stalledAfter"
  | "leadTime";

const LIVE: ReadonlySet<OptionKey> = new Set(["effort", "memory", "schedule"]);

const SPECIALIST_COMMON: OptionKey[] = ["approval", "scope"];

const OPTIONS: Record<AgentId, OptionKey[]> = {
  workspace_concierge: ["effort", "memory", "tone", "language"],
  task_planner: ["memory", "taskDefaults", ...SPECIALIST_COMMON],
  notes_vault: ["memory", "noteTemplate", ...SPECIALIST_COMMON],
  events_publisher: ["memory", "eventDefaults", ...SPECIALIST_COMMON],
  org_admin: ["memory", "secondApprover", ...SPECIALIST_COMMON],
  project_manager: ["memory", "namingPattern", ...SPECIALIST_COMMON],
  daily_brief: ["schedule", "briefSections"],
  risk_radar: ["schedule", "stalledAfter"],
  weekly_retro: ["schedule"],
  meeting_prep: ["schedule", "leadTime"],
};

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type Translator = (key: string, values?: Record<string, unknown>) => string;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function AgentCrew() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.ai.crew");
  const label = useAgentLabel();
  const reduced = usePrefersReducedMotion();
  const [selected, setSelected] = useState<AgentId>("workspace_concierge");

  return (
    <div className="grid gap-x-10 gap-y-6 pt-2 xl:grid-cols-[340px_minmax(0,1fr)]">
      <CrewOrbit
        selected={selected}
        onSelect={setSelected}
        reduced={reduced}
        nameOf={(id) => label.name(id)}
        roleOf={(id) => label.role(id)}
        t={t}
      />
      {/* Keyed so the panel re-mounts and its entrance plays again per agent. */}
      <AgentDetail key={selected} id={selected} reduced={reduced} t={t} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orbit
// ---------------------------------------------------------------------------

function CrewOrbit({
  selected,
  onSelect,
  reduced,
  nameOf,
  roleOf,
  t,
}: {
  selected: AgentId;
  onSelect: (id: AgentId) => void;
  reduced: boolean;
  nameOf: (id: AgentId) => string;
  roleOf: (id: AgentId) => string;
  t: Translator;
}) {
  const nodes = useRef(new Map<AgentId, SVGGElement>());
  const link = useRef<SVGLineElement>(null);
  const hovering = useRef(false);
  const selectedRef = useRef(selected);
  const linkStart = useRef(0);

  useEffect(() => {
    selectedRef.current = selected;
    linkStart.current = performance.now();
  }, [selected]);

  // Positions are written straight to the DOM each frame; going through React
  // state would re-render the whole settings column sixty times a second.
  useEffect(() => {
    let clock = 0;
    let last = performance.now();
    let frame = 0;

    const position = (id: AgentId, kind: Kind) => {
      const ring = RINGS[kind];
      const angle = (PHASE[id] ?? 0) + ring.dir * (clock / ring.period) * Math.PI * 2;
      return { x: C + Math.cos(angle) * ring.r, y: C + Math.sin(angle) * ring.r };
    };

    const tick = (now: number) => {
      if (!hovering.current && !reduced) clock += (now - last) / 1000;
      last = now;

      for (const agent of CREW) {
        const p = position(agent.id, agent.kind);
        nodes.current
          .get(agent.id)
          ?.setAttribute("transform", `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
      }

      const line = link.current;
      const current = CREW.find((a) => a.id === selectedRef.current);
      if (line && current) {
        const p = position(current.id, current.kind);
        const k = reduced ? 1 : Math.min(1, (now - linkStart.current) / 500);
        const eased = 1 - Math.pow(1 - k, 3);
        const dx = p.x - C;
        const dy = p.y - C;
        const d = Math.hypot(dx, dy) || 1;
        const gap = RINGS[current.kind].dot + 5;
        const sx = C + (dx / d) * CORE_R;
        const sy = C + (dy / d) * CORE_R;
        const ex = p.x - (dx / d) * gap;
        const ey = p.y - (dy / d) * gap;
        line.setAttribute("x1", sx.toFixed(2));
        line.setAttribute("y1", sy.toFixed(2));
        line.setAttribute("x2", (sx + (ex - sx) * eased).toFixed(2));
        line.setAttribute("y2", (sy + (ey - sy) * eased).toFixed(2));
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  const onKey = (id: AgentId) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[340px] self-start xl:sticky xl:top-24">
      <svg
        viewBox="0 0 400 400"
        role="group"
        aria-label={t("orbitLabel")}
        className="block h-auto w-full overflow-visible"
        onPointerEnter={() => (hovering.current = true)}
        onPointerLeave={() => (hovering.current = false)}
      >
        {(["concierge", "specialist", "scheduled"] as const).map((kind) => (
          <circle
            key={kind}
            cx={C}
            cy={C}
            r={RINGS[kind].r}
            fill="none"
            strokeDasharray="2 5"
            className="stroke-fg-primary/10"
          />
        ))}

        <line ref={link} x1={C} y1={C} x2={C} y2={C} className="stroke-accent-primary/55" />

        <circle
          cx={C}
          cy={C}
          r={CORE_R}
          className="fill-bg-elevated stroke-accent-primary/45"
        />
        <circle cx={C} cy={C} r={CORE_R - 5} fill="none" className="stroke-fg-primary/10" />
        <text
          x={C}
          y={C + 6}
          textAnchor="middle"
          className="settings-serif fill-fg-primary text-[17px]"
        >
          {t("you")}
        </text>

        {CREW.map((agent) => {
          const ring = RINGS[agent.kind];
          const on = agent.id === selected;
          return (
            <g
              key={agent.id}
              ref={(el) => {
                if (el) nodes.current.set(agent.id, el);
                else nodes.current.delete(agent.id);
              }}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${nameOf(agent.id)}, ${roleOf(agent.id)}`}
              onClick={() => onSelect(agent.id)}
              onKeyDown={onKey(agent.id)}
              className="group cursor-pointer outline-none"
            >
              <circle r={16} fill="transparent" />
              <circle
                r={ring.dot + 5}
                fill="none"
                className={`stroke-accent-primary/45 transition-opacity duration-[250ms] group-focus-visible:opacity-100 ${
                  on ? "opacity-100" : "opacity-0"
                }`}
              />
              <circle
                r={ring.dot}
                strokeWidth={agent.kind === "specialist" ? 1.2 : 0}
                className={
                  agent.kind === "concierge"
                    ? "fill-accent-primary"
                    : agent.kind === "specialist"
                      ? "fill-bg-elevated stroke-accent-primary"
                      : "fill-fg-tertiary"
                }
              />
              <text
                y={ring.dot + 15}
                textAnchor="middle"
                className={`text-[10.5px] font-medium tracking-[0.04em] transition-[fill] duration-200 group-hover:fill-fg-primary group-focus-visible:fill-fg-primary ${
                  on ? "fill-fg-primary" : "fill-fg-tertiary"
                }`}
              >
                {nameOf(agent.id)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-settings-meta text-fg-tertiary">
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-accent-primary" />
          {t("legendTalks")}
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span
            aria-hidden
            className="h-[7px] w-[7px] rounded-full shadow-[inset_0_0_0_1.2px_rgb(var(--accent-primary))]"
          />
          {t("legendDrafts")}
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-fg-tertiary" />
          {t("legendScheduled")}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/** The description writes itself in, a little faster than reading speed. */
function useTypedText(text: string, reduced: boolean): { shown: string; done: boolean } {
  const [count, setCount] = useState(reduced ? text.length : 0);

  useEffect(() => {
    if (reduced) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let n = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      n = Math.min(text.length, n + 2);
      setCount(n);
      if (n < text.length) timer = setTimeout(step, 14);
    };
    timer = setTimeout(step, 180);
    return () => clearTimeout(timer);
  }, [text, reduced]);

  return { shown: text.slice(0, count), done: count >= text.length };
}

const PROBLEM_KEY: Record<AgentNameProblem, string> = {
  empty: "errorEmpty",
  tooLong: "errorTooLong",
  characters: "errorCharacters",
  taken: "errorTaken",
};

function AgentDetail({ id, reduced, t }: { id: AgentId; reduced: boolean; t: Translator }) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const tAi = useT("settings.ai");
  const label = useAgentLabel();
  const save = useSettingsSave();
  const utils = api.useUtils();

  const names = api.agent.names.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  const memory = api.agent.memory.useQuery(undefined, { retry: false });
  const schedules = api.agent.schedules.useQuery(undefined, { retry: false });
  const setName = api.agent.setName.useMutation({
    onSuccess: () => utils.agent.names.invalidate(),
  });

  const kind = CREW.find((a) => a.id === id)?.kind ?? "specialist";
  const overrides = names.data?.overrides ?? {};
  const canEdit = names.data?.canEdit ?? false;
  const current = label.name(id);

  const [draft, setDraft] = useState(current);
  const [problem, setProblem] = useState<AgentNameProblem | null>(null);
  // A save from this form, or another admin's arriving on refetch, resets the field.
  useEffect(() => {
    setDraft(current);
    setProblem(null);
  }, [current]);

  const dirty = normalizeAgentName(draft) !== current;
  const commit = () => {
    if (!dirty) return;
    const issue = agentNameProblem(id, draft, overrides);
    setProblem(issue);
    if (issue) return;
    void save.run(() => setName.mutateAsync({ agentId: id, name: normalizeAgentName(draft) }));
  };
  const reset = () => {
    setProblem(null);
    void save.run(() => setName.mutateAsync({ agentId: id, name: null }));
  };

  const about = useTypedText(t(`about.${id}`), reduced);

  const facts = (memory.data ?? []).filter((f) => f.scope === id);
  const schedule = schedules.data?.find((s) => s.kind === id);
  const scheduleValue = !schedule
    ? "—"
    : !schedule.enabled
      ? t("scheduleOff")
      : schedule.kind === "meeting_prep"
        ? t("meetingPrepOn")
        : [
            t("scheduleOn"),
            schedule.dayOfWeek !== null ? tAi(WEEKDAY_KEYS[schedule.dayOfWeek] ?? "monday") : null,
            `${String(schedule.hourLocal).padStart(2, "0")}:00`,
          ]
            .filter(Boolean)
            .join(" · ");

  const soon = (
    <span className="rounded-[4px] border border-fg-primary/12 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-tertiary">
      {t("soon")}
    </span>
  );

  const optionRow = (key: OptionKey): LedgerRow => {
    const live = LIVE.has(key);
    const control =
      key === "effort" ? (
        <LedgerValue tone="dim">{t("effortValue")}</LedgerValue>
      ) : key === "memory" ? (
        <LedgerValue>{t("memoryValue", { count: facts.length })}</LedgerValue>
      ) : key === "schedule" ? (
        <LedgerValue tone={schedule?.enabled ? "default" : "dim"}>{scheduleValue}</LedgerValue>
      ) : (
        soon
      );
    return {
      id: `crew-${id}-${key}`,
      title: t(`${key}Title`),
      desc: t(`${key}Desc`),
      control,
      dim: !live,
    };
  };

  const nameRow: LedgerRow = {
    id: `crew-${id}-name`,
    title: t("nameTitle"),
    desc: (
      <>
        {names.data?.scope === "personal" ? t("nameDescPersonal") : t("nameDescWorkspace")}
        {problem ? (
          <span className="mt-1 block text-error">
            {t(PROBLEM_KEY[problem], { max: AGENT_NAME_MAX })}
          </span>
        ) : !canEdit && names.data ? (
          <span className="mt-1 block italic">{t("nameAdminOnly")}</span>
        ) : null}
      </>
    ),
    control: (
      <>
        <LedgerInput
          value={draft}
          onChange={(next) => {
            setDraft(next);
            if (problem) setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(current);
          }}
          ariaLabel={`${t("nameTitle")} — ${label.role(id)}`}
          maxLength={AGENT_NAME_MAX}
          disabled={!canEdit || setName.isPending}
          width="w-[180px]"
        />
        {dirty ? (
          <LedgerAction disabled={!canEdit || setName.isPending} onClick={commit}>
            {t("save")}
          </LedgerAction>
        ) : overrides[id] ? (
          <LedgerAction disabled={!canEdit || setName.isPending} onClick={reset}>
            {t("reset")}
          </LedgerAction>
        ) : null}
      </>
    ),
  };

  const rows = [nameRow, ...OPTIONS[id].map(optionRow)];
  const tag =
    kind === "concierge"
      ? { text: t("tagReadOnly"), accent: false }
      : kind === "specialist"
        ? { text: t("tagWrites"), accent: true }
        : { text: t("tagScheduled"), accent: false };

  // Each block rises in a beat after the one above it.
  const rise = (index: number) => ({ animationDelay: `${index * 60}ms` });

  return (
    <div className="min-w-0" aria-live="polite">
      <div className="settings-rise" style={rise(0)}>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-settings-eyebrow font-medium uppercase tracking-[0.14em] text-fg-tertiary">
            {label.role(id)}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-settings-micro font-medium ${
              tag.accent
                ? "bg-accent-primary/12 text-accent-primary"
                : "bg-fg-primary/5 text-fg-secondary"
            }`}
          >
            {tag.text}
          </span>
        </div>
      </div>

      <h4
        style={rise(1)}
        className="settings-serif settings-rise m-0 mt-2.5 text-[34px] font-light leading-[1.05] tracking-[-0.01em] text-fg-primary"
      >
        {current}
      </h4>

      <p
        style={rise(2)}
        className="settings-rise m-0 mt-2 max-w-[560px] text-settings-subtitle text-fg-secondary"
      >
        {/* The full text is what assistive tech reads; the typed copy is for the eye. */}
        <span className="sr-only">{t(`about.${id}`)}</span>
        <span aria-hidden>
          {about.shown}
          {about.done ? null : (
            <span className="ml-px inline-block w-[0.5ch] animate-pulse text-accent-primary">▍</span>
          )}
        </span>
      </p>

      <div className="settings-rise" style={rise(3)}>
        <div className="mt-4 flex min-w-0 flex-col border-t border-border-light">
          {rows.map((row, index) => (
            <LedgerRowView key={row.id} row={row} first={index === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}
