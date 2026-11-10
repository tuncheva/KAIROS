"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { useInView, useReducedMotion } from "~/components/homepage/landingMotion";

const COLS = 18;
const ROWS = 8;

/** Four sample regions, each a centre on the abstract dot field. */
const REGIONS = [
    { id: "sofia", key: "regionSofia", col: 4, row: 4, suggested: true },
    { id: "plovdiv", key: "regionPlovdiv", col: 9, row: 5, suggested: true },
    { id: "staraZagora", key: "regionStaraZagora", col: 11, row: 4, suggested: false },
    { id: "varna", key: "regionVarna", col: 16, row: 2, suggested: false },
] as const;
type RegionId = (typeof REGIONS)[number]["id"];

const SUGGESTED = REGIONS.filter((r) => r.suggested).map((r) => r.id);
const RADIUS = 1.8;

/**
 * Region targeting, the way Iris drafts it: the events agent suggests the
 * regions near the venue, the dot field lights up in a ripple out from each
 * pin, and the draft waits for approval. Every region row is a real toggle,
 * so a visitor can widen or narrow the audience and watch the field follow.
 *
 * Drawn with the suggestion already applied (server, no script, reduced
 * motion); with motion, the suggestion plays in when the card is first seen.
 */
export function RegionTargeting() {
    const t = useTranslations("landing.events");
    const tAgents = useTranslations("agents");
    const ref = useRef<HTMLDivElement>(null);
    const seen = useInView(ref);
    const reduced = useReducedMotion();
    const [selected, setSelected] = useState<RegionId[]>(SUGGESTED);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    useEffect(() => {
        if (!seen || reduced) return;
        setSelected([]);
        SUGGESTED.forEach((id, i) => {
            timers.current.push(setTimeout(() => setSelected((s) => (s.includes(id) ? s : [...s, id])), 350 + i * 380));
        });
        const pending = timers.current;
        return () => pending.forEach(clearTimeout);
    }, [seen, reduced]);

    const toggle = (id: RegionId) => {
        timers.current.forEach(clearTimeout);
        setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    };

    const active = REGIONS.filter((r) => selected.includes(r.id));

    return (
        <div ref={ref} className={`k-sheet k-play bg-bg-surface flex flex-col gap-4 p-[18px] ${seen ? "is-in" : ""}`}>
            <div className="flex items-center justify-between gap-3">
                <span className="text-fg-tertiary font-mono text-[10px] tracking-[0.18em] uppercase">
                    {t("regionLabel")}
                </span>
                <span className="border-accent-primary/45 text-accent-primary inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-[11px]">
                    <span className="k-live-dot h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                    {tAgents("names.events_publisher")}
                </span>
            </div>

            <div className="relative grid grid-cols-[repeat(18,1fr)] gap-[5px]" aria-hidden="true">
                {Array.from({ length: COLS * ROWS }, (_, i) => {
                    const col = i % COLS;
                    const row = Math.floor(i / COLS);
                    let nearest = Infinity;
                    for (const r of active) nearest = Math.min(nearest, Math.hypot(col - r.col, row - r.row));
                    const lit = nearest <= RADIUS;
                    return (
                        <i
                            key={i}
                            style={{ "--d": lit ? nearest.toFixed(2) : 0 } as CSSProperties}
                            className={`k-region-dot aspect-square rounded-full ${lit ? "is-lit" : ""}`}
                        />
                    );
                })}
                {active.map((r) => (
                    <span
                        key={r.id}
                        className="k-pin k-pin-drop bg-accent-primary absolute -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full"
                        style={{ left: `${((r.col + 0.5) / COLS) * 100}%`, top: `${((r.row + 0.5) / ROWS) * 100}%` }}
                    />
                ))}
            </div>

            <ul className="m-0 flex list-none flex-col p-0" aria-label={t("regionsLabel")}>
                {REGIONS.map((r, i) => {
                    const on = selected.includes(r.id);
                    return (
                        <li key={r.id} className={i > 0 ? "border-fg-primary/6 border-t" : ""}>
                            <button
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggle(r.id)}
                                className="hover:bg-fg-primary/3 flex w-full items-center gap-2.5 rounded-xs px-1 py-2 text-left text-[13px] transition-colors"
                            >
                                <span
                                    className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-xs border transition-colors duration-300 ${
                                        on
                                            ? "border-accent-primary bg-accent-primary text-bg-primary"
                                            : "border-fg-primary/25 text-transparent"
                                    }`}
                                    aria-hidden="true"
                                >
                                    <svg
                                        width="10"
                                        height="10"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="3.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M20 6 9 17l-5-5" />
                                    </svg>
                                </span>
                                <span className={on ? "text-fg-primary" : "text-fg-secondary"}>{t(r.key)}</span>
                                {r.suggested && (
                                    <span className="text-accent-primary ml-auto font-mono text-[10px] tracking-[0.14em] uppercase">
                                        {t("regionSuggested")}
                                    </span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>

            <div className="border-fg-primary/8 flex items-center justify-between gap-3 border-t pt-3.5">
                <span className="text-fg-tertiary text-xs" aria-live="polite">
                    {t("regionFooter", { count: active.length })}
                </span>
                <span
                    aria-hidden="true"
                    className="k-ring-loop bg-accent-primary text-bg-primary inline-flex h-8 flex-none items-center rounded-full px-3.5 text-[12.5px] font-semibold"
                >
                    {t("regionApprove")}
                </span>
            </div>
        </div>
    );
}
