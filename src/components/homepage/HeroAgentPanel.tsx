"use client";

import { useTranslations } from "next-intl";

const TASKS = [
    { key: "panelTask1", week: 40, delay: "[animation-delay:3.6s]" },
    { key: "panelTask2", week: 41, delay: "[animation-delay:3.75s]" },
    { key: "panelTask3", week: 42, delay: "[animation-delay:3.9s]" },
] as const;

/**
 * A scripted replay of the assistant: the request lands, the typing dots show
 * and collapse, the planner answers and the draft fills in row by row, then the
 * approve button starts to pulse. Timings are the design file's, counted from
 * `.k-on`.
 *
 * It is an illustration, so the "buttons" are spans — nothing here is a
 * control a visitor could reach and press to no effect.
 */
export function HeroAgentPanel() {
    const t = useTranslations("home");

    return (
        <figure
            aria-label={t("panelTitle")}
            className="k-sheet k-sheet-lg k-in-panel m-0 flex flex-col [animation-delay:1s] lg:col-span-5 lg:col-start-8 lg:h-[600px]"
        >
            <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-fg-primary/6 px-[22px]">
                <span className="flex items-center gap-2.5 text-sm text-fg-primary">
                    <span className="k-live-dot h-[7px] w-[7px] rounded-full" aria-hidden="true" />
                    {t("panelTitle")}
                </span>
                <span className="font-mono text-[10px] tracking-[0.18em] text-fg-quaternary uppercase">
                    {t("panelMode")}
                </span>
            </div>

            <div className="flex flex-grow flex-col gap-4 px-[22px] py-6">
                <div className="k-in-up max-w-[300px] self-end rounded-lg rounded-br-sm bg-fg-primary/7 px-4 py-3 text-[14.5px] leading-[1.55] text-fg-primary [animation-delay:1.9s]">
                    {t("panelUserMessage")}
                </div>

                <div className="k-typing flex gap-[5px] overflow-hidden px-0.5 py-1.5" aria-hidden="true">
                    <span className="h-1.5 w-1.5 rounded-full bg-fg-quaternary" />
                    <span className="h-1.5 w-1.5 rounded-full bg-fg-quaternary [animation-delay:0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-fg-quaternary [animation-delay:0.3s]" />
                </div>

                <div className="k-in-up flex flex-col gap-1.5 [animation-delay:3.1s]">
                    <span className="font-mono text-[10px] tracking-[0.18em] text-accent-primary uppercase">
                        {t("agentPlannerName")}
                    </span>
                    <span className="text-[14.5px] leading-[1.6] text-fg-secondary">{t("panelReply")}</span>
                </div>

                <div className="k-in-up overflow-hidden rounded-lg border border-fg-primary/9 [animation-delay:3.4s]">
                    <div className="flex justify-between gap-4 border-b border-fg-primary/6 px-4 py-3 text-xs text-fg-quaternary">
                        <span>{t("panelDraft")}</span>
                        <span>{t("panelNeedsApproval")}</span>
                    </div>
                    {TASKS.map((task, i) => (
                        <div
                            key={task.key}
                            className={`k-in-up flex items-center justify-between gap-4 px-4 py-3 text-sm text-fg-primary ${task.delay} ${
                                i < TASKS.length - 1 ? "border-b border-fg-primary/6" : ""
                            }`}
                        >
                            <span>{t(task.key)}</span>
                            <span className="shrink-0 text-xs text-fg-quaternary">
                                {t("panelWeek", { week: task.week })}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="k-in-up mt-auto flex gap-2.5 pt-2 [animation-delay:4.2s]" aria-hidden="true">
                    <span className="k-ring inline-flex h-10 items-center rounded-full bg-accent-primary px-[18px] text-[13.5px] font-semibold text-bg-primary">
                        {t("panelApprove")}
                    </span>
                    <span className="inline-flex h-10 items-center rounded-full border border-fg-primary/14 px-[18px] text-[13.5px] text-fg-primary">
                        {t("panelAdjust")}
                    </span>
                </div>
            </div>
        </figure>
    );
}
