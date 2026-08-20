"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";

const ROWS = [
    { n: "01", titleKey: "whyOneWorkflowTitle", bodyKey: "whyOneWorkflowBody" },
    { n: "02", titleKey: "whyPagesTitle", bodyKey: "whyPagesBody" },
    { n: "03", titleKey: "whySecureTitle", bodyKey: "whySecureBody" },
    { n: "04", titleKey: "whyTimingTitle", bodyKey: "whyTimingBody" },
] as const;

/** On hover the whole row shifts right and the arrow arrives — that pairing is the effect. */
export function WhyTeams() {
    const t = useTranslations("home");

    return (
        <section id="why" className="mx-auto w-full max-w-[1280px] scroll-mt-24 px-6 pt-5 pb-[110px] lg:px-12">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-primary">
                {t("whyLabel")}
            </div>
            <div className="mt-9 border-t border-white/10">
                {ROWS.map((row) => (
                    <div
                        key={row.n}
                        data-reveal
                        className="k-row grid grid-cols-[40px_1fr] items-baseline gap-x-6 gap-y-2 border-b border-white/10 py-[30px] md:grid-cols-[60px_1fr_1.1fr_40px]"
                    >
                        <span className="font-mono text-xs text-[rgb(110,110,124)]">{row.n}</span>
                        <h3 className="font-display text-[clamp(1.75rem,3vw,2.375rem)] leading-[1.1] font-normal text-fg-primary">
                            {t(row.titleKey)}
                        </h3>
                        <p className="col-span-2 text-base leading-[1.7] text-[rgb(170,170,182)] md:col-span-1">
                            {t(row.bodyKey)}
                        </p>
                        <span className="k-arrow hidden justify-self-end text-accent-primary md:block">
                            <ArrowRight size={22} strokeWidth={1.6} />
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}
