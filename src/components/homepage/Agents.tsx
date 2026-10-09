"use client";

import { useTranslations } from "next-intl";
import { Eyebrow, SectionHeading, Tag } from "~/components/homepage/landingParts";

const AGENTS = [
    { id: "workspace_concierge", body: "agentConciergeBody", tag: "agentTagReadOnly" },
    { id: "task_planner", body: "agentPlannerBody", tag: "agentTagDrafts" },
    { id: "notes_vault", body: "agentNotesBody", tag: "agentTagPrivate" },
    { id: "events_publisher", body: "agentEventsBody", tag: "agentTagDrafts" },
    { id: "daily_brief", body: "agentBriefBody", tag: "agentTagScheduled", accent: true },
] as const;

const POINTS = ["agentsPoint1", "agentsPoint2", "agentsPoint3"] as const;

/** The agent roster on the left, the "asks first" promise on the right. Below `lg` the copy leads. */
export function Agents() {
    const t = useTranslations("home");
    const tAgents = useTranslations("agents");

    return (
        <section
            id="agents"
            className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-y-12 px-6 pt-32 lg:grid-cols-12 lg:gap-x-6 lg:px-20 lg:pt-[200px]"
        >
            <ul data-reveal className="k-sheet m-0 list-none p-0 lg:col-span-6">
                {AGENTS.map((agent, i) => (
                    <li
                        key={agent.id}
                        className={`k-item grid grid-cols-[1fr_auto] items-center gap-4 p-[22px] ${
                            i < AGENTS.length - 1 ? "border-b border-fg-primary/6" : ""
                        }`}
                    >
                        <span className="flex flex-col gap-1">
                            <span className="flex items-baseline gap-2.5">
                                <span className="font-display text-2xl text-fg-primary">{tAgents(`names.${agent.id}`)}</span>
                                <span className="text-[13px] text-fg-tertiary">{tAgents(`roles.${agent.id}`)}</span>
                            </span>
                            <span className="text-[13.5px] text-fg-quaternary">{t(agent.body)}</span>
                        </span>
                        <Tag accent={"accent" in agent}>{t(agent.tag)}</Tag>
                    </li>
                ))}
            </ul>

            <div data-reveal className="order-first flex flex-col gap-7 lg:order-none lg:col-span-5 lg:col-start-8">
                <Eyebrow>{t("agentsEyebrow")}</Eyebrow>
                <SectionHeading lead={t("agentsHeading")} accent={t("agentsHeadingAccent")} />
                <p className="m-0 text-[17px] leading-[1.75] font-light text-fg-tertiary">{t("agentsBody")}</p>
                <ol className="m-0 flex list-none flex-col gap-3.5 border-t border-fg-primary/8 p-0 pt-6 text-[15px] text-fg-secondary">
                    {POINTS.map((key, i) => (
                        <li key={key} className="flex items-baseline gap-3.5">
                            <span className="font-mono text-[11px] text-accent-primary" aria-hidden="true">
                                {String(i + 1).padStart(2, "0")}
                            </span>
                            {t(key)}
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
