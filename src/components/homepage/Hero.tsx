"use client";

import { useEffect, useRef, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "~/components/ui/icons";
import { HeroAgentPanel } from "~/components/homepage/HeroAgentPanel";
import { prefersReducedMotion } from "~/components/homepage/useLandingReveals";

const TICKS = Array.from({ length: 60 }, (_, i) => {
    const a = ((i * 6 - 90) * Math.PI) / 180;
    const major = i % 5 === 0;
    const r1 = major ? 420 : 440;
    return {
        major,
        x1: +(Math.cos(a) * r1).toFixed(1),
        y1: +(Math.sin(a) * r1).toFixed(1),
        x2: +(Math.cos(a) * 460).toFixed(1),
        y2: +(Math.sin(a) * 460).toFixed(1),
    };
});

/**
 * A real seconds dial behind the assistant: one accent tick per second. The
 * angle only ever grows, so 59 → 0 steps forward instead of sweeping back.
 * Written straight to the element rather than through state — it changes
 * every second and nothing else reads it.
 */
function SecondsDial() {
    const handRef = useRef<SVGGElement>(null);

    useEffect(() => {
        const hand = handRef.current;
        if (!hand) return;
        const reduced = prefersReducedMotion();
        let deg = new Date().getSeconds() * 6;
        hand.style.transform = `rotate(${deg}deg)`;

        let interval: ReturnType<typeof setInterval> | undefined;
        const tick = () => {
            deg = reduced ? new Date().getSeconds() * 6 : deg + 6;
            hand.style.transform = `rotate(${deg}deg)`;
        };
        const align = setTimeout(
            () => {
                tick();
                interval = setInterval(tick, 1000);
            },
            1000 - (Date.now() % 1000),
        );

        return () => {
            clearTimeout(align);
            clearInterval(interval);
        };
    }, []);

    return (
        <svg
            className="k-dial pointer-events-none absolute top-1/2 left-1/2 -z-10 aspect-square w-[min(980px,170vw)] max-w-none -translate-x-1/2 -translate-y-1/2"
            viewBox="-500 -500 1000 1000"
            aria-hidden="true"
        >
            <circle className="k-dial-ring" r="470" />
            <circle className="k-dial-ring" r="330" />
            {TICKS.map((tk, i) => (
                <line
                    key={i}
                    className={`k-dial-tick ${tk.major ? "is-major" : ""}`}
                    x1={tk.x1}
                    y1={tk.y1}
                    x2={tk.x2}
                    y2={tk.y2}
                />
            ))}
            <g ref={handRef} className="k-dial-hand" style={{ transformOrigin: "0 0" }}>
                <line x1="0" y1="-404" x2="0" y2="-466" />
                <circle cx="0" cy="-484" r="5" />
            </g>
        </svg>
    );
}

const FACT_ICONS = {
    heroFactDrafts: <path d="M20 6 9 17l-5-5" />,
    heroFactLocked: (
        <>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </>
    ),
    heroFactLanguages: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </>
    ),
} as const;

/**
 * Editorial split: headline and CTAs on the left, a replay of the assistant
 * drafting a plan on the right, floating on a seconds dial.
 *
 * All entrance motion is CSS keyed off `.k-on` on the page root (see the
 * landing block in `globals.css`), which `HomeClient` adds when the intro
 * curtain clears — so every `animation-delay` below counts from the moment the
 * page is actually visible, not from first paint under the curtain. `active`
 * is the same moment, handed to the replay so it does not start underneath.
 *
 * Each headline line lives in its own `overflow:hidden` mask and must stay a
 * single visual line — the reveal slides the whole mask as one block, so a
 * wrapped translation would show two lines sliding together. If a locale
 * overflows, drop the size for that locale rather than letting the mask wrap.
 */
