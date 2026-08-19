"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { gsap } from "gsap";
import { prefersReducedMotion } from "~/components/homepage/useLandingReveals";

/**
 * Each headline line lives in its own `overflow:hidden` mask and must stay a
 * single visual line — the reveal slides the whole mask as one block, so a
 * wrapped translation would show two lines sliding together. If a locale
 * overflows, drop the size for that locale rather than letting the mask wrap.
 */
export function Hero({ onSignIn, ready }: { onSignIn: () => void; ready: boolean }) {
    const t = useTranslations("home");
    const rootRef = useRef<HTMLElement>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root || !ready) return;

        const lines = root.querySelectorAll<HTMLElement>("[data-hero-line] > span");
        const ups = root.querySelectorAll<HTMLElement>("[data-hero-up]");

        if (prefersReducedMotion()) {
            gsap.set(lines, { y: 0 });
            gsap.set(ups, { opacity: 1, y: 0, filter: "none" });
            return;
        }

        const ctx = gsap.context(() => {
            gsap.to(lines, { y: "0%", duration: 1.15, ease: "power3.out" });
            gsap.to(ups, {
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
                duration: 1.1,
                ease: "power3.out",
                stagger: 0.12,
                delay: 0.15,
            });
        }, root);

        return () => ctx.revert();
    }, [ready]);

    return (
        <section
            ref={rootRef}
            className="relative mx-auto flex w-full max-w-[1280px] flex-col justify-center px-6 pt-[120px] pb-[90px] lg:min-h-[720px] lg:px-12"
        >
            <div
                data-hero-up
                className="inline-flex translate-y-11 self-start items-center gap-2.5 rounded-full border border-accent-primary/30 bg-accent-primary/[0.09] px-4 py-[7px] font-mono text-[11px] uppercase tracking-[0.2em] text-accent-secondary opacity-0 blur-[8px]"
            >
                <span className="h-[5px] w-[5px] rounded-full bg-accent-primary" />
                {t("heroTagline")}
            </div>

            <h1 className="mt-[34px] max-w-[1174px] font-display text-[clamp(3rem,9.4vw,8rem)] leading-[0.92] font-normal tracking-[-0.02em] text-fg-primary">
                <span data-hero-line className="block overflow-hidden">
                    <span className="block translate-y-[110%]">{t("heroLine1")}</span>
                </span>
                <span data-hero-line className="block overflow-hidden">
                    <span className="block translate-y-[110%]">{t("heroLine2")}</span>
                </span>
                <span data-hero-line className="block overflow-hidden">
                    <span className="block translate-y-[110%] italic text-accent-primary">{t("heroLine3")}</span>
                </span>
            </h1>

            <p
                data-hero-up
                className="mt-9 max-w-[520px] translate-y-11 text-[19px] leading-[1.65] text-[rgb(178,178,190)] opacity-0 blur-[8px]"
            >
                {t("heroSubline")}
            </p>

            <div
                data-hero-up
                className="mt-10 flex translate-y-11 flex-col items-stretch gap-4 opacity-0 blur-[8px] sm:flex-row sm:items-center"
            >
                <button
                    type="button"
                    onClick={onSignIn}
                    className="k-btn inline-flex items-center justify-center gap-2.5 rounded-full bg-accent-primary px-8 py-[17px] text-base font-bold text-white"
                >
                    {t("heroPrimaryCta")}
                    <ArrowRight size={18} />
                </button>
                <a
                    href="#product"
                    className="k-ghost inline-flex items-center justify-center rounded-full border border-white/[0.16] px-[30px] py-[17px] text-base font-semibold text-[rgb(210,210,220)]"
                >
                    {t("heroSecondaryCta")}
                </a>
            </div>
        </section>
    );
}
