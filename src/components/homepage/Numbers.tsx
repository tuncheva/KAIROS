"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CountUp } from "~/components/homepage/CountUp";
import { useInView, useOnScreen, useReducedMotion } from "~/components/homepage/landingMotion";

const CONVERSATIONAL = ["workspace_concierge", "task_planner", "notes_vault", "events_publisher", "org_admin"] as const;
const AVATARS = ["k-avatar-1", "k-avatar-2", "k-avatar-3", "k-avatar-4", "k-avatar-1"] as const;

/** A figure tile: a small live illustration, then the number and what it means. */
function Tile({ value, caption, children }: { value: number; caption: string; children: ReactNode }) {
    const ref = useRef<HTMLElement>(null);
    const seen = useInView(ref);
    return (
        <article
            ref={ref}
            data-spotlight
            className={`k-sheet k-spot k-play hover:border-fg-primary/16 relative flex flex-col gap-5 p-[22px] transition-colors duration-300 ${seen ? "is-in" : ""}`}
        >
            <div className="flex h-[72px] items-center" aria-hidden="true">
                {children}
            </div>
            <div className="flex flex-col gap-2">
                <span className="font-display text-fg-primary text-[clamp(44px,5vw,64px)] leading-none tracking-[-0.035em]">
                    {value === 0 ? <span className="tabular-nums">0</span> : <CountUp to={value} duration={1000} />}
                </span>
                <span className="text-fg-tertiary max-w-[260px] text-sm leading-[1.55]">{caption}</span>
            </div>
        </article>
    );
}

/** Five agents behind one conversation: the hand-off travels from one to the next. */
function AgentsVisual() {
    const tAgents = useTranslations("agents");
    return (
        <div className="flex items-center">
            {CONVERSATIONAL.map((id, i) => (
                <span
                    key={id}
                    title={tAgents(`names.${id}`)}
                    style={{ "--i": i } as CSSProperties}
                    className={`k-agent-turn ${AVATARS[i]} border-bg-elevated text-fg-primary font-display relative flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm ${
                        i > 0 ? "-ml-2" : ""
                    }`}
                >
                    {tAgents(`names.${id}`)[0]}
                </span>
            ))}
        </div>
    );
}

/** Two agents on the clock, each with its schedule run sweeping along. */
function ScheduleVisual() {
    const t = useTranslations("landing.numbers");
    const tAgents = useTranslations("agents");
    const rows = [
        { id: "daily_brief", when: t("hemeraWhen") },
        { id: "risk_radar", when: t("argusWhen") },
    ];
    return (
        <div className="flex w-full flex-col gap-2.5">
            {rows.map((row, i) => (
                <div key={row.id} className="flex flex-col gap-1">
                    <div className="flex justify-between gap-2 text-[11.5px]">
                        <span className="text-fg-secondary">{tAgents(`names.${row.id}`)}</span>
                        <span className="text-fg-tertiary font-mono text-[10px] tracking-[0.08em]">{row.when}</span>
                    </div>
                    <div className="bg-fg-primary/8 relative h-1 overflow-hidden rounded-full">
                        <i
                            style={{ "--i": i } as CSSProperties}
                            className="k-schedule-run bg-accent-primary absolute inset-y-0 left-0 block w-full rounded-full"
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Draft → you → applied: the change stops at the gate until you approve it. */
function ApprovalVisual() {
    const t = useTranslations("landing.numbers");
    const stops = [t("pipeDraft"), t("pipeYou"), t("pipeApplied")];
    return (
        <div className="w-full">
            <div className="relative mx-2 h-6">
                <span className="bg-fg-primary/12 absolute inset-x-0 top-1/2 h-px -translate-y-1/2" />
                {stops.map((label, i) => (
                    <span
                        key={label}
                        className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
                            i === 1
                                ? "k-gate border-accent-primary bg-bg-elevated"
                                : "border-fg-primary/30 bg-bg-elevated"
                        }`}
                        style={{ left: `${i * 50}%` }}
                    />
                ))}
                <span className="k-pipe-dot bg-accent-primary absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
            </div>
            <div className="text-fg-tertiary mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.08em] uppercase">
                {stops.map((label, i) => (
                    <span key={label} className={i === 1 ? "text-accent-primary" : ""}>
                        {label}
                    </span>
                ))}
            </div>
        </div>
    );
}

const CIPHER = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const START = "k7Rz9Q+2mVb4XeT1/aLw";

/** A locked note's ciphertext, shifting a few characters at a time while seen. */
function LockVisual() {
    const ref = useRef<HTMLDivElement>(null);
    const onScreen = useOnScreen(ref, 0.3);
    const reduced = useReducedMotion();
    const [text, setText] = useState(START);

    useEffect(() => {
        if (!onScreen || reduced) return;
        const id = setInterval(() => {
            setText((prev) =>
                Array.from(prev, (ch) =>
                    Math.random() < 0.18 ? CIPHER[Math.floor(Math.random() * CIPHER.length)]! : ch,
                ).join(""),
            );
        }, 110);
        return () => clearInterval(id);
    }, [onScreen, reduced]);

    return (
        <div ref={ref} className="flex w-full items-center gap-3">
            <span className="border-accent-primary/40 text-accent-primary flex h-10 w-10 flex-none items-center justify-center rounded-md border">
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
            </span>
            <span className="text-fg-tertiary truncate font-mono text-[13px] tracking-[0.06em]">{text}</span>
        </div>
    );
}

/**
 * Facts about the product as four live tiles. Each figure is true of the code:
 * five conversational agents behind one chat, two scheduled ones (opt-in, at
 * the hour each person picks), no write without approval, and AES-256-GCM on
 * locked notes. The illustrations loop only under motion; without it they
 * are drawn still.
 */
export function Numbers() {
    const t = useTranslations("landing.numbers");

    return (
        <section aria-label={t("label")} className="mx-auto w-full max-w-[1440px] px-6 pt-32 lg:px-20 lg:pt-[200px]">
            <div data-stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Tile value={5} caption={t("agents")}>
                    <AgentsVisual />
                </Tile>
                <Tile value={2} caption={t("scheduled")}>
                    <ScheduleVisual />
                </Tile>
                <Tile value={0} caption={t("approval")}>
                    <ApprovalVisual />
                </Tile>
                <Tile value={256} caption={t("encryption")}>
                    <LockVisual />
                </Tile>
            </div>
        </section>
    );
}
