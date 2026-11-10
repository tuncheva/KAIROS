"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight } from "~/components/ui/icons";
import { SectionHeading } from "~/components/homepage/landingParts";
import { prefersReducedMotion } from "~/components/homepage/useLandingReveals";

gsap.registerPlugin(ScrollTrigger);

/**
 * Closing statement with both ways in: a new workspace, or a code someone
 * shared. `#join` is the target of the hero's "I have an access code" link.
 *
 * Above it, a band of ticks slides past a fixed accent "now" as the section
 * scrolls through — the page's timing motif, scrubbed by ScrollTrigger.
 */
export function FinalCta({ onSignIn, onJoin }: { onSignIn: () => void; onJoin: (code: string) => void }) {
    const t = useTranslations("home");
    const tl = useTranslations("landing");
    const [code, setCode] = useState("");
    const rulerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const ruler = rulerRef.current;
        if (!ruler || prefersReducedMotion()) return;
        const tween = gsap.fromTo(
            ruler,
            { xPercent: -30 },
            {
                xPercent: -36,
                ease: "none",
                scrollTrigger: {
                    trigger: ruler.parentElement ?? ruler,
                    start: "top bottom",
                    end: "bottom top",
                    scrub: true,
                },
            },
        );
        return () => {
            tween?.scrollTrigger?.kill();
            tween?.kill?.();
        };
    }, []);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (code.trim()) onJoin(code);
    };

    return (
        <section className="overflow-clip pt-36 pb-28 lg:pt-[220px] lg:pb-[180px]">
            <div
                data-reveal
                className="k-ruler border-fg-primary/10 relative h-[46px] overflow-hidden border-t"
                aria-hidden="true"
            >
                <div ref={rulerRef} className="k-ruler-track absolute top-0 left-0 h-full w-[300%]" />
                <div className="bg-accent-primary absolute top-0 left-1/2 h-[30px] w-px">
                    <span className="text-accent-primary absolute top-8 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.18em] uppercase">
                        {tl("now")}
                    </span>
                </div>
            </div>
            <div className="mx-auto mt-14 grid w-full max-w-[1440px] grid-cols-1 items-end gap-y-12 px-6 lg:grid-cols-12 lg:gap-x-6 lg:px-20">
                <SectionHeading
                    lead={t("finalHeading")}
                    accent={t("finalHeadingAccent")}
                    className="text-[clamp(3rem,6.4vw,5.75rem)]! leading-none! tracking-[-0.03em]! lg:col-span-7"
                />

                <div data-reveal className="flex flex-col gap-[18px] lg:col-span-4 lg:col-start-9">
                    <p className="text-fg-tertiary m-0 text-[17px] leading-[1.7] font-light">{t("finalSubline")}</p>
                    <button
                        type="button"
                        onClick={onSignIn}
                        data-magnetic
                        className="k-lift bg-accent-primary text-bg-primary flex h-[54px] items-center justify-between rounded-full px-7 text-[15px] font-semibold"
                    >
                        {t("heroPrimaryCta")}
                        <ArrowRight size={16} strokeWidth={2} />
                    </button>
                    <form
                        id="join"
                        onSubmit={submit}
                        className="border-fg-primary/14 focus-within:border-accent-primary/60 flex h-[54px] scroll-mt-32 items-center overflow-hidden rounded-full border transition-colors"
                    >
                        <label htmlFor="cta-code" className="sr-only">
                            {t("accessCode")}
                        </label>
                        <input
                            id="cta-code"
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder={t("accessCode")}
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            className="text-fg-primary placeholder:text-fg-tertiary h-full min-w-0 flex-grow bg-transparent px-6 font-mono text-[13px] tracking-[0.1em] outline-none"
                        />
                        <button
                            type="submit"
                            disabled={code.trim().length === 0}
                            className="border-fg-primary/12 text-fg-primary hover:text-accent-primary h-full border-l px-6 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {t("finalJoin")}
                        </button>
                    </form>
                </div>
            </div>
        </section>
    );
}
