"use client";

import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";

const STEPS = [
    { n: "01", titleKey: "howOpenTitle", bodyKey: "howOpenBody" },
    { n: "02", titleKey: "howRunTitle", bodyKey: "howRunBody" },
    { n: "03", titleKey: "howPublishTitle", bodyKey: "howPublishBody" },
] as const;

/**
 * Three solid blocks separated by a hairline gap rather than borders, each
 * carrying the same accent wipe as the workspace cards above.
 */
export function HowItWorks() {
    const t = useTranslations("home");

    return (
        <section className="mx-auto w-full max-w-[1280px] px-6 py-[110px] lg:px-12">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-primary">
                {t("howLabel")}
            </div>
            <div className="mt-11 grid grid-cols-1 gap-px lg:grid-cols-3">
                {STEPS.map((step) => (
                    <div
                        key={step.n}
                        className="k-block flex min-h-[300px] flex-col justify-between bg-[#0c0c12] px-8 pt-9 pb-9"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="k-step-num font-display text-[72px] leading-none text-white/30">
                                {step.n}
                            </div>
                            <span className="k-card-arrow shrink-0" aria-hidden="true">
                                <ArrowUpRight size={22} strokeWidth={1.5} />
                            </span>
                        </div>
                        <div>
                            <h3 className="mb-2.5 text-[21px] font-bold text-fg-primary">
                                {t(step.titleKey)}
                            </h3>
                            <p className="k-step-body text-base leading-[1.7] text-[rgb(178,178,190)]">
                                {t(step.bodyKey)}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
