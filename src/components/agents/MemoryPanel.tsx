"use client";

import { useState } from "react";
import { Globe, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

import type { AgentSummary } from "./types";

const GLOBAL_SCOPE = "global";

interface Props {
  agents: AgentSummary[];
  /** The agent in the picker, or null for Auto. Pre-selects the scope. */
  activeAgentId: string | null;
}

/**
 * Inspect and edit what the assistant remembers.
 *
 * Two things this adds over Settings → AI Memory, which could already list and
 * delete:
 *
 * - **Writing a fact directly.** Until now a fact existed only because the model
 *   called `rememberFact` mid-conversation, so a user who knew exactly what they
 *   wanted remembered had to say it out loud and hope it was picked up.
 * - **Scoping it to one agent.** A preference about how tasks are worded has no
 *   business steering the notes agent, and one shared pool meant it did.
 *
 * The invariant from `memory.ts` is unchanged and is why this is safe to expose:
 * nothing is written by inference. Every row here is one the user typed or one
 * they asked for in as many words.
 */
export function MemoryPanel({ agents, activeAgentId }: Props) {
  const t = useTranslations("agents");
  const utils = api.useUtils();

  const memory = api.agent.memory.useQuery(undefined, { retry: false });
  const invalidate = () => void utils.agent.memory.invalidate();

  const upsert = api.agent.upsertMemory.useMutation({ onSuccess: invalidate });
  const forget = api.agent.forgetMemory.useMutation({ onSuccess: invalidate });

  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState(activeAgentId ?? GLOBAL_SCOPE);

  const scopeName = (s: string) =>
    s === GLOBAL_SCOPE
      ? t("scopeGlobal")
      : (agents.find((a) => a.id === s)?.name ?? s);

  const reset = () => {
    setAdding(false);
    setKey("");
    setValue("");
    setScope(activeAgentId ?? GLOBAL_SCOPE);
  };

  const submit = () => {
    if (!key.trim() || !value.trim()) return;
    upsert.mutate(
      { key: key.trim(), value: value.trim(), scope },
      { onSuccess: reset },
    );
  };

  const rows = memory.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {memory.isLoading ? (
        <p className="text-sm text-fg-tertiary">{t("loading")}</p>
      ) : rows.length === 0 && !adding ? (
        <p className="pb-3 text-sm leading-snug text-fg-tertiary">
          {t("memoryEmpty")}
        </p>
      ) : (
        <ul className="space-y-1.5 pb-3">
          {rows.map((fact) => (
            <li
              key={fact.id}
              className="rounded-xl bg-bg-secondary px-2.5 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm leading-snug text-fg-primary">
                  {fact.value}
                </p>
                <button
                  type="button"
                  onClick={() => forget.mutate({ id: fact.id })}
                  disabled={forget.isPending}
                  aria-label={t("forget")}
                  className="shrink-0 rounded-lg p-1 text-fg-tertiary transition-colors hover:bg-red-500/15 hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                {fact.scope === GLOBAL_SCOPE && (
                  <Globe className="h-3 w-3 text-fg-tertiary" />
                )}
                <span className="text-[11px] text-fg-tertiary">
                  {scopeName(fact.scope)} · {fact.key}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-2 rounded-xl border border-slate-200 p-2.5 dark:border-white/[0.06]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-primary">
              {t("addFact")}
            </span>
            <button
              type="button"
              onClick={reset}
              aria-label={t("cancel")}
              className="kairos-tap rounded-lg p-1 text-fg-tertiary hover:bg-bg-secondary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <label className="block">
            <span className="text-[11px] text-fg-tertiary">{t("factScope")}</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="mt-0.5 w-full rounded-lg bg-bg-secondary px-2 py-1.5 text-xs text-fg-primary"
            >
              <option value={GLOBAL_SCOPE}>{t("scopeGlobal")}</option>
              {agents
                .filter((a) => a.kind === "conversational")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] text-fg-tertiary">{t("factKey")}</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sprint_cadence"
              maxLength={64}
              className="mt-0.5 w-full rounded-lg bg-bg-secondary px-2 py-1.5 font-mono text-xs text-fg-primary placeholder:text-fg-tertiary"
            />
          </label>

          <label className="block">
            <span className="text-[11px] text-fg-tertiary">{t("factValue")}</span>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("factValuePlaceholder")}
              maxLength={200}
              rows={3}
              className="mt-0.5 w-full resize-none rounded-lg bg-bg-secondary px-2 py-1.5 text-xs text-fg-primary placeholder:text-fg-tertiary"
            />
          </label>

          {/* The server returns `stored: false` with a reason when the cap is
              hit; surfacing it here is the difference between "nothing happened"
              and "you already have twenty of these". */}
          {upsert.data && !upsert.data.stored && (
            <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">
              {upsert.data.message}
            </p>
          )}
          {upsert.error && (
            <p className="text-[11px] leading-snug text-red-500">
              {upsert.error.message}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={upsert.isPending || !key.trim() || !value.trim()}
            className="w-full rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {upsert.isPending ? t("saving") : t("save")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-fg-secondary transition-colors hover:bg-bg-secondary/60 dark:border-white/[0.12]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("addFact")}
        </button>
      )}
    </div>
  );
}
