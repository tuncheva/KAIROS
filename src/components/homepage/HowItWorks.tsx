"use client";

import { useTranslations } from "next-intl";

const STEPS = [
    { n: "01", titleKey: "howOpenTitle", bodyKey: "howOpenBody" },
    { n: "02", titleKey: "howRunTitle", bodyKey: "howRunBody" },
    { n: "03", titleKey: "howPublishTitle", bodyKey: "howPublishBody" },
] as const;

/**
 * Three columns split by hairline verticals. Below `lg` the verticals become
 * horizontals — the same rule, rotated with the stack.
 */
export function HowItWorks() {
    const t = useTranslations("home");

    return (
        <section className="mx-auto w-full max-w-[1280px] px-6 py-[110px] lg:px-12">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-primary">
                {t("howLabel")}
            </div>
            <div className="mt-11 grid grid-cols-1 border-t border-white/10 lg:grid-cols-3">
                {STEPS.map((step, i) => (
                    <div
                        key={step.n}
                        data-reveal
                        className={[
                            "border-b border-white/10 py-9 lg:border-b-0",
                            i < STEPS.length - 1 ? "lg:border-r lg:border-white/10" : "",
                            i === 0 ? "lg:pr-8" : i === STEPS.length - 1 ? "lg:pl-8" : "lg:px-8",
                        ].join(" ")}
                    >
                        <div className="font-display text-[60px] leading-none text-accent-primary/50">
                            {step.n}
                        </div>
                        <h3 className="mt-5 mb-2.5 text-[21px] font-bold text-fg-primary">
                            {t(step.titleKey)}
                        </h3>
                        <p className="text-base leading-[1.7] text-[rgb(170,170,182)]">
                            {t(step.bodyKey)}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}
