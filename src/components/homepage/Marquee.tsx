"use client";

import { useTranslations } from "next-intl";

const DOT = <span className="text-accent-primary">·</span>;

/**
 * The track is exactly two identical halves, so translating it -50% lands on a
 * seam that is invisible. Each half repeats the phrase twice to overrun a wide
 * viewport.
 */
export function Marquee() {
    const t = useTranslations("home");

    const half = (
        <div className="flex items-center gap-10 pr-10 font-display text-[34px] whitespace-nowrap text-[rgb(120,120,134)]">
            {[0, 1].map((i) => (
                <div key={i} className="flex items-center gap-10">
                    <span>{t("marqueePlan")}</span>
                    {DOT}
                    <span>{t("marqueeCollaborate")}</span>
                    {DOT}
                    <span>{t("marqueePublish")}</span>
                    {DOT}
                    <span className="italic text-accent-tertiary">{t("marqueeTiming")}</span>
                    {DOT}
                </div>
            ))}
        </div>
    );

    return (
        <div
            aria-hidden="true"
            className="overflow-hidden border-y border-white/[0.07] bg-accent-primary/[0.04] py-[22px]"
        >
            <div className="k-marquee-track">
                {half}
                {half}
            </div>
        </div>
    );
}
