"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  GLOBAL_SCOPE,
  INSTRUCTION_SCOPE,
  MAX_INSTRUCTIONS,
} from "~/lib/memoryScopes";
import { CalendarConnectionPanel } from "./CalendarConnectionPanel";
import { CustomSchedulesPanel } from "./CustomSchedulesPanel";
import { api } from "~/trpc/react";

import {
  LedgerAction,
  LedgerGroup,
  LedgerInput,
  LedgerSection,
  LedgerSelect,
  LedgerToggle,
  LedgerValue,
  useSectionCrumb,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

/**
 * Settings → AI.
 *
 * Two features that cannot ship without it:
 *
 * - **Consent (B-4).** Proactive briefs are off until someone turns them on
 *   here. A product that starts messaging people because it was deployed is a
 *   product people mute.
 * - **Inspectable memory (C-2).** Every stored fact is listed verbatim with a
 *   delete button next to it. A memory you cannot see is a memory you cannot
 *   correct, and an assistant that "just knows things" about you is unnerving
 *   rather than helpful.
 *
 * The quota row is here too, because the honest answer to "why did it stop
 * replying?" is a number, and it was previously only available to the code.
 */

type Translator = (key: string, values?: Record<string, unknown>) => string;

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Matches `FactValueSchema`'s ceiling, so the form cannot submit a rejected value. */
const RULE_MAX_CHARS = 200;

/**
 * An unused storage key for a new rule.
 *
 * `key` is the dedupe handle on `ai_user_memory`, and for a remembered fact it is
 * meaningful — asserting a new `sprint_cadence` should replace the old one. A rule
 * has no such natural handle: its identity is its text. Deriving one by slugifying
 * the text would silently overwrite when two rules start with the same few words,
 * so the lowest free index is used instead and the user never sees it.
 */
function nextRuleKey(existing: string[]): string {
  const taken = new Set(existing);
  for (let i = 1; i <= 99; i += 1) {
    const candidate = `rule_${String(i)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `rule_${String(Date.now())}`;
}

/**
 * Message keys per schedule kind.
 *
 * A lookup rather than the pair of `kind === "daily_brief" ? … : …` ternaries
 * that were here. With two kinds those read fine and silently mislabelled the
 * third as a risk radar the moment one existed; a `Record` keyed by the union
 * makes the compiler ask for the new strings instead.
 */
const SCHEDULE_LABELS = {
  daily_brief: { title: "dailyBriefTitle", description: "dailyBriefDescription" },
  risk_radar: { title: "riskRadarTitle", description: "riskRadarDescription" },
  weekly_retro: { title: "weeklyRetroTitle", description: "weeklyRetroDescription" },
  meeting_prep: { title: "meetingPrepTitle", description: "meetingPrepDescription" },
} as const;

/** Sunday-first, matching `Date.getDay` and the stored `dayOfWeek`. */
const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export function AiSettingsClient() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.ai");
  const tAgents = useT("agents");
  const crumb = useSectionCrumb("ai");
  const save = useSettingsSave();

  const utils = api.useUtils();
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [draftRule, setDraftRule] = useState("");

  const memory = api.agent.memory.useQuery(undefined, { retry: false });
  // Only to turn a stored scope id into an agent name. Static, so it is fetched
  // once and never refetched.
  const agents = api.agent.agents.useQuery(undefined, {
    retry: false,
    staleTime: Infinity,
  });
  const schedules = api.agent.schedules.useQuery(undefined, { retry: false });
  const metrics = api.agent.metrics.useQuery({ days: 30 }, { retry: false });
  const stats = api.agent.findingStats.useQuery(undefined, { retry: false });

  // Rules and facts share a table and a delete path but are two different things
  // to a reader, so they are two different groups. Listing a rule among the facts
  // labelled "instruction" would show the storage detail and hide the meaning.
  const allMemory = memory.data ?? [];
  const rules = allMemory.filter((f) => f.scope === INSTRUCTION_SCOPE);
  const facts = allMemory.filter((f) => f.scope !== INSTRUCTION_SCOPE);

  const forget = api.agent.forgetMemory.useMutation({
    onSuccess: () => utils.agent.memory.invalidate(),
  });
  const addRule = api.agent.upsertMemory.useMutation({
    onSuccess: async () => {
      setDraftRule("");
      await utils.agent.memory.invalidate();
    },
  });
  const clearAll = api.agent.clearMemory.useMutation({
    onSuccess: () => utils.agent.memory.invalidate(),
  });
  const setSchedule = api.agent.setSchedule.useMutation({
    onSuccess: () => utils.agent.schedules.invalidate(),
  });
  const preview = api.agent.previewBrief.useMutation({
    onSuccess: (res) => setPreviewMessage(res.message),
  });

  const quota = metrics.data?.quota;
  const timeZone = schedules.data?.[0]?.timeZone;

  const scheduleRows: LedgerRow[] = (schedules.data ?? []).map((schedule) => ({
    id: schedule.kind,
    title: t(SCHEDULE_LABELS[schedule.kind].title),
    desc: schedule.lastError
      ? t("lastFailed", { error: schedule.lastError })
      : t(SCHEDULE_LABELS[schedule.kind].description),
    descText: t(SCHEDULE_LABELS[schedule.kind].description),
    control: (
      <>
        {/* Meeting prep has no hour or day to choose: it fires relative to
            whatever is next on the calendar. Offering pickers would imply a
            control that does not exist. */}
        {schedule.kind === "meeting_prep" ? (
          <LedgerValue tone="dim">{t("meetingPrepTiming")}</LedgerValue>
        ) : null}

        {/* Only weekly kinds get a day. Rendering a disabled "every day" option
            for the daily ones would imply they could be changed. */}
        {schedule.kind !== "meeting_prep" && schedule.dayOfWeek !== null ? (
          <LedgerSelect
            width="w-[130px]"
            value={schedule.dayOfWeek}
            ariaLabel={t("onDay")}
            disabled={!schedule.enabled || setSchedule.isPending}
            onChange={(next) =>
              void save.run(() =>
                setSchedule.mutateAsync({
                  kind: schedule.kind,
                  enabled: schedule.enabled,
                  dayOfWeek: Number(next),
                }),
              )
            }
            options={WEEKDAY_KEYS.map((key, index) => ({ value: index, label: t(key) }))}
          />
        ) : null}

        {schedule.kind === "meeting_prep" ? null : (
          <LedgerSelect
            width="w-[90px]"
            value={schedule.hourLocal}
            ariaLabel={t("atHour")}
            disabled={!schedule.enabled || setSchedule.isPending}
            onChange={(next) =>
              void save.run(() =>
                setSchedule.mutateAsync({
                  kind: schedule.kind,
                  enabled: schedule.enabled,
                  hourLocal: Number(next),
                }),
              )
            }
            options={HOURS.map((h) => ({
              value: h,
              label: `${String(h).padStart(2, "0")}:00`,
            }))}
          />
        )}

        <LedgerSelect
          width="w-[120px]"
          value={schedule.channel}
          ariaLabel={t("deliverTo")}
          disabled={!schedule.enabled || setSchedule.isPending}
          onChange={(next) =>
            void save.run(() =>
              setSchedule.mutateAsync({
                kind: schedule.kind,
                enabled: schedule.enabled,
                channel: next as "app" | "email" | "both",
              }),
            )
          }
          options={[
            { value: "app", label: t("channelApp") },
            { value: "email", label: t("channelEmail") },
            { value: "both", label: t("channelBoth") },
          ]}
        />

        <LedgerToggle
          checked={schedule.enabled}
          disabled={setSchedule.isPending}
          label={t("enableToggle")}
          onChange={(next) =>
            void save.run(() =>
              setSchedule.mutateAsync({
                kind: schedule.kind,
                enabled: next,
                hourLocal: schedule.hourLocal,
              }),
            )
          }
        />
      </>
    ),
  }));

  scheduleRows.push({
    id: "previewBrief",
    title: t("previewBrief"),
    desc: previewMessage ?? undefined,
    control: (
      <LedgerAction disabled={preview.isPending} onClick={() => preview.mutate()}>
        {preview.isPending ? t("sending") : t("previewBrief")}
      </LedgerAction>
    ),
  });

  const ruleRows: LedgerRow[] =
    rules.length >= MAX_INSTRUCTIONS
      ? [
          {
            id: "ruleLimit",
            title: t("ruleLimit", { max: MAX_INSTRUCTIONS }),
            dim: true,
          },
        ]
      : [
          {
            id: "addRule",
            title: t("addRule"),
            control: (
              <>
                <LedgerInput
                  value={draftRule}
                  onChange={setDraftRule}
                  ariaLabel={t("addRule")}
                  placeholder={t("rulePlaceholder")}
                  maxLength={RULE_MAX_CHARS}
                  disabled={addRule.isPending}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draftRule.trim().length >= 2) {
                      void save.run(() =>
                        addRule.mutateAsync({
                          key: nextRuleKey(rules.map((r) => r.key)),
                          value: draftRule.trim(),
                          scope: INSTRUCTION_SCOPE,
                        }),
                      );
                    }
                  }}
                />
                <LedgerAction
                  disabled={addRule.isPending || draftRule.trim().length < 2}
                  onClick={() =>
                    void save.run(() =>
                      addRule.mutateAsync({
                        key: nextRuleKey(rules.map((r) => r.key)),
                        value: draftRule.trim(),
                        scope: INSTRUCTION_SCOPE,
                      }),
                    )
                  }
                >
                  {addRule.isPending ? t("sending") : t("addRule")}
                </LedgerAction>
              </>
            ),
          },
        ];

  const usageRows: LedgerRow[] = [
    {
      id: "quotaInteractive",
      title: t("quotaRemaining"),
      control: (
        <LedgerValue mono>
          {quota ? `${quota.interactive.remaining}/${quota.interactive.limit}` : "—"}
        </LedgerValue>
      ),
    },
    {
      id: "quotaSystem",
      title: t("quotaSystem"),
      control: (
        <LedgerValue mono>
          {quota ? `${quota.system.remaining}/${quota.system.limit}` : "—"}
        </LedgerValue>
      ),
    },
    {
      id: "tokens30d",
      title: t("tokens30d"),
      control: (
        <LedgerValue mono>
          {metrics.data ? metrics.data.window.totalTokens.toLocaleString() : "—"}
        </LedgerValue>
      ),
    },
    {
      id: "dismissalRate",
      title: t("dismissalRate"),
      control: (
        <LedgerValue mono>{stats.data ? `${stats.data.dismissalRate}%` : "—"}</LedgerValue>
      ),
    },
  ];

  return (
    <LedgerSection sectionId="ai" crumb={crumb} title={t("title")} subtitle={t("subtitle")}>
      {/* Calendar first: meeting prep below is inert without one, and a user who
          enables it should be able to see why nothing arrives. */}
      <LedgerGroup
        label={t("calendarGroup")}
        hint={t("calendarGroupHint")}
        block={<CalendarConnectionPanel />}
      />

      <LedgerGroup
        label={t("proactiveTitle")}
        hint={t("proactiveDescription")}
        rows={scheduleRows}
        // Stated once rather than per row: the hour selects above are meaningless
        // without it, and the label used to read "UTC" — which was accurate about
        // the old behaviour and wrong about the user's morning.
        note={timeZone ? t("timeZoneHint", { zone: timeZone }) : undefined}
        // Saved questions, under the built-ins they extend.
        block={timeZone ? <CustomSchedulesPanel timeZone={timeZone} /> : undefined}
      />

      <LedgerGroup
        label={t("rulesTitle")}
        hint={t("rulesDescription")}
        rows={ruleRows}
        // Said plainly, because the alternative is a user wondering why the
        // assistant will not write a rule they asked it for.
        note={t("rulesOnlyYou")}
        block={
          rules.length ? (
            <ul className="flex flex-col">
              {rules.map((rule, index) => (
                <li
                  key={rule.id}
                  className={`flex items-start justify-between gap-3 py-3 ${
                    index > 0 ? "border-t border-border-light" : ""
                  }`}
                >
                  <p className="min-w-0 text-[13.5px] text-fg-primary">{rule.value}</p>
                  <LedgerAction
                    danger
                    disabled={forget.isPending}
                    onClick={() =>
                      void save.run(() => forget.mutateAsync({ id: rule.id }))
                    }
                  >
                    {t("removeRule")}
                  </LedgerAction>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-tertiary">{t("rulesEmpty")}</p>
          )
        }
      />

      <LedgerGroup
        label={t("memoryTitle")}
        hint={t("memoryDescription")}
        block={
          memory.isLoading ? (
            <p className="text-sm text-fg-tertiary">{t("loading")}</p>
          ) : facts.length === 0 ? (
            <p className="text-sm text-fg-tertiary">{t("memoryEmpty")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col">
                {facts.map((fact, index) => (
                  <li
                    key={fact.id}
                    className={`flex items-start justify-between gap-3 py-3 ${
                      index > 0 ? "border-t border-border-light" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      {/* The value verbatim: paraphrasing what it remembers
                          would defeat the point of showing it. */}
                      <p className="text-[13.5px] text-fg-primary">{fact.value}</p>
                      <p className="mt-0.5 text-xs text-fg-quaternary">
                        {/* Which agent this applies to. A fact scoped to one
                            agent reads as a general rule without this, and a
                            user cannot correct a scope they cannot see. */}
                        <span>
                          {fact.scope === GLOBAL_SCOPE
                            ? tAgents("scopeGlobal")
                            : (agents.data?.find((a) => a.id === fact.scope)?.name ??
                              fact.scope)}
                        </span>
                        <span className="px-1">·</span>
                        <span className="font-mono">{fact.key}</span>
                      </p>
                    </div>
                    <LedgerAction
                      danger
                      disabled={forget.isPending}
                      onClick={() =>
                        void save.run(() => forget.mutateAsync({ id: fact.id }))
                      }
                    >
                      {t("forget")}
                    </LedgerAction>
                  </li>
                ))}
              </ul>
              <div>
                <LedgerAction
                  danger
                  disabled={clearAll.isPending}
                  onClick={() => void save.run(() => clearAll.mutateAsync())}
                >
                  {t("forgetEverything")}
                </LedgerAction>
              </div>
            </div>
          )
        }
      />

      <LedgerGroup
        label={t("usageTitle")}
        hint={t("usageDescription")}
        rows={usageRows}
        block={
          (metrics.data?.latencyByAgent.length ?? 0) > 0 ? (
            <div className="kairos-scroll-area overflow-x-auto">
              <table className="w-full min-w-[24rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-fg-quaternary">
                    <th className="pb-2 font-medium">{t("agent")}</th>
                    <th className="pb-2 text-right font-medium">p50</th>
                    <th className="pb-2 text-right font-medium">p95</th>
                    <th className="pb-2 text-right font-medium">{t("samples")}</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.data?.latencyByAgent.map((row) => (
                    <tr key={row.agentId} className="border-t border-border-light">
                      <td className="py-1.5 text-fg-secondary">{row.agentId}</td>
                      <td className="py-1.5 text-right tabular-nums text-fg-primary">
                        {(row.p50Ms / 1000).toFixed(1)}s
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-fg-primary">
                        {(row.p95Ms / 1000).toFixed(1)}s
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-fg-tertiary">
                        {row.samples}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : undefined
        }
      />
    </LedgerSection>
  );
}
