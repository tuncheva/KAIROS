"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { SectionHead, Tag } from "~/components/homepage/landingParts";
import { useOnScreen, useReducedMotion } from "~/components/homepage/landingMotion";

type Mark = "dot" | "warn" | "accent" | "check" | "lock" | "avatar";
type Row = { key: "r1" | "r2" | "r3"; mark?: Mark; metaTone?: "warn" | "accent" };
type Agent = {
    id: string;
    tag: "agentTagReadOnly" | "agentTagDrafts" | "agentTagPrivate" | "agentTagScheduled";
    scheduled?: boolean;
    attachment?: boolean;
    head?: "plain" | "accent";
    rows: Row[];
};

/** The order the roster shows, with what each one's replay draws. */
const AGENTS: Agent[] = [
    {
        id: "workspace_concierge",
        tag: "agentTagReadOnly",
        head: "plain",
        rows: [
            { key: "r1", mark: "warn", metaTone: "warn" },
            { key: "r2", mark: "dot" },
        ],
    },
    {
        id: "task_planner",
        tag: "agentTagDrafts",
        attachment: true,
        head: "accent",
        rows: [{ key: "r1" }, { key: "r2" }, { key: "r3" }],
    },
    {
        id: "notes_vault",
        tag: "agentTagPrivate",
        rows: [
            { key: "r1", mark: "check" },
            { key: "r2", mark: "check" },
            { key: "r3", mark: "lock" },
        ],
    },
    {
        id: "events_publisher",
        tag: "agentTagDrafts",
        head: "accent",
        rows: [{ key: "r1" }, { key: "r2" }],
    },
    {
        id: "org_admin",
        tag: "agentTagDrafts",
        rows: [{ key: "r1", mark: "avatar", metaTone: "accent" }, { key: "r2" }, { key: "r3" }],
    },
    {
        id: "daily_brief",
        tag: "agentTagScheduled",
        scheduled: true,
        rows: [
            { key: "r1", mark: "accent" },
            { key: "r2", mark: "dot" },
            { key: "r3", mark: "accent" },
        ],
    },
    {
        id: "risk_radar",
        tag: "agentTagScheduled",
        scheduled: true,
        rows: [
            { key: "r1", mark: "warn", metaTone: "warn" },
            { key: "r2", mark: "warn", metaTone: "warn" },
            { key: "r3", mark: "dot" },
        ],
    },
];

const FIRST_SCHEDULED = AGENTS.findIndex((a) => a.scheduled);

function RowMark({ mark, name }: { mark?: Mark; name: string }) {
    switch (mark) {
        case "dot":
            return <span className="bg-fg-quaternary h-[7px] w-[7px] flex-none rounded-full" aria-hidden="true" />;
        case "warn":
            return <span className="bg-status-warning-ink h-[7px] w-[7px] flex-none rounded-full" aria-hidden="true" />;
        case "accent":
            return <span className="bg-accent-primary h-[7px] w-[7px] flex-none rounded-full" aria-hidden="true" />;
        case "check":
            return (
                <svg
                    className="text-status-success-ink flex-none"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M20 6 9 17l-5-5" />
                </svg>
            );
        case "lock":
            return (
                <svg
                    className="text-accent-primary flex-none"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
            );
        case "avatar":
            return (
                <span
                    className="k-avatar-3 text-fg-primary flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-xs"
                    aria-hidden="true"
                >
                    {name[0]}
                </span>
            );
        default:
            return null;
    }
}

/**
 * The agent roster as tabs, each with a short replay of what that agent does:
 * the question (or the schedule that wakes it), typing dots, the reply, then
 * the thing it drafted. The replay is plain CSS keyed off a fresh mount per
 * agent, so switching tabs restarts it.
 *
 * Autoplay walks the roster every seven seconds — a hairline fills under the
 * active tab — and pauses while the pointer or focus is inside the section or
 * the panel is off screen. The first click or arrow key hands control to the
 * visitor for good. No autoplay under reduced motion.
 */
