"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "~/components/layout/LanguageSwitcher";
import { ScrollProgress } from "~/components/homepage/ScrollProgress";

/**
 * Every entry is an in-page anchor, which is what `useSmoothAnchors` looks
 * for — it only intercepts `href="#…"`. A route added here as a bare <a>
 * would full-reload the page; it needs next/link.
 */
const NAV = [
    { href: "#workspaces", key: "navWorkspaces" },
    { href: "#product", key: "navProduct" },
    { href: "#why", key: "navWhyKairos" },
    { href: "#footer", key: "navAbout" },
] as const;

export function SiteHeader({ onSignIn }: { onSignIn: () => void }) {
    const t = useTranslations("home");

    return (
        <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[rgb(8_8_12_/_0.72)] backdrop-blur-[20px]">
            <div className="flex w-full items-center justify-between gap-4 px-6 py-[18px] lg:px-12">
                <a href="#top" className="flex flex-shrink-0 items-center gap-3">
                    <Image
                        src="/logo_white.png"
                        alt=""
                        width={30}
                        height={30}
                        className="h-[30px] w-[30px] object-contain"
                        priority
                    />
                    <span className="font-display text-[25px] tracking-[0.07em] text-fg-primary">
                        KAIROS
                    </span>
                </a>

                <nav className="hidden items-center gap-[34px] font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(150,150,162)] lg:flex">
                    {NAV.map((item) => (
                        <a key={item.href} href={item.href} className="k-nav text-inherit">
                            {t(item.key)}
                        </a>
                    ))}
                </nav>

                <div className="flex flex-shrink-0 items-center gap-3">
                    <LanguageSwitcher variant="compact" />
                    <button
                        type="button"
                        onClick={onSignIn}
                        className="k-ghost hidden rounded-full border border-white/[0.16] px-[18px] py-[9px] text-[13px] font-semibold text-[rgb(210,210,220)] sm:inline-flex"
                    >
                        {t("logIn")}
                    </button>
                    <button
                        type="button"
                        onClick={onSignIn}
                        className="k-btn rounded-full bg-accent-primary px-[22px] py-[10px] text-[13px] font-bold text-white"
                    >
                        {t("startFree")}
                    </button>
                </div>
            </div>
            <ScrollProgress />
        </header>
    );
}
