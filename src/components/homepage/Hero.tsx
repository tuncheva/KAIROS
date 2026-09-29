"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "~/components/ui/icons";
import { HeroAgentPanel } from "~/components/homepage/HeroAgentPanel";

/**
 * Editorial split: headline and CTAs on the left, a replay of the assistant
 * drafting a plan on the right.
 *
 * All entrance motion is CSS keyed off `.k-on` on the page root (see the
 * landing block in `globals.css`), which `HomeClient` adds when the intro
 * curtain clears — so every `animation-delay` below counts from the moment the
 * page is actually visible, not from first paint under the curtain.
 *
 * Each headline line lives in its own `overflow:hidden` mask and must stay a
 * single visual line — the reveal slides the whole mask as one block, so a
 * wrapped translation would show two lines sliding together. If a locale
 * overflows, drop the size for that locale rather than letting the mask wrap.
 */
export function Hero({ onSignIn }: { onSignIn: () => void }) {
    const t = useTranslations("home");

    return (
        <section className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-y-16 px-6 pt-16 sm:pt-24 lg:grid-cols-12 lg:gap-x-6 lg:px-20 lg:pt-28">
            <div className="flex flex-col lg:col-span-7">
                <span className="k-in-fade flex items-center gap-3 font-mono text-[11px] tracking-[0.24em] text-fg-quaternary uppercase [animation-delay:0.3s]">
                    <span className="k-breathe h-1.5 w-1.5 rounded-full bg-accent-primary" aria-hidden="true" />
                    {t("heroEyebrow")}
                </span>

                <h1 className="mt-8 font-display text-[clamp(3.25rem,7.2vw,6.5rem)] leading-[0.98] font-normal tracking-[-0.025em] text-fg-primary">
                    <span data-hero-line className="k-mask">
                        <span className="k-in-line [animation-delay:0.45s]">{t("heroLine1")}</span>
                    </span>
                    <span data-hero-line className="k-mask">
                        <span className="k-in-line [animation-delay:0.58s]">
                            {t("heroLine2")}{" "}
                            <span className="text-accent-primary italic">{t("heroLine2Accent")}</span>
                        </span>
                    </span>
                    <span data-hero-line className="k-mask">
                        <span className="k-in-line text-accent-primary italic [animation-delay:0.71s]">
                            {t("heroLine3")}
                        </span>
                    </span>
                </h1>

                <p className="k-in-up mt-9 max-w-[520px] text-lg leading-[1.7] font-light text-fg-tertiary [animation-delay:1.05s]">
                    {t("heroSubline")}
                </p>

                <div className="k-in-up mt-11 flex flex-col items-start gap-6 [animation-delay:1.2s] sm:flex-row sm:items-center sm:gap-7">
                    <button
                        type="button"
                        onClick={onSignIn}
                        className="k-lift flex h-[54px] items-center gap-2.5 rounded-full bg-accent-primary px-[30px] text-[15px] font-semibold text-bg-primary"
                    >
                        {t("heroPrimaryCta")}
                        <ArrowRight size={16} strokeWidth={2} />
                    </button>
                    <a
                        href="#join"
                        className="border-b border-fg-primary/30 pb-[3px] text-[15px] text-fg-primary transition-colors hover:border-accent-primary hover:text-accent-primary"
                    >
                        {t("heroAccessCode")}
                    </a>
                </div>
            </div>

            <HeroAgentPanel />
        </section>
    );
}
