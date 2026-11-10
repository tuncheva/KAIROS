"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { prefersReducedMotion } from "~/components/homepage/useLandingReveals";
import { useOnScreen } from "~/components/homepage/landingMotion";

const TASKS = [
    { key: "panelTask1", week: 40 },
    { key: "panelTask2", week: 41 },
    { key: "panelTask3", week: 42 },
] as const;

/** Step at which each part appears, and (optionally) the step it leaves at. */
const AT = {
    request: [1],
    route: [2],
    typing: [3, 4],
    reply: [4],
    draft: [5],
    actions: [6, 7],
    applied: [7],
} as const satisfies Record<string, readonly number[]>;

const APPLIED = 7;

const wait = (ms: number, alive: () => boolean) =>
    new Promise<void>((resolve, reject) => setTimeout(() => (alive() ? resolve() : reject(new Error("stopped"))), ms));

/**
 * A scripted replay of the assistant, on a loop: the request is typed into the
 * composer and sent, Mentor routes it to the planner, the typing dots show and
 * fold, the reply and the draft land row by row, a cursor presses Approve, the
 * tasks tick over and the undo window drains. Then it fades and starts again.
 *
 * It starts when `active` turns on (the intro curtain has lifted), and only
 * loops while it is on screen. Under reduced motion it is drawn once at its
 * approved end.
 *
 * It is an illustration, so the "buttons" are spans — nothing here is a
 * control a visitor could reach and press to no effect. Every part stays in
 * the DOM and is hidden with `.k-hide`, so its text is whole for a reader.
 */
