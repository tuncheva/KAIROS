"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "~/components/ui/icons";

/** The one place the accent is used as light rather than ink. */
export function FinalCta({ onSignIn }: { onSignIn: () => void }) {
    const t = useTranslations("home");

    return (
        <section
            className="relative border-t border-white/[0.08] px-6 py-[110px] lg:px-12"
            style={{
                background:
                    "radial-gradient(ellipse 70% 100% at 50% 100%, rgb(var(--accent-primary) / 0.16), transparent 70%)",
            }}
        >
            <div className="mx-auto max-w-[820px] text-center">
                <h2
                    data-reveal
                    className="font-display text-[clamp(2.5rem,6vw,4.625rem)] leading-[1.05] font-normal text-fg-primary"
                >
                    {t("finalHeading")}{" "}
                    <em className="italic text-accent-primary">{t("finalHeadingAccent")}</em>
                </h2>
                <p
                    data-reveal
                    className="mx-auto mt-6 max-w-[520px] text-lg leading-[1.7] text-[rgb(178,178,190)]"
                >
                    {t("finalSubline")}
                </p>
                <div data-reveal className="mt-9 flex justify-center gap-3.5">
                    <button
                        type="button"
                        onClick={onSignIn}
                        className="k-btn inline-flex items-center gap-2.5 rounded-full bg-accent-primary px-9 py-[18px] text-base font-bold text-white"
                    >
                        {t("getStarted")}
                        <ArrowRight size={18} />
                    </button>
                </div>
            </div>
        </section>
    );
}
