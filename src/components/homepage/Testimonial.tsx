"use client";

import { useTranslations } from "next-intl";

/**
 * PLACEHOLDER. The quote is written copy, not a real customer, and the
 * attribution says so on the page so nothing here reads as a genuine
 * endorsement. Swap in a real quote, name, role and photo before this counts
 * as social proof — or drop the section.
 */
export function Testimonial() {
    const t = useTranslations("home");

    return (
        <section className="mx-auto w-full max-w-[1280px] px-6 pb-[120px] lg:px-12">
            <blockquote data-reveal className="max-w-[900px]">
                <p className="font-display text-[clamp(1.75rem,4vw,3.25rem)] leading-[1.25] font-normal tracking-[-0.01em] text-fg-primary">
                    <span className="text-accent-primary">&ldquo;</span>
                    {t("quoteBody")}
                    <span className="text-accent-primary">&rdquo;</span>
                </p>
                <footer className="mt-7 flex items-center gap-3.5">
                    <div className="k-ph h-11 w-11 rounded-full border border-white/[0.12] bg-[#12121a]" />
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[rgb(140,140,152)]">
                        {t("quoteAttribution")}
                    </div>
                </footer>
            </blockquote>
        </section>
    );
}