export function HeroAgentPanel({ active }: { active: boolean }) {
    const t = useTranslations("home");
    const tl = useTranslations("landing");
    const tAgents = useTranslations("agents");

    const figureRef = useRef<HTMLElement>(null);
    const approveRef = useRef<HTMLSpanElement>(null);
    const onScreen = useOnScreen(figureRef, 0.1);
    const onScreenRef = useRef(onScreen);
    onScreenRef.current = onScreen;

    const [step, setStep] = useState(0);
    const [typed, setTyped] = useState("");
    const [armed, setArmed] = useState(false);
    const [cursor, setCursor] = useState<{ on: boolean; x: number; y: number; press: boolean }>({
        on: false,
        x: 0,
        y: 0,
        press: false,
    });
    const [fading, setFading] = useState(false);

    const request = t("panelUserMessage");

    useEffect(() => {
        if (!active) return;
        if (prefersReducedMotion()) {
            setStep(APPLIED);
            return;
        }

        let alive = true;
        const isAlive = () => alive;
        const pause = (ms: number) => wait(ms, isAlive);

        const run = async () => {
            let first = true;
            for (;;) {
                setFading(false);
                setCursor((c) => ({ ...c, on: false, press: false }));
                setStep(0);
                setTyped("");
                await pause(first ? 1500 : 400);
                first = false;

                for (let i = 1; i <= request.length; i++) {
                    setTyped(request.slice(0, i));
                    await pause(request[i - 1] === " " ? 34 : 22 + Math.random() * 26);
                }
                setArmed(true);
                await pause(380);
                setArmed(false);
                setTyped("");
                setStep(1);
                await pause(800);
                setStep(2);
                await pause(900);
                setStep(3);
                await pause(1100);
                setStep(4);
                await pause(700);
                setStep(5);
                await pause(1300);
                setStep(6);
                await pause(900);

                const fig = figureRef.current?.getBoundingClientRect();
                const btn = approveRef.current?.getBoundingClientRect();
                if (fig && btn) {
                    setCursor({ on: true, x: fig.width - 60, y: fig.height - 40, press: false });
                    await pause(60);
                    setCursor({
                        on: true,
                        x: btn.left - fig.left + btn.width * 0.55,
                        y: btn.top - fig.top + btn.height * 0.5,
                        press: false,
                    });
                    await pause(1100);
                    setCursor((c) => ({ ...c, press: true }));
                    await pause(160);
                }
                setCursor((c) => ({ ...c, press: false }));
                setStep(APPLIED);
                await pause(500);
                setCursor((c) => ({ ...c, on: false }));
                await pause(5200);
                setFading(true);
                await pause(600);
                while (!onScreenRef.current || document.hidden) await pause(500);
            }
        };

        run().catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [active, request]);

    const shown = (part: keyof typeof AT) => {
        const [from, until] = AT[part] as readonly [number, number?];
        return step >= from && (until === undefined || step < until);
    };
    const part = (name: keyof typeof AT, extra = "") => `${shown(name) ? "k-show" : "k-hide"} ${extra}`;
    const applied = step >= APPLIED;

    const vars = {
        "--k-cx": `${cursor.x}px`,
        "--k-cy": `${cursor.y}px`,
    } as CSSProperties;

    return (
        <figure
            ref={figureRef}
            aria-label={t("panelTitle")}
            style={vars}
            className={`k-sheet k-sheet-lg k-tilt k-sheen relative m-0 flex h-[650px] flex-col ${applied ? "is-applied" : ""}`}
        >
            <div className="border-fg-primary/6 flex h-14 flex-shrink-0 items-center justify-between border-b px-[22px]">
                <span className="text-fg-primary flex items-center gap-2.5 text-sm">
                    <span className="k-live-dot h-[7px] w-[7px] rounded-full" aria-hidden="true" />
                    {t("panelTitle")}
                </span>
                <span className="text-fg-tertiary font-mono text-[10px] tracking-[0.18em] uppercase">
                    {t("panelMode")}
                </span>
            </div>

            <div
                className={`flex min-h-0 flex-grow flex-col gap-3.5 overflow-hidden px-[22px] py-[22px] transition-opacity duration-500 ${fading ? "opacity-0" : ""}`}
            >
                <div
                    className={part(
                        "request",
                        "bg-fg-primary/7 text-fg-primary max-w-[300px] self-end rounded-lg rounded-br-xs px-4 py-3 text-[14.5px] leading-[1.55]",
                    )}
                >
                    {request}
                </div>

                <div className={part("route", "text-fg-tertiary flex flex-wrap items-center gap-2 text-xs")}>
                    <span className="border-fg-primary/12 text-fg-secondary inline-flex h-[26px] items-center rounded-sm border px-2.5">
                        {tAgents("names.workspace_concierge")}
                    </span>
                    <span
                        className="k-route-line bg-fg-primary/25 relative h-px w-[34px] overflow-hidden"
                        aria-hidden="true"
                    />
                    <span className="border-accent-primary/45 text-accent-primary inline-flex h-[26px] items-center rounded-sm border px-2.5">
                        {tAgents("names.task_planner")} · {tAgents("roles.task_planner")}
                    </span>
                </div>

                <div className={part("typing", "flex gap-[5px] px-0.5 py-1.5")} aria-hidden="true">
                    {[0, 0.15, 0.3].map((d) => (
                        <span
                            key={d}
                            className="bg-fg-quaternary h-1.5 w-1.5 rounded-full"
                            style={{ animation: "k-dot 1s ease-in-out infinite", animationDelay: `${d}s` }}
                        />
                    ))}
                </div>

                <div className={part("reply", "flex flex-col gap-1.5")}>
                    <span className="text-accent-primary font-mono text-[10px] tracking-[0.18em] uppercase">
                        {tAgents("names.task_planner")} · {tAgents("roles.task_planner")}
                    </span>
                    <span className="text-fg-secondary text-[14.5px] leading-[1.6]">{t("panelReply")}</span>
                </div>

                <div className={part("draft", "border-fg-primary/9 overflow-hidden rounded-lg border")}>
                    <div className="border-fg-primary/6 text-fg-tertiary flex items-center justify-between gap-3 border-b px-3.5 py-2.5 text-xs">
                        <span>{t("panelDraft")}</span>
                        <span
                            className={`inline-flex h-[26px] items-center rounded-sm border px-2.5 transition-colors duration-400 ${
                                applied
                                    ? "border-status-success-border bg-status-success-surface text-status-success-ink"
                                    : "border-accent-primary/45 text-accent-primary"
                            }`}
                        >
                            {applied ? tl("panelApproved") : t("panelNeedsApproval")}
                        </span>
                    </div>
                    {TASKS.map((task, i) => (
                        <div
                            key={task.key}
                            className={`text-fg-primary flex items-center gap-3 px-3.5 py-[11px] text-sm ${
                                shown("draft") ? "k-show-row" : ""
                            } ${i > 0 ? "border-fg-primary/6 border-t" : ""}`}
                            style={{ animationDelay: `${0.25 + i * 0.15}s` }}
                        >
                            <span
                                className="k-box border-fg-primary/25 text-bg-primary inline-flex h-4 w-4 flex-none items-center justify-center rounded-xs border"
                                style={{ transitionDelay: `${i * 0.12}s` }}
                                aria-hidden="true"
                            >
                                <svg
                                    className="k-check"
                                    style={{ transitionDelay: `${i * 0.12}s` }}
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
                            <span>{t(task.key)}</span>
                            <span className="text-fg-tertiary ml-auto shrink-0 text-xs">
                                {t("panelWeek", { week: task.week })}
                            </span>
                        </div>
                    ))}
                </div>

                <div className={part("actions", "mt-auto flex gap-2.5")} aria-hidden="true">
                    <span
                        ref={approveRef}
                        className={`bg-accent-primary text-bg-primary inline-flex h-10 items-center rounded-full px-[18px] text-[13.5px] font-semibold transition-transform duration-150 ${
                            shown("actions") ? "k-ring-loop" : ""
                        } ${cursor.press ? "scale-95" : ""}`}
                    >
                        {t("panelApprove")}
                    </span>
                    <span className="border-fg-primary/14 text-fg-primary inline-flex h-10 items-center rounded-full border px-[18px] text-[13.5px]">
                        {t("panelAdjust")}
                    </span>
                </div>

                <div
                    className={part(
                        "applied",
                        "border-status-success-border bg-status-success-surface mt-auto flex flex-col gap-2.5 rounded-lg border px-3.5 py-3",
                    )}
                >
                    <div className="text-status-success-ink flex items-center justify-between gap-3 text-[13.5px]">
                        <span className="inline-flex items-center gap-2">
                            <svg
                                width="14"
                                height="14"
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
                            {tl("panelApplied")}
                        </span>
                        <span className="border-fg-primary/35 text-fg-primary border-b text-[13px]">{tl("undo")}</span>
                    </div>
                    <div className="bg-status-success-ink/20 h-0.5 overflow-hidden rounded-full" aria-hidden="true">
                        <i className={`bg-status-success-ink block h-full ${shown("applied") ? "k-drain" : ""}`} />
                    </div>
                </div>
            </div>

            <div
                className={`border-fg-primary/10 bg-bg-surface mx-3.5 mb-3.5 flex h-12 flex-none items-center gap-2 rounded-lg border pr-2 pl-4 text-sm transition-opacity duration-500 ${fading ? "opacity-0" : ""}`}
                aria-hidden="true"
            >
                <span className="min-w-0 truncate">
                    {typed ? typed : <span className="text-fg-tertiary">{tl("composePlaceholder")}</span>}
                </span>
                <span className="k-caret bg-accent-primary h-[18px] w-[1.5px] flex-none" />
                <span
                    className={`ml-auto inline-flex h-8 w-8 flex-none items-center justify-center rounded-full transition-colors duration-300 ${
                        armed ? "bg-accent-primary text-bg-primary" : "bg-fg-primary/8 text-fg-tertiary"
                    }`}
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M12 19V5M6 11l6-6 6 6" />
                    </svg>
                </span>
            </div>

            <svg
                className={`k-cursor pointer-events-none absolute top-0 left-0 z-[4] h-[22px] w-[22px] ${cursor.on ? "opacity-100" : "opacity-0"}`}
                viewBox="0 0 24 24"
                aria-hidden="true"
            >
                <path
                    d="M4 2.5 19.5 12l-7 1.6-3.6 6.6z"
                    className="fill-fg-primary stroke-bg-primary"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                />
            </svg>
        </figure>
    );
}
