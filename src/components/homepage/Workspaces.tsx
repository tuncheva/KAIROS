"use client";

import { useTranslations } from "next-intl";
import { ArrowUpRight } from "~/components/ui/icons";

const CARDS = [
    { n: "01", tag: "ORG", titleKey: "wsOrgTitle", bodyKey: "wsOrgBody" },
    { n: "02", tag: "TEAM", titleKey: "wsTeamTitle", bodyKey: "wsTeamBody" },
    { n: "03", tag: "PERSONAL", titleKey: "wsPersonalTitle", bodyKey: "wsPersonalBody" },
] as const;

/**
 * Three cards in one hairline-gapped row. The accent is hover-only — the wipe,
 * the arrow and the colour shift all belong to `.k-block` and reverse the
 * moment the cursor leaves, so no card is ever left highlighted.
 *
 * Below `lg` the cards stack.
 */
export function Workspaces() {
    const t = useTranslations("home");

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

            <div className="mt-14 grid grid-cols-1 gap-px lg:grid-cols-3">
                {CARDS.map((card) => (
                    <article
                        key={card.tag}
                        className="k-card k-block flex min-h-[360px] flex-col justify-between px-8 pt-10 pb-9 lg:min-h-[440px]"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <span className="k-card-num font-display text-[52px] leading-none">
                                {card.n}
                            </span>
                            {/* Tag and arrow occupy one grid cell so the hover
                                cross-fade swaps them in place. */}
                            <span className="grid shrink-0 place-items-end">
                                <span className="k-card-tag col-start-1 row-start-1 font-mono text-[11px] tracking-[0.18em]">
                                    {card.tag}
                                </span>
                                <span className="k-card-arrow col-start-1 row-start-1" aria-hidden="true">
                                    <ArrowUpRight size={22} strokeWidth={1.5} />
                                </span>
                            </span>
                        </div>
                        <div>
                            <h3 className="font-display text-[clamp(2rem,3.2vw,2.5rem)] leading-[1.08] font-normal text-fg-primary">
                                {t(card.titleKey)}
                            </h3>
                            <p className="k-card-body mt-3.5 text-base leading-[1.7]">
                                {t(card.bodyKey)}
                            </p>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}
