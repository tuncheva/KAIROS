"use client";

import { useTranslations } from "next-intl";
import { locales } from "~/i18n/locales";

/**
 * Verifiable product facts only — no invented user or customer counts.
 *
 * The language figure counts the locales actually *offered* (`~/i18n/locales`),
 * not the message files on disk: `de`, `es` and `fr` are about half translated
 * and are not selectable, so the design's "5" would have been a claim the
 * product does not currently support.
 *
 * The 1px grid gap over a light wrapper background is what draws the dividers.
 */
const CELLS = [
    { value: String(locales.length), labelKey: "statLanguages", accent: false },
    { value: "3", labelKey: "statWorkspaceTypes", accent: false },
    { value: "3", labelKey: "statRoleLevels", accent: false },
    { value: "1", labelKey: "statOnePlace", accent: true },
] as const;

export function Stats() {
    const t = useTranslations("home");

    return (
        <section className="mx-auto w-full max-w-[1280px] px-6 pb-[110px] lg:px-12">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-white/10 bg-white/10 lg:grid-cols-4">
                {CELLS.map((cell) => (
                    <div key={cell.labelKey} data-reveal className="bg-[#0a0a10] px-[30px] py-[38px]">
                        <div
                            className={`font-display text-[clamp(3rem,5vw,4.125rem)] leading-none ${
                                cell.accent ? "text-accent-primary" : "text-fg-primary"
                            }`}
                        >
                            {cell.value}
                        </div>
                        <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[rgb(140,140,152)]">
                            {t(cell.labelKey)}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
