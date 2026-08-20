"use client";

import { useTranslations } from "next-intl";
import ScrollReveal from "~/components/homepage/ScrollReveal";

/**
 * PLACEHOLDER. The quote is written copy, not a real customer, and the
 * attribution says so on the page so nothing here reads as a genuine
 * endorsement. Swap in a real quote, name, role and photo before this counts
 * as social proof — or drop the section.
 *
 * The quote reads in word by word as it is scrolled past, which is the only
 * place on the page that animation is scrubbed rather than fired once.
 */
export function Testimonial() {
    const t = useTranslations("home");

    return (
        <section className="mx-auto w-full max-w-[1280px] px-6 pb-[120px] lg:px-12">
            <blockquote className="max-w-[900px]">
                <ScrollReveal
                    as="p"
                    variant="inherit"
                    baseOpacity={0.12}
                    wordAnimationEnd="center 65%"
                    containerClassName="font-display text-[clamp(1.75rem,4vw,3rem)] leading-[1.3] font-normal tracking-[-0.01em] text-fg-primary"
                >
                    {`\u201C${t("quoteBody")}\u201D`}
                </ScrollReveal>
                <footer data-reveal className="mt-7 flex items-center gap-3.5">
                    <div className="k-ph h-11 w-11 rounded-full border border-white/[0.16] bg-[#12121a]" />
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[rgb(165,165,178)]">
                        {t("quoteAttribution")}
                    </div>
                </footer>
            </blockquote>
        </section>
    );
}
