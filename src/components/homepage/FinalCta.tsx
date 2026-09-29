"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "~/components/ui/icons";

/**
 * Closing statement with both ways in: a new workspace, or a code someone
 * shared. `#join` is the target of the hero's "I have an access code" link.
 */
export function FinalCta({ onSignIn, onJoin }: { onSignIn: () => void; onJoin: (code: string) => void }) {
    const t = useTranslations("home");
    const [code, setCode] = useState("");

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (code.trim()) onJoin(code);
    };

    return (
        <section className="mx-auto w-full max-w-[1440px] px-6 pt-36 pb-28 lg:px-20 lg:pt-[220px] lg:pb-[180px]">
            <div
                data-reveal
                className="grid grid-cols-1 items-end gap-y-12 border-t border-fg-primary/10 pt-[72px] lg:grid-cols-12 lg:gap-x-6"
            >
                <h2 className="m-0 font-display text-[clamp(3rem,6.4vw,5.75rem)] leading-none font-normal tracking-[-0.025em] text-fg-primary lg:col-span-7">
                    {t("finalHeading")}
                    <br />
                    <span className="text-accent-primary italic">{t("finalHeadingAccent")}</span>
                </h2>

                <div className="flex flex-col gap-[18px] lg:col-span-4 lg:col-start-9">
                    <p className="m-0 text-[17px] leading-[1.7] font-light text-fg-tertiary">{t("finalSubline")}</p>
                    <button
                        type="button"
                        onClick={onSignIn}
                        className="k-lift flex h-[54px] items-center justify-between rounded-full bg-accent-primary px-7 text-[15px] font-semibold text-bg-primary"
                    >
                        {t("heroPrimaryCta")}
                        <ArrowRight size={16} strokeWidth={2} />
                    </button>
                    <form
                        id="join"
                        onSubmit={submit}
                        className="flex h-[54px] scroll-mt-32 items-center overflow-hidden rounded-full border border-fg-primary/14 transition-colors focus-within:border-accent-primary/60"
                    >
                        <label htmlFor="cta-code" className="sr-only">
                            {t("accessCode")}
                        </label>
                        <input
                            id="cta-code"
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder={t("accessCode")}
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            className="h-full min-w-0 flex-grow bg-transparent px-6 font-mono text-[13px] tracking-[0.1em] text-fg-primary outline-none placeholder:text-fg-quaternary"
                        />
                        <button
                            type="submit"
                            disabled={code.trim().length === 0}
                            className="h-full border-l border-fg-primary/12 px-6 text-sm font-semibold text-fg-primary transition-colors hover:text-accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {t("finalJoin")}
                        </button>
                    </form>
                </div>
            </div>
        </section>
    );
}
