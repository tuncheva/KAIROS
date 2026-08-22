"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

import type { TrailEvent, TrailKind } from "./trail";

interface Props {
  events: TrailEvent[];
  /** True while the turn is still running, so the last node reads as live. */
  running: boolean;
}

/**
 * What the assistant read this turn, in order, with what came back.
 *
 * A timeline rather than a list: the ordering is the point. A user checking an
 * answer wants to know that the project list was read *before* the tasks were,
 * and that the handoff to a write agent happened after both — a bare set of
 * tool names cannot say that.
 *
 * The panel deliberately shows nothing until a turn has run. Rendering an empty
 * timeline with placeholder rows would suggest the assistant had done work it
 * has not.
 */
export function TurnTrailPanel({ events, running }: Props) {
  const t = useTranslations("aiConsole");

  const dotClass: Record<TrailKind, string> = {
    start: "bg-accent-primary",
    tool: "bg-fg-tertiary/60",
    handoff: "bg-accent-secondary",
    draft: "bg-cyan-400 shadow-[0_0_0_4px_rgb(34_211_238/0.14)]",
    done: "bg-emerald-400",
    error: "bg-red-400",
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5">
        <div className="flex flex-col gap-1.5 pb-4">
          <p className="text-[13.5px] font-semibold text-fg-primary">
            {t("trailTitle")}
          </p>
          <p className="text-xs leading-relaxed text-fg-tertiary">
            {t("trailSubtitle")}
          </p>
        </div>

        {events.length === 0 ? (
          <p className="pb-6 text-xs leading-relaxed text-fg-tertiary">
            {t("trailEmpty")}
          </p>
        ) : (
          <ol className="flex flex-col pb-6">
            {events.map((event, index) => {
              const isLast = index === events.length - 1;
              return (
                <li
                  key={event.id}
                  className="grid grid-cols-[14px_1fr] gap-3"
                >
                  {/* Rail: a hairline through the node, stopped at the last one
                      so the timeline ends rather than trailing into nothing. */}
                  <div className="relative flex justify-center">
                    {!isLast && (
                      <span className="absolute top-1.5 bottom-0 w-px bg-border-medium/60" />
                    )}
                    <span
                      className={`relative mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full ${dotClass[event.kind]} ${
                        isLast && running ? "animate-pulse" : ""
                      }`}
                    />
                  </div>

                  <div className={isLast ? "" : "pb-4"}>
                    <div className="flex items-baseline justify-between gap-2.5">
                      <span
                        className={`text-[13px] font-semibold ${
                          event.kind === "draft"
                            ? "text-cyan-300"
                            : event.kind === "error"
                              ? "text-red-400"
                              : "text-fg-primary"
                        }`}
                      >
                        {event.label}
                      </span>
                      <span className="kairos-mono shrink-0 text-[10.5px] text-fg-tertiary">
                        {formatElapsed(event.elapsedMs)}
                      </span>
                    </div>

                    {(event.detail ?? event.code) && (
                      <div className="mt-0.5 text-xs text-fg-tertiary">
                        {event.detail}
                        {event.detail && event.code ? " · " : null}
                        {event.code && (
                          <span className="kairos-mono text-[10.5px]">
                            {event.code}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-border-medium/60 px-5 py-4">
        <p className="text-[11.5px] leading-relaxed text-fg-tertiary">
          {t("trailRetention")}
        </p>
        <button
          type="button"
          disabled={events.length === 0}
          onClick={() => exportTrail(events)}
          className="kairos-stamp flex w-fit items-center gap-1.5 text-[10px] text-accent-primary transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="h-3 w-3" />
          {t("trailExport")}
        </button>
      </div>
    </div>
  );
}

/** Time since the turn started, at the precision the number deserves. */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Hand the trail over as a file.
 *
 * JSON rather than a screenshot of the panel: the point of exporting a trail is
 * to attach it to a bug report or a compliance record, and both want the raw
 * timings rather than the rendering of them.
 */
function exportTrail(events: TrailEvent[]): void {
  const blob = new Blob(
    [
      JSON.stringify(
        events.map((e) => ({
          kind: e.kind,
          label: e.label,
          detail: e.detail,
          code: e.code,
          elapsedMs: Math.round(e.elapsedMs),
          at: e.at.toISOString(),
        })),
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kairos-turn-${String(Date.now())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
