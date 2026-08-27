"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

interface Props {
  onOpen: (prefill?: string) => void;
}

/**
 * The closed state of the assistant: a pill, and sometimes a nudge above it.
 *
 * The nudge is the whole reason the launcher is more than a button. Risk Radar
 * already finds things — tasks that went overdue, reviews that have sat open —
 * and until now the only way to hear about them was to go and ask. Surfacing
 * the top open finding here turns the assistant from something you remember to
 * consult into something that tells you when it has something to say.
 *
 * It is deliberately one finding, not a feed. A stack of them beside every
 * page is a notification centre, which is a different product and one the user
 * did not ask for; a single line that can be dismissed is a nudge.
 *
 * Dismissing hides the bubble for this page view only — it does not resolve the
 * finding, because the finding is about the workspace and closing a bubble has
 * not changed the workspace. The Risk Radar panel is where a finding is
 * actually dismissed.
 */
export function AskKairosLauncher({ onOpen }: Props) {
  const t = useTranslations("aiConsole");
  const [nudgeHidden, setNudgeHidden] = useState(false);

  const findingsQuery = api.agent.findings.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const nudge = nudgeHidden ? null : (findingsQuery.data?.[0] ?? null);

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2.5 lg:right-6 lg:bottom-6">
      {nudge && (
        <div className="kairos-console-rail flex max-w-[240px] items-start gap-2 rounded-[11px] rounded-br-[3px] border border-border-medium/70 bg-bg-secondary px-3 py-2.5 shadow-lg">
          <button
            type="button"
            // The nudge is a shortcut, not just a notice: opening the assistant
            // with the finding already in the box is the whole point of having
            // said it here rather than in a log.
            onClick={() => onOpen(nudge.suggestedFix?.prompt)}
            className="min-w-0 flex-1 text-left text-[12.5px] leading-snug text-fg-secondary transition-colors hover:text-fg-primary"
          >
            {nudge.title}
          </button>
          <button
            type="button"
            onClick={() => setNudgeHidden(true)}
            aria-label={t("dismissNudge")}
            className="-mt-0.5 -mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-tertiary transition-colors hover:text-fg-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <button
        type="button"
        data-testid="ask-kairos"
        onClick={() => onOpen()}
        className="flex items-center gap-2.5 rounded-xl bg-accent-primary px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_8px_24px_rgb(var(--accent-primary)/0.28)] transition-[filter] hover:brightness-110"
      >
        <Sparkles className="h-4 w-4" />
        {t("askKairos")}
      </button>
    </div>
  );
}
