"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "~/components/layout/LanguageSwitcher";
import { openOnboarding } from "~/components/onboarding/OnboardingSheet";

/**
 * Every entry is an in-page anchor, which is what `useSmoothAnchors` looks
 * for — it only intercepts `href="#…"`. A route added here as a bare <a>
 * would full-reload the page; it needs next/link.
 */
const NAV = [
    { href: "#agents", key: "navAgents" },
    { href: "#teams", key: "navTeams" },
    { href: "#events", key: "navEvents" },
    { href: "#footer", key: "navAbout" },
] as const;

/** Drops in with the rest of the page once the intro curtain lifts (`.k-in-down`). */
export function SiteHeader({ onSignIn }: { onSignIn: () => void }) {
    const t = useTranslations("home");

    return (
        <header className="k-in-down border-b border-fg-primary/6 [animation-delay:0.1s]">
            <div className="flex h-20 w-full items-center justify-between gap-4 px-6 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:px-20">
                <a
                    href="#top"
                    aria-label={t("aboutKairos")}
                    title={t("aboutKairos")}
                    onClick={(e) => {
                        e.preventDefault();
                        openOnboarding();
                    }}
                    className="flex flex-shrink-0 cursor-pointer items-center gap-3 justify-self-start transition-opacity hover:opacity-70"
                >
                    <Image
                        src="/logo_white.png"
                        alt=""
                        width={24}
                        height={24}
                        className="h-6 w-6 object-contain"
                        priority
                    />
                    <span className="font-display text-[23px] tracking-[0.08em] text-fg-primary">
                        KAIROS
                    </span>
                </a>

                <nav aria-label="Primary" className="hidden items-center gap-10 text-sm lg:flex">
                    {NAV.map((item) => (
                        <a key={item.href} href={item.href} className="k-nav text-fg-tertiary">
                            {t(item.key)}
                        </a>
                    ))}
                </nav>

                <div className="flex flex-shrink-0 items-center gap-4 justify-self-end sm:gap-7">
                    <LanguageSwitcher variant="compact" />
                    <button
                        type="button"
                        onClick={onSignIn}
                        className="k-nav hidden text-sm text-fg-primary sm:inline"
                    >
                        {t("logIn")}
                    </button>
                    <button
                        type="button"
                        onClick={onSignIn}
                        className="k-lift h-11 rounded-full bg-fg-primary px-[22px] text-sm font-semibold text-bg-primary"
                    >
                        {t("startFree")}
                    </button>
                </div>
            </div>
        </header>
    );
}
