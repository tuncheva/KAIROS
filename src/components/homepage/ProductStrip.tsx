"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const FRAMES = ["stripTimeline", "stripBoard", "stripEventPage", "stripRsvp"] as const;

/**
 * Horizontal strip scrubbed to the section's progress through the viewport.
 * The frames are stand-ins until real product screenshots exist.
 *
 * Below `md` the transform is dropped and the track becomes a swipeable
 * overflow row, so the strip still works on touch.
 */
export function ProductStrip() {
    const t = useTranslations("home");
    const sectionRef = useRef<HTMLElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const section = sectionRef.current;
        const track = trackRef.current;
        if (!section || !track) return;

        const mm = gsap.matchMedia();

        mm.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
            const tween = gsap.to(track, {
                x: () => -Math.max(0, track.scrollWidth - window.innerWidth + 88),
                ease: "none",
                scrollTrigger: {
                    trigger: section,
                    start: "top bottom",
                    end: "bottom top",
                    scrub: true,
                    invalidateOnRefresh: true,
                },
            });
            // Alternate frames drift against the horizontal travel, so the row
            // reads as depth rather than one rigid strip.
            const figures = gsap.utils.toArray<HTMLElement>(track.children);
            const drift = gsap.to(figures, {
                y: (i: number) => (i % 2 === 0 ? 22 : -22),
                ease: "none",
                scrollTrigger: {
                    trigger: section,
                    start: "top bottom",
                    end: "bottom top",
                    scrub: true,
                    invalidateOnRefresh: true,
                },
            });

            return () => {
                tween.scrollTrigger?.kill();
                tween.kill();
                drift.scrollTrigger?.kill();
                drift.kill();
                gsap.set(track, { x: 0 });
                gsap.set(figures, { y: 0 });
            };
        });

        return () => mm.revert();
    }, []);

    return (
        <section
            id="product"
            ref={sectionRef}
            className="relative scroll-mt-24 pt-[100px] pb-10"
        >
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10 lg:px-12">
                <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-primary">
                        {t("stripLabel")}
                    </div>
                    <h2
                        data-reveal
                        className="mt-[18px] font-display text-[clamp(2.25rem,4.4vw,3.5rem)] leading-[1.05] font-normal text-fg-primary"
                    >
                        {t("stripHeading")}
                    </h2>
                </div>
                <div className="font-mono text-[11px] tracking-[0.16em] whitespace-nowrap text-[rgb(110,110,124)]">
                    {t("stripScrollHint")}
                </div>
            </div>

            <div className="mt-12 overflow-x-auto overflow-y-hidden md:overflow-hidden">
                <div
                    ref={trackRef}
                    className="flex w-max gap-7 px-6 will-change-transform lg:px-12"
                >
                    {FRAMES.map((key) => (
                        <figure
                            key={key}
                            className="k-ph m-0 flex h-[260px] w-[min(86vw,620px)] flex-col justify-end rounded-[18px] border border-white/[0.09] bg-[#0c0c12] p-[26px] sm:h-[380px]"
                        >
                            <figcaption className="font-mono text-[11px] uppercase tracking-[0.16em] text-[rgb(140,140,152)]">
                                {t(key)}
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </div>

            <p className="mx-auto mt-[22px] w-full max-w-[1280px] px-6 font-mono text-[11px] text-[rgb(95,95,108)] lg:px-12">
                {t("stripPlaceholderNote")}
            </p>
        </section>
    );
}
