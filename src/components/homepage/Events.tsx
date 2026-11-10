"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RollingNumber } from "~/components/ui/RollingNumber";
import { SectionHead } from "~/components/homepage/landingParts";
import { useInView } from "~/components/homepage/landingMotion";
import { CountUp } from "~/components/homepage/CountUp";
import { RegionTargeting } from "~/components/homepage/RegionTargeting";

const GUESTS = ["k-avatar-1", "k-avatar-2", "k-avatar-3"] as const;
const GOING = 24;
const RSVP = ["going", "maybe", "no"] as const;
type Rsvp = (typeof RSVP)[number];
const RSVP_KEY = { going: "rsvpGoing", maybe: "rsvpMaybe", no: "rsvpNo" } as const;

/**
 * A sample public event page beside the publishing copy. The RSVP control is
 * live — choosing "Going" rolls the count like the app's own figures and adds
 * a guest to the stack. The reminder and the region card (Iris drafting the
 * audience, `RegionTargeting`) sit on their own parallax depth
 * (`data-parallax`), and the cover's arc draws in as a countdown to the
 * evening. Below `lg` the copy leads.
 */
export function Events() {
    const t = useTranslations("home");
    const tl = useTranslations("landing.events");
    const cardRef = useRef<HTMLElement>(null);
    const seen = useInView(cardRef);
    const [rsvp, setRsvp] = useState<Rsvp | null>(null);
    const going = GOING + (rsvp === "going" ? 1 : 0);

    return (
        <section
            id="events"
            aria-labelledby="events-h"
            className="mx-auto grid w-full max-w-[1440px] scroll-mt-10 grid-cols-1 items-start gap-y-14 px-6 pt-32 lg:grid-cols-12 lg:gap-x-6 lg:px-20 lg:pt-[200px]"
        >
            <div className="lg:col-span-5">
                <SectionHead
                    id="events-h"
                    eyebrow={t("eventsEyebrow")}
                    lead={t("eventsHeading")}
                    accent={t("eventsHeadingAccent")}
                    body={t("eventsBody")}
                >
                    <p data-reveal className="text-fg-secondary m-0 text-[15px] leading-[1.7]">
                        {t("eventsNote")}
                    </p>
                </SectionHead>
                <div data-parallax="12" className="mt-10 max-w-[420px]">
                    <div data-reveal>
                        <RegionTargeting />
                    </div>
                </div>
            </div>

            <div className="relative lg:col-span-6 lg:col-start-7 lg:mt-28">
                <div data-parallax="-40" className="relative z-[3] mb-3.5 sm:absolute sm:-top-7 sm:-right-2 sm:mb-0">
                    <div
                        data-reveal
                        role="status"
                        className="border-fg-primary/10 bg-bg-surface text-fg-secondary flex max-w-[320px] items-center gap-3 rounded-lg border px-4 py-3 text-[13px] leading-[1.45] shadow-[0_24px_50px_-24px_rgb(0_0_0/0.9)]"
                    >
                        <svg
                            className="text-accent-primary flex-none"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                        </svg>
                        <span>
                            <b className="text-fg-primary block font-medium">{tl("reminderTitle")}</b>
                            {tl("reminderBody")}
                        </span>
                    </div>
                </div>

                <article ref={cardRef} data-reveal className={`k-sheet k-play flex flex-col ${seen ? "is-in" : ""}`}>
                    <div className="border-fg-primary/6 bg-bg-surface relative h-[240px] overflow-hidden border-b">
                        <svg
                            className="absolute top-1/2 -right-[60px] h-[420px] w-[420px] -translate-y-1/2"
                            viewBox="-210 -210 420 420"
                            aria-hidden="true"
                        >
                            {[200, 160, 120, 80].map((r) => (
                                <circle key={r} r={r} fill="none" className="stroke-fg-primary/8" />
                            ))}
                            <circle className="k-arc" r="160" pathLength={1} transform="rotate(-90)" />
                        </svg>
                        <div className="absolute bottom-5 left-[22px] flex flex-col gap-1.5">
                            <span className="text-fg-tertiary font-mono text-[10px] tracking-[0.18em] uppercase">
                                {tl("startsIn")}
                            </span>
                            <span className="font-display text-fg-primary text-[44px] leading-none tracking-[-0.02em]">
                                <CountUp to={7} duration={1200} /> {tl("days")}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3.5 px-[22px] py-[30px] sm:px-9">
                        <span className="text-accent-primary font-mono text-[10px] tracking-[0.2em] uppercase">
                            {t("eventLabel")}
                        </span>
                        <h3 className="font-display text-fg-primary m-0 text-[clamp(30px,3vw,40px)] leading-[1.05] font-normal tracking-[-0.02em]">
                            {t("eventTitle")}
                        </h3>
                        <span className="text-fg-tertiary text-[15px]">{t("eventMeta")}</span>
                        <div className="border-fg-primary/7 mt-2.5 flex flex-wrap items-center justify-between gap-4 border-t pt-[22px]">
                            <span className="flex items-center gap-3">
                                <span className="flex" aria-hidden="true">
                                    {[...GUESTS, ...(rsvp === "going" ? (["k-avatar-4"] as const) : [])].map(
                                        (avatar, i) => (
                                            <span
                                                key={`${avatar}-${i}`}
                                                className={`${avatar} border-bg-elevated h-[30px] w-[30px] rounded-full border-2 ${i > 0 ? "-ml-[9px]" : ""} ${
                                                    i === GUESTS.length ? "k-guest-new" : ""
                                                }`}
                                            />
                                        ),
                                    )}
                                </span>
                                <span className="text-fg-tertiary text-sm">
                                    <span className="tabular-nums">
                                        <RollingNumber value={String(going)} />
                                    </span>{" "}
                                    {tl("going")} · {tl("comments")}
                                </span>
                            </span>
                            <div
                                role="group"
                                aria-label={tl("rsvpLabel")}
                                className="border-fg-primary/12 inline-flex rounded-full border p-[3px]"
                            >
                                {RSVP.map((option) => (
                                    <button
                                        key={option}
                                        type="button"
                                        aria-pressed={rsvp === option}
                                        onClick={() => setRsvp((current) => (current === option ? null : option))}
                                        className={`h-[34px] rounded-full px-3.5 text-[13px] transition-colors duration-300 ${
                                            rsvp === option
                                                ? "bg-fg-primary text-bg-primary font-semibold"
                                                : "text-fg-secondary hover:text-fg-primary"
                                        }`}
                                    >
                                        {tl(RSVP_KEY[option])}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </article>
            </div>
        </section>
    );
}
