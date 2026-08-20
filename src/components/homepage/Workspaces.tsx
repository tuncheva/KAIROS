"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { prefersReducedMotion } from "~/components/homepage/useLandingReveals";

const CARDS = [
    { n: "01", tag: "ORG", titleKey: "wsOrgTitle", bodyKey: "wsOrgBody" },
    { n: "02", tag: "TEAM", titleKey: "wsTeamTitle", bodyKey: "wsTeamBody" },
    { n: "03", tag: "PERSONAL", titleKey: "wsPersonalTitle", bodyKey: "wsPersonalBody" },
] as const;

/**
 * Three cards in one hairline-gapped row. As the row travels through the
 * viewport a single card is lit at a time — the highlight walks left to right,
 * so scrolling reads the three workspace types in order without pinning the
 * page. Hovering a card overrides nothing; the `k-block` wipe layers on top.
 *
 * Below `lg` the cards stack and the spotlight still walks down the stack.
 */
export function Workspaces() {
    const t = useTranslations("home");
    const groupRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(-1);

    useEffect(() => {
        const group = groupRef.current;
        if (!group) return;

        // Without motion the walk never runs, so light the first card and stop.
        if (prefersReducedMotion()) {
            setActive(0);
            return;
        }

        let frame = 0;

        const tick = () => {
            frame = 0;
            const vh = window.innerHeight;
            const rect = group.getBoundingClientRect();
            const inView = rect.top < vh * 0.9 && rect.bottom > vh * 0.1;
            const progress = Math.min(
                1,
                Math.max(0, (vh * 0.85 - rect.top) / (rect.height + vh * 0.75)),
            );

            setActive(
                inView && progress > 0 && progress < 1
                    ? Math.min(CARDS.length - 1, Math.floor(progress * CARDS.length))
                    : -1,
            );
        };

        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(tick);
        };

        tick();
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);

        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
        };
    }, []);

    return (
        <section
            id="workspaces"
            className="relative mx-auto w-full max-w-[1280px] scroll-mt-24 px-6 pt-[100px] pb-10 lg:px-12"
        >
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
                <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-primary">
                        {t("wsLabel")}
                    </div>
                    <h2
                        data-reveal
                        className="mt-[18px] max-w-[680px] font-display text-[clamp(2.25rem,4.8vw,3.75rem)] leading-[1.04] font-normal tracking-[-0.01em] text-fg-primary"
                    >
                        {t("wsHeading")}
                    </h2>
                </div>
                <div className="lg:max-w-[360px]">
                    <div data-reveal-rule className="mb-6 h-px bg-white/[0.12] lg:hidden" />
                    <p data-reveal className="text-base leading-[1.7] text-[rgb(160,160,172)]">
                        {t("wsBody")}
                    </p>
                </div>
            </div>

            <div ref={groupRef} className="mt-14 grid grid-cols-1 gap-px lg:grid-cols-3">
                {CARDS.map((card, i) => (
                    <article
                        key={card.tag}
                        data-on={String(i === active)}
                        className="k-lit k-block flex min-h-[360px] flex-col justify-between px-8 pt-10 pb-9 lg:min-h-[440px]"
                    >
                        <span className="k-block-arrow" aria-hidden="true">
                            <ArrowUpRight size={22} strokeWidth={1.5} />
                        </span>
                        <div className="flex items-start justify-between">
                            <span className="k-lit-num font-display text-[52px] leading-none">
                                {card.n}
                            </span>
                            <span className="k-lit-tag font-mono text-[11px] tracking-[0.18em]">
                                {card.tag}
                            </span>
                        </div>
                        <div>
                            <h3 className="font-display text-[clamp(2rem,3.2vw,2.5rem)] leading-[1.08] font-normal text-fg-primary">
                                {t(card.titleKey)}
                            </h3>
                            <p className="k-lit-body mt-3.5 text-base leading-[1.7]">
                                {t(card.bodyKey)}
                            </p>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}