export function Hero({ onSignIn, active }: { onSignIn: () => void; active: boolean }) {
    const t = useTranslations("home");
    const tl = useTranslations("landing");
    const stageRef = useRef<HTMLDivElement>(null);

    /* The window leans a few degrees toward the pointer and its sheen follows.
       Mouse and pen only; nothing under reduced motion. */
    const onMove = (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === "touch" || prefersReducedMotion()) return;
        const fig = stageRef.current?.querySelector("figure");
        if (!fig) return;
        const r = fig.getBoundingClientRect();
        const x = (event.clientX - r.left) / r.width;
        const y = (event.clientY - r.top) / r.height;
        fig.style.setProperty("--k-ry", `${((x - 0.5) * 5).toFixed(2)}deg`);
        fig.style.setProperty("--k-rx", `${((0.5 - y) * 4).toFixed(2)}deg`);
        fig.style.setProperty("--k-mx", `${(x * 100).toFixed(1)}%`);
        fig.style.setProperty("--k-my", `${(y * 100).toFixed(1)}%`);
    };
    const onLeave = () => {
        const fig = stageRef.current?.querySelector("figure");
        fig?.style.setProperty("--k-rx", "0deg");
        fig?.style.setProperty("--k-ry", "0deg");
    };

    return (
        <section className="relative overflow-clip pt-[clamp(130px,16vw,190px)]">
            <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-y-16 px-6 lg:grid-cols-12 lg:gap-x-6 lg:px-20">
                <div className="relative z-[2] flex flex-col lg:col-span-7">
                    <span className="k-in-fade text-fg-tertiary flex items-center gap-3 font-mono text-[11px] tracking-[0.24em] uppercase [animation-delay:0.3s]">
                        <span className="k-breathe bg-accent-primary h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                        {t("heroEyebrow")}
                    </span>

                    <h1 className="font-display text-fg-primary mt-8 text-[clamp(3.1rem,7.2vw,6.5rem)] leading-[0.98] font-normal tracking-[-0.03em]">
                        <span data-hero-line className="k-mask">
                            <span className="k-in-line [animation-delay:0.45s]">{t("heroLine1")}</span>
                        </span>
                        <span data-hero-line className="k-mask">
                            <span className="k-in-line [animation-delay:0.58s]">
                                {t("heroLine2")}{" "}
                                <span className="text-accent-primary relative pr-[0.04em] italic">
                                    {t("heroLine2Accent")}
                                    <svg
                                        className="k-swash absolute right-[0.04em] -bottom-[0.02em] left-0 h-[0.12em] overflow-visible"
                                        viewBox="0 0 100 10"
                                        preserveAspectRatio="none"
                                        aria-hidden="true"
                                    >
                                        <path pathLength={1} d="M2 7 C 30 2, 70 2, 98 6" />
                                    </svg>
                                </span>
                            </span>
                        </span>
                        <span data-hero-line className="k-mask">
                            <span className="k-in-line text-accent-primary italic [animation-delay:0.71s]">
                                {t("heroLine3")}
                            </span>
                        </span>
                    </h1>

                    <p className="k-in-up text-fg-tertiary mt-9 max-w-[520px] text-lg leading-[1.7] font-light [animation-delay:1.05s]">
                        {t("heroSubline")}
                    </p>

                    <div className="k-in-up mt-11 flex flex-wrap items-center gap-x-7 gap-y-5 [animation-delay:1.2s]">
                        <button
                            type="button"
                            onClick={onSignIn}
                            data-magnetic
                            className="k-lift bg-accent-primary text-bg-primary flex h-[54px] items-center gap-2.5 rounded-full px-[30px] text-[15px] font-semibold"
                        >
                            {t("heroPrimaryCta")}
                            <ArrowRight size={16} strokeWidth={2} />
                        </button>
                        <a
                            href="#join"
                            className="border-fg-primary/30 text-fg-primary hover:border-accent-primary hover:text-accent-primary border-b pb-[3px] text-[15px] transition-colors"
                        >
                            {t("heroAccessCode")}
                        </a>
                    </div>

                    <ul className="k-in-up border-fg-primary/8 m-0 mt-14 flex max-w-[560px] list-none flex-wrap gap-x-7 gap-y-3 border-t p-0 pt-[22px] [animation-delay:1.4s]">
                        {(Object.keys(FACT_ICONS) as (keyof typeof FACT_ICONS)[]).map((key) => (
                            <li key={key} className="text-fg-tertiary flex items-center gap-2.5 text-[13px]">
                                <svg
                                    className="text-accent-primary"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                >
                                    {FACT_ICONS[key]}
                                </svg>
                                {tl(key)}
                            </li>
                        ))}
                    </ul>

                    <div
                        className="k-in-fade text-fg-tertiary mt-20 hidden items-center gap-3.5 font-mono text-[10px] tracking-[0.24em] uppercase [animation-delay:1.8s] lg:flex"
                        aria-hidden="true"
                    >
                        <i className="k-cue bg-fg-primary/15 after:bg-accent-primary relative block h-10 w-px overflow-hidden after:absolute after:inset-0 after:content-['']" />
                        {tl("scroll")}
                    </div>
                </div>

                <div
                    ref={stageRef}
                    onPointerMove={onMove}
                    onPointerLeave={onLeave}
                    className="k-in-panel relative z-[1] [animation-delay:1s] [perspective:1600px] lg:col-span-5 lg:col-start-8"
                >
                    <SecondsDial />
                    <HeroAgentPanel active={active} />
                </div>
            </div>
        </section>
    );
}
