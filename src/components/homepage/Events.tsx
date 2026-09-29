"use client";

import { useTranslations } from "next-intl";
import { Eyebrow, SectionHeading } from "~/components/homepage/landingParts";

const GUESTS = ["k-avatar-1", "k-avatar-2", "k-avatar-3"] as const;

/** A sample public event page beside the publishing copy. Below `lg` the copy leads. */
export function Events() {
    const t = useTranslations("home");

    return (
        <section
            id="events"
            className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-y-12 px-6 pt-32 lg:grid-cols-12 lg:gap-x-6 lg:px-20 lg:pt-[200px]"
        >
            <article data-reveal className="k-sheet flex flex-col lg:col-span-6">
                <div className="flex h-[220px] items-end border-b border-fg-primary/6 bg-bg-surface p-5">
                    <span className="k-ink-faint text-xs">{t("eventCoverPlaceholder")}</span>
                </div>
                <div className="flex flex-col gap-4 px-6 pt-8 pb-[30px] sm:px-9">
                    <span className="font-mono text-[10px] tracking-[0.2em] text-accent-primary uppercase">
                        {t("eventLabel")}
                    </span>
                    <h3 className="m-0 font-display text-[40px] leading-[1.05] font-normal text-fg-primary">
                        {t("eventTitle")}
                    </h3>
                    <span className="text-[15px] text-fg-tertiary">{t("eventMeta")}</span>
                    <div className="mt-2.5 flex items-center justify-between gap-4 border-t border-fg-primary/7 pt-[22px]">
                        <span className="flex items-center gap-3">
                            <span className="flex" aria-hidden="true">
                                {GUESTS.map((avatar, i) => (
                                    <span
                                        key={avatar}
                                        className={`${avatar} h-[30px] w-[30px] rounded-full border-2 border-bg-elevated ${i > 0 ? "-ml-[9px]" : ""}`}
                                    />
                                ))}
                            </span>
                            <span className="text-sm text-fg-tertiary">{t("eventStats")}</span>
                        </span>
                        {/* Part of the illustration, not a control. */}
                        <span
                            className="inline-flex h-[42px] shrink-0 items-center rounded-full bg-fg-primary px-[22px] text-sm font-semibold text-bg-primary"
                            aria-hidden="true"
                        >
                            {t("eventRsvp")}
                        </span>
                    </div>
                </div>
            </article>

            <div data-reveal className="order-first flex flex-col gap-7 lg:order-none lg:col-span-5 lg:col-start-8">
                <Eyebrow>{t("eventsEyebrow")}</Eyebrow>
                <SectionHeading lead={t("eventsHeading")} accent={t("eventsHeadingAccent")} />
                <p className="m-0 text-[17px] leading-[1.75] font-light text-fg-tertiary">{t("eventsBody")}</p>
                <p className="m-0 text-[15px] leading-[1.7] text-fg-secondary">{t("eventsNote")}</p>
            </div>
        </section>
    );
}
