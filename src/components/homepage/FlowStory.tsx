"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SectionHead } from "~/components/homepage/landingParts";
import { prefersReducedMotion } from "~/components/homepage/useLandingReveals";
import { useReducedMotion } from "~/components/homepage/landingMotion";

gsap.registerPlugin(ScrollTrigger);

const STEPS = ["ask", "draft", "approve", "apply"] as const;
const APPLY = 3;

function Arrow() {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
        >
            <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
    );
}

/**
 * How a change happens: Ask → Draft → Approve → Apply, told on one card that
 * changes as you scroll. The section is a tall track with a sticky pin inside
 * it (both only exist with motion — see `.k-flow-track` / `.k-flow-pin`); a
 * ScrollTrigger over the track turns progress into the active step and fills
 * the hairline under it.
 *
 * The steps are buttons. With motion they scroll to their point on the track;
 * without it the track collapses and they simply select the step — so the
 * story works by keyboard and with motion off.
 */
export function FlowStory() {
    const t = useTranslations("landing.flow");
    const tl = useTranslations("landing");
    const tAgents = useTranslations("agents");
    const reduced = useReducedMotion();
    const trackRef = useRef<HTMLDivElement>(null);
    const stepsRef = useRef<HTMLOListElement>(null);
    const [step, setStep] = useState(0);

    useEffect(() => {
        const track = trackRef.current;
        if (!track || prefersReducedMotion()) return;

        const fill = (progress: number) => {
            const p = Math.min(progress, 0.9999);
            const k = Math.floor(p * STEPS.length);
            const local = p * STEPS.length - k;
            stepsRef.current?.querySelectorAll<HTMLElement>("[data-flow-step]").forEach((el, i) => {
                el.style.setProperty("--k-f", String(i < k ? 1 : i === k ? local.toFixed(3) : 0));
            });
            setStep(k);
        };

        const trigger = ScrollTrigger.create({
            trigger: track,
            start: "top top",
            end: "bottom bottom",
            onUpdate: (self) => fill(self.progress),
        });
        return () => trigger?.kill();
    }, []);

    const go = (i: number) => {
        const track = trackRef.current;
        if (!track || prefersReducedMotion()) {
            setStep(i);
            return;
        }
        const r = track.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        window.scrollTo({ top: window.scrollY + r.top + total * (i / STEPS.length + 0.03), behavior: "smooth" });
    };

    const applied = step === APPLY;
    const chip = "inline-flex h-[26px] items-center rounded-sm border px-2.5 text-xs whitespace-nowrap";

    return (
        <section id="how" aria-labelledby="how-h" className="scroll-mt-10 pt-32 lg:pt-[200px]">
            <div className="mx-auto w-full max-w-[1440px] px-6 lg:px-20">
                <SectionHead
                    id="how-h"
                    eyebrow={t("eyebrow")}
                    lead={t("heading")}
                    accent={t("headingAccent")}
                    body={t("body")}
                />
            </div>

            <div ref={trackRef} className="k-flow-track relative mt-6">
                <div className="k-flow-pin flex items-start pt-[88px] lg:items-center lg:pt-0">
                    <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-y-7 px-6 pt-8 lg:grid-cols-12 lg:gap-x-6 lg:px-20 lg:pt-0">
                        <ol
                            ref={stepsRef}
                            aria-label={t("stepsLabel")}
                            className="m-0 grid list-none grid-cols-4 gap-2 p-0 lg:col-span-5 lg:flex lg:flex-col lg:gap-0"
                        >
                            {STEPS.map((key, i) => {
                                const isActive = i === step;
                                const done = i < step;
                                return (
                                    <li
                                        key={key}
                                        data-flow-step
                                        className={`border-fg-primary/10 lg:border-fg-primary/8 border-b-2 lg:border-t lg:border-b-0 ${isActive ? "is-active" : ""}`}
                                        style={reduced ? ({ "--k-f": i <= step ? 1 : 0 } as CSSProperties) : undefined}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => go(i)}
                                            aria-current={isActive ? "step" : undefined}
                                            className="flex w-full flex-col gap-0.5 pb-2.5 text-left lg:grid lg:grid-cols-[44px_1fr] lg:gap-x-3 lg:gap-y-1 lg:py-[18px]"
                                        >
                                            <span
                                                className={`font-mono text-[11px] transition-colors lg:pt-[7px] ${isActive ? "text-accent-primary" : "text-fg-tertiary"}`}
                                            >
                                                {String(i + 1).padStart(2, "0")}
                                            </span>
                                            <span
                                                className={`font-display text-[17px] tracking-[-0.01em] transition-colors lg:text-[clamp(20px,2vw,26px)] ${
                                                    isActive || done ? "text-fg-primary" : "text-fg-tertiary"
                                                }`}
                                            >
                                                {t(`${key}Title`)}
                                            </span>
                                            <span className="k-step-body hidden lg:col-start-2 lg:grid">
                                                <span className="text-fg-tertiary max-w-[440px] text-[15px] leading-[1.7]">
                                                    {t(`${key}Body`)}
                                                </span>
                                            </span>
                                        </button>
                                        <i
                                            aria-hidden="true"
                                            className="k-step-rail bg-accent-primary -mt-0.5 -mb-0.5 block h-0.5 lg:-mt-px lg:mb-0 lg:h-px"
                                        />
                                    </li>
                                );
                            })}
                        </ol>

                        <div className="lg:col-span-6 lg:col-start-7">
                            <div
                                data-step={step}
                                className="k-sheet k-stage flex flex-col gap-3 p-[18px] lg:min-h-[460px] lg:gap-3.5 lg:p-7"
                            >
                                <div className="border-fg-primary/6 flex items-center justify-between border-b pb-3.5">
                                    <span className="text-fg-primary flex items-center gap-2.5 text-sm">
                                        <span className="k-live-dot h-[7px] w-[7px] rounded-full" aria-hidden="true" />
                                        {t("project")}
                                    </span>
                                    <span className="text-fg-tertiary font-mono text-[10px] tracking-[0.18em] uppercase">
                                        {t("stepOf", { step: step + 1 })}
                                    </span>
                                </div>

                                <p className="text-fg-tertiary m-0 text-sm leading-[1.6] lg:hidden">
                                    {t(`${STEPS[step]}Body`)}
                                </p>

                                <div className="bg-fg-primary/7 text-fg-primary max-w-[340px] self-end rounded-lg rounded-br-xs px-4 py-3 text-[14.5px] leading-[1.55]">
                                    {t("request")}
                                    {step === 0 && (
                                        <span
                                            className="k-caret bg-accent-primary ml-0.5 inline-block h-4 w-[1.5px] align-[-3px]"
                                            aria-hidden="true"
                                        />
                                    )}
                                </div>

                                <div className="text-fg-tertiary flex flex-wrap items-center gap-2">
                                    <span className={`${chip} border-fg-primary/12 text-fg-secondary`}>
                                        {tAgents("names.workspace_concierge")}
                                    </span>
                                    <span
                                        className="k-route-line bg-fg-primary/25 relative h-px w-[34px] overflow-hidden"
                                        aria-hidden="true"
                                    />
                                    <span className={`${chip} border-accent-primary/45 text-accent-primary`}>
                                        {tAgents("names.events_publisher")} · {tAgents("roles.events_publisher")}
                                    </span>
                                </div>

                                <div
                                    data-from="1"
                                    className={`overflow-hidden rounded-lg border transition-colors ${
                                        applied ? "border-status-success-border" : "border-fg-primary/9"
                                    }`}
                                >
                                    {[
                                        { label: t("rowDate"), old: t("oldDate"), next: t("newDate") },
                                        { label: t("rowRsvp"), old: t("oldWeek"), next: t("newWeek") },
                                        { label: t("rowNotify"), next: t("notifyWho") },
                                    ].map((row, i) => (
                                        <div
                                            key={row.label}
                                            className={`text-fg-primary grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-[9px] text-[13px] lg:px-3.5 lg:py-[11px] lg:text-sm ${
                                                i > 0 ? "border-fg-primary/6 border-t" : ""
                                            }`}
                                        >
                                            <span>{row.label}</span>
                                            <span className="inline-flex items-center gap-2 text-[13px]">
                                                {row.old && (
                                                    <>
                                                        <span className="text-fg-tertiary decoration-status-danger-ink line-through">
                                                            {row.old}
                                                        </span>
                                                        <Arrow />
                                                    </>
                                                )}
                                                <span>{row.next}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                {applied ? (
                                    <div className="border-status-success-border bg-status-success-surface flex flex-col gap-2.5 rounded-lg border px-3.5 py-3">
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
                                                {t("applied")}
                                            </span>
                                            <span className="border-fg-primary/35 text-fg-primary border-b text-[13px]">
                                                {tl("undo")}
                                            </span>
                                        </div>
                                        <div
                                            className="bg-status-success-ink/20 h-0.5 overflow-hidden rounded-full"
                                            aria-hidden="true"
                                        >
                                            <i className="k-drain bg-status-success-ink block h-full" />
                                        </div>
                                    </div>
                                ) : (
                                    <div data-from="2" className="flex flex-wrap gap-2.5" aria-hidden="true">
                                        <span className="k-ring-on bg-accent-primary text-bg-primary inline-flex h-10 items-center rounded-full px-[18px] text-[13.5px] font-semibold">
                                            {t("approve")}
                                        </span>
                                        <span className="border-fg-primary/14 text-fg-primary inline-flex h-10 items-center rounded-full border px-[18px] text-[13.5px]">
                                            {t("adjust")}
                                        </span>
                                        <span className="border-status-danger-border text-status-danger-ink inline-flex h-10 items-center rounded-full border px-[18px] text-[13.5px]">
                                            {t("discard")}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
