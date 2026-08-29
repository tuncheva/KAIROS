"use client";

import { useState } from "react";
import { ChevronRight, Lock, Plus, Wrench } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import type { AgentSummary } from "./types";

interface Props {
  agent: AgentSummary | null;
  /** Tool names the current turn called, in order. */
  used: string[];
  /** From `billing.entitlements`. Everything is granted today. */
  canAddCustomTools: boolean;
}

/**
 * What the selected agent can do, and what it just did.
 *
 * Two halves, and the second is the one that earns its place. The tool list is
 * reference material; "this answer came from these four lookups" is the thing
 * that makes an agent's reasoning checkable, and the stream already carried it —
 * it was previously spent on a progress label that the next frame overwrote.
 *
 * Only A1 lists tools. The write agents get a pre-built context pack rather than
 * calling anything, so they show the operations they can put in a plan instead;
 * inventing a tool list for them would describe a mechanism that does not exist.
 */
export function ToolInspector({ agent, used, canAddCustomTools }: Props) {
  const t = useTranslations("agents");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!agent) {
    return (
      <p className="p-4 text-sm text-fg-tertiary">{t("autoToolsHint")}</p>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {used.length > 0 && (
        <section className="border-b border-slate-200 p-3 dark:border-white/[0.06]">
          <h4 className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
            {t("usedThisTurn", { count: used.length })}
          </h4>
          <ol className="space-y-1">
            {used.map((name, i) => (
              <li
                key={`${name}-${String(i)}`}
                className="flex items-center gap-2 text-xs text-fg-secondary"
              >
                <span className="w-4 shrink-0 text-right text-fg-tertiary">
                  {i + 1}
                </span>
                <code className="rounded bg-bg-secondary px-1.5 py-0.5 font-mono">
                  {name}
                </code>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="p-3">
        <h4 className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
          {agent.tools.length > 0
            ? t("toolCount", { count: agent.tools.length })
            : t("operations")}
        </h4>

        {agent.tools.length === 0 && agent.operations.length > 0 && (
          <>
            <p className="pb-2 text-xs leading-snug text-fg-tertiary">
              {t("noToolsExplanation")}
            </p>
            <ul className="space-y-1">
              {agent.operations.map((op) => (
                <li
                  key={op}
                  className="rounded-lg bg-bg-secondary px-2 py-1.5 text-xs text-fg-secondary"
                >
                  {op}
                </li>
              ))}
            </ul>
          </>
        )}

        {agent.tools.map((tool) => {
          const isOpen = expanded === tool.name;
          return (
            <div key={tool.name} className="mb-1">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : tool.name)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-secondary/60"
              >
                <ChevronRight
                  className={`h-3 w-3 shrink-0 text-fg-tertiary transition-transform ${
                    isOpen ? "rotate-90" : ""
                  }`}
                />
                <Wrench className="h-3 w-3 shrink-0 text-fg-tertiary" />
                <code className="truncate font-mono text-xs text-fg-primary">
                  {tool.name}
                </code>
              </button>

              {isOpen && (
                <div className="px-2 pb-2 pl-8">
                  <p className="text-xs leading-snug text-fg-secondary">
                    {tool.description}
                  </p>
                  <pre className="mt-1.5 overflow-x-auto rounded-lg bg-bg-secondary p-2 text-[11px] leading-tight text-fg-tertiary">
                    {JSON.stringify(tool.parameters, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/*
        Deliberately inert, and visible rather than hidden. Custom tools are the
        next step, not this one; a disabled control with a reason attached says
        that, where an absent control just looks like the feature was never
        considered.
      */}
      <section className="mt-auto border-t border-slate-200 p-3 dark:border-white/[0.06]">
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-fg-tertiary dark:border-white/[0.12]"
        >
          {canAddCustomTools ? (
            <Plus className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          {t("addCustomTool")}
        </button>
        <p className="pt-1.5 text-center text-[11px] leading-snug text-fg-tertiary">
          {t("addCustomToolSoon")}
        </p>
      </section>
    </div>
  );
}
