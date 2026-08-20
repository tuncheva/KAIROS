"use client";

import { useTranslations } from "next-intl";

/**
 * Statement marquee — one phrase, set in the display face, drifting on a
 * continuous 30s loop rather than anything scroll-linked.
 *
 * The track is exactly two identical halves, so translating it -50% lands on a
 * seam that is invisible. Each half repeats the phrase three times to overrun a
 * wide viewport; only the first repeat carries the accent, so the colour reads
 * as a beat in the loop rather than a pattern.
 *
 * Under reduced motion the track holds still (see `.k-marquee-track` in
 * `globals.css`) — the phrase is still legible, it just does not travel.
 */
export function Marquee() {
    const t = useTranslations("home");

    const half = (
        <span className="flex items-center gap-16 pr-16 font-display text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[1.05] whitespace-nowrap text-[rgb(196,196,208)]">
            {[0, 1, 2].map((i) => (
                <span key={i}>
                    {t("marqueeLead")}{" "}
                    <em className={`italic ${i === 0 ? "text-accent-primary" : ""}`}>
                        {t("marqueeAccent")}
                    </em>
                </span>
            ))}
        </span>
    );

    return (
        <section
            aria-hidden="true"
            className="overflow-hidden border-y border-white/[0.08] pt-11 pb-[46px]"
        >
            <div className="k-marquee-track">
                {half}
                {half}
            </div>
        </section>
    );
}
