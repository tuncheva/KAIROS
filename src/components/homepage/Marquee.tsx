"use client";

import { useTranslations } from "next-intl";

const ITEMS = [
    "drafts",
    "locked",
    "chat",
    "rsvp",
    "regions",
    "undo",
    "brief",
    "radar",
    "calendar",
    "roles",
    "code",
    "languages",
] as const;

/**
 * The feature strip under the hero. Two copies of one list on a track that
 * slides by exactly one copy, so the loop has no seam; it pauses under the
 * pointer. Under reduced motion it is one wrapped, centred list.
 */
export function Marquee() {
    const t = useTranslations("landing");

    const list = (copy: boolean) => (
        <ul
            aria-hidden={copy || undefined}
            className={`k-marquee-list m-0 flex list-none p-0 ${copy ? "k-marquee-copy" : ""}`}
        >
            {ITEMS.map((key) => (
                <li
                    key={key}
                    className="k-marquee-item text-fg-tertiary flex items-center gap-7 pr-7 font-mono text-xs tracking-[0.16em] whitespace-nowrap uppercase"
                >
                    {t(`marquee.${key}`)}
                </li>
            ))}
        </ul>
    );

    return (
        <section
            aria-label={t("marqueeLabel")}
            className="k-marquee border-fg-primary/6 mt-[clamp(80px,10vw,140px)] overflow-hidden border-y py-[22px]"
        >
            <div className="k-marquee-track flex w-max">
                {list(false)}
                {list(true)}
            </div>
        </section>
    );
}