export function Agents() {
    const t = useTranslations("home");
    const tl = useTranslations("landing.agents");
    const tAgents = useTranslations("agents");

    const reduced = useReducedMotion();
    const panelRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const panelOnScreen = useOnScreen(panelRef, 0.3);

    const [index, setIndex] = useState(0);
    const [auto, setAuto] = useState(true);
    const [hovered, setHovered] = useState(false);

    useEffect(() => {
        if (reduced) setAuto(false);
    }, [reduced]);

    const select = (i: number, focus = false) => {
        setIndex(i);
        if (focus) tabRefs.current[i]?.focus();
    };
    const takeOver = (i: number, focus = false) => {
        setAuto(false);
        select(i, focus);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        const last = AGENTS.length - 1;
        const moves: Record<string, number> = {
            ArrowDown: (index + 1) % AGENTS.length,
            ArrowRight: (index + 1) % AGENTS.length,
            ArrowUp: (index + last) % AGENTS.length,
            ArrowLeft: (index + last) % AGENTS.length,
            Home: 0,
            End: last,
        };
        const next = moves[event.key];
        if (next === undefined) return;
        event.preventDefault();
        takeOver(next, true);
    };

    const agent = AGENTS[index]!;
    const name = tAgents(`names.${agent.id}`);
    const role = tAgents(`roles.${agent.id}`);
    const paused = hovered || !panelOnScreen;

    const tab = (a: Agent, i: number) => {
        const selected = i === index;
        return (
            <button
                key={a.id}
                ref={(el) => {
                    tabRefs.current[i] = el;
                }}
                id={`agent-tab-${a.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="agent-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => takeOver(i)}
                onKeyDown={onKeyDown}
                className={`k-tab k-item border-fg-primary/6 relative grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b py-4 text-left ${
                    selected ? "pl-4" : "pl-1"
                }`}
            >
                <span className="flex flex-wrap items-baseline gap-x-2.5">
                    <span
                        className={`font-display text-[22px] tracking-[-0.01em] transition-colors ${selected ? "text-fg-primary" : "text-fg-tertiary"}`}
                    >
                        {tAgents(`names.${a.id}`)}
                    </span>
                    <span className="text-fg-tertiary text-[13px]">{tAgents(`roles.${a.id}`)}</span>
                </span>
                <Tag accent={a.scheduled}>{t(a.tag)}</Tag>
                <i
                    aria-hidden="true"
                    className="k-tab-bar bg-accent-primary/80 absolute inset-x-0 -bottom-px block h-px"
                    onAnimationEnd={() => {
                        if (auto) select((i + 1) % AGENTS.length);
                    }}
                />
            </button>
        );
    };

    const groupLabel =
        "border-b border-fg-primary/8 pb-3 font-mono text-[10px] tracking-[0.18em] text-fg-tertiary uppercase";

    return (
        <section
            id="agents"
            aria-labelledby="agents-h"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            className={`k-agents mx-auto w-full max-w-[1440px] scroll-mt-10 px-6 pt-32 lg:px-20 lg:pt-[200px] ${auto ? "is-auto" : ""} ${paused ? "is-paused" : ""}`}
        >
            <SectionHead
                id="agents-h"
                eyebrow={t("agentsEyebrow")}
                lead={t("agentsHeading")}
                accent={t("agentsHeadingAccent")}
                body={t("agentsBody")}
            />

            <div className="mt-16 grid grid-cols-1 items-start gap-y-12 lg:grid-cols-12 lg:gap-x-6">
                <div data-reveal className="flex flex-col lg:col-span-5">
                    <span id="agents-group-live" className={groupLabel}>
                        {tl("groupConversational")}
                    </span>
                    <div
                        role="tablist"
                        aria-labelledby="agents-group-live"
                        aria-orientation="vertical"
                        className="flex flex-col"
                    >
                        {AGENTS.slice(0, FIRST_SCHEDULED).map((a, i) => tab(a, i))}
                    </div>
                    <span id="agents-group-clock" className={`${groupLabel} pt-7`}>
                        {tl("groupScheduled")}
                    </span>
                    <div
                        role="tablist"
                        aria-labelledby="agents-group-clock"
                        aria-orientation="vertical"
                        className="flex flex-col"
                    >
                        {AGENTS.slice(FIRST_SCHEDULED).map((a, i) => tab(a, i + FIRST_SCHEDULED))}
                    </div>
                </div>

                <div
                    ref={panelRef}
                    id="agent-panel"
                    role="tabpanel"
                    aria-labelledby={`agent-tab-${agent.id}`}
                    data-reveal
                    className="k-sheet flex min-h-[470px] flex-col lg:sticky lg:top-[110px] lg:col-span-6 lg:col-start-7"
                >
                    <div className="border-fg-primary/6 flex h-14 items-center justify-between gap-3 border-b px-[22px]">
                        <span className="text-fg-primary flex min-w-0 items-center gap-1.5 text-sm whitespace-nowrap">
                            <span
                                className="k-live-dot mr-1 h-[7px] w-[7px] flex-none rounded-full"
                                aria-hidden="true"
                            />
                            {name}
                            <span className="text-fg-tertiary hidden truncate sm:inline">· {role}</span>
                        </span>
                        <Tag accent={agent.scheduled}>{t(agent.tag)}</Tag>
                    </div>

                    <div key={agent.id} className="flex flex-col gap-4 px-[22px] py-6">
                        {agent.scheduled ? (
                            <span className="k-ap-1 border-fg-primary/18 text-fg-tertiary inline-flex items-center gap-2 self-center rounded-full border border-dashed px-3 py-1.5 font-mono text-[11px] tracking-[0.12em]">
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    aria-hidden="true"
                                >
                                    <circle cx="12" cy="12" r="9" />
                                    <path d="M12 7v5l3 2" />
                                </svg>
                                {tl(`${agent.id}.schedule`)}
                            </span>
                        ) : (
                            <div className="k-ap-1 bg-fg-primary/7 text-fg-primary max-w-[340px] self-end rounded-lg rounded-br-xs px-4 py-3 text-[14.5px] leading-[1.55]">
                                {tl(`${agent.id}.ask`)}
                                {agent.attachment && (
                                    <span className="bg-fg-primary/6 text-fg-secondary mt-2 flex w-fit items-center gap-2 rounded-sm px-2.5 py-1.5 text-[12.5px]">
                                        <svg
                                            width="13"
                                            height="13"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            aria-hidden="true"
                                        >
                                            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                                            <path d="M14 3v5h5" />
                                        </svg>
                                        {tl(`${agent.id}.attachment`)}
                                    </span>
                                )}
                            </div>
                        )}

                        <div className="k-ap-typing flex gap-[5px] px-0.5 py-1" aria-hidden="true">
                            {[0, 0.15, 0.3].map((d) => (
                                <span
                                    key={d}
                                    className="bg-fg-quaternary h-1.5 w-1.5 rounded-full"
                                    style={{ animationDelay: `${d}s` }}
                                />
                            ))}
                        </div>

                        <div className="k-ap-2 flex flex-col gap-1.5">
                            <span className="text-accent-primary font-mono text-[10px] tracking-[0.18em] uppercase">
                                {name} · {role}
                            </span>
                            <p className="text-fg-secondary m-0 max-w-[520px] text-[15px] leading-[1.65]">
                                {tl(`${agent.id}.reply`)}
                            </p>
                        </div>

                        <div className="k-ap-3 border-fg-primary/9 overflow-hidden rounded-lg border">
                            {agent.head && (
                                <div className="border-fg-primary/6 text-fg-tertiary flex justify-between gap-3 border-b px-3.5 py-2.5 text-xs">
                                    <span>{tl(`${agent.id}.head`)}</span>
                                    <span className={agent.head === "accent" ? "text-accent-primary" : ""}>
                                        {tl(`${agent.id}.headMeta`)}
                                    </span>
                                </div>
                            )}
                            {agent.rows.map((row, i) => {
                                const label = tl(`${agent.id}.${row.key}`);
                                return (
                                    <div
                                        key={row.key}
                                        style={{ ["--i" as string]: i }}
                                        className={`k-ap-row text-fg-primary flex items-center gap-3 px-3.5 py-[11px] text-sm ${
                                            i > 0 ? "border-fg-primary/6 border-t" : ""
                                        }`}
                                    >
                                        <RowMark mark={row.mark} name={label} />
                                        <span className={row.mark === "lock" ? "text-fg-tertiary" : ""}>{label}</span>
                                        <span
                                            className={`ml-auto shrink-0 text-xs ${
                                                row.metaTone === "warn"
                                                    ? "text-status-warning-ink"
                                                    : row.metaTone === "accent"
                                                      ? "text-accent-primary"
                                                      : "text-fg-tertiary"
                                            }`}
                                        >
                                            {tl(`${agent.id}.${row.key}Meta`)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
