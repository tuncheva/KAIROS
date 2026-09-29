"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LOCALE_METADATA, locales } from "~/i18n/locales";

const COLUMNS = [
    {
        headingKey: "footerProduct",
        links: [
            { labelKey: "footerAgents", href: "#agents" },
            { labelKey: "footerTeams", href: "#teams" },
            { labelKey: "footerEvents", href: "#events" },
        ],
    },
    {
        headingKey: "footerCompany",
        links: [
            { labelKey: "footerAbout", href: "/about" },
            { labelKey: "footerContact", href: "/contact" },
            { labelKey: "footerCareers", href: "/careers" },
        ],
    },
    {
        headingKey: "footerLegal",
        links: [
            { labelKey: "footerPrivacy", href: "/privacy" },
            { labelKey: "footerTerms", href: "/terms" },
            { labelKey: "footerSecurity", href: "/security" },
        ],
    },
] as const;

export function SiteFooter() {
    const t = useTranslations("home");

    return (
        <footer id="footer" className="flex-grow border-t border-fg-primary/6">
            <div className="mx-auto flex w-full max-w-[1440px] flex-col justify-between gap-14 px-6 pt-14 pb-12 lg:px-20">
                <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex flex-col gap-3.5">
                        <span className="flex items-center gap-2.5">
                            <Image src="/logo_white.png" alt="" width={20} height={20} className="h-5 w-5 object-contain" />
                            <span className="font-display text-[21px] tracking-[0.08em] text-fg-primary">KAIROS</span>
                        </span>
                        <span className="text-sm text-fg-quaternary">{t("footerTagline")}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-10 text-sm sm:flex sm:gap-[88px]">
                        {COLUMNS.map((col) => (
                            <div key={col.headingKey} className="flex flex-col gap-3.5">
                                <span className="k-ink-faint">{t(col.headingKey)}</span>
                                {col.links.map((link) => (
                                    <Link key={link.labelKey} href={link.href} className="k-nav self-start text-fg-tertiary">
                                        {t(link.labelKey)}
                                    </Link>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="k-ink-faint flex flex-col gap-2 text-[13px] sm:flex-row sm:justify-between">
                    <span>&copy; {new Date().getFullYear()} Kairos</span>
                    <span>{locales.map((l) => LOCALE_METADATA[l].name).join(" · ")}</span>
                </div>
            </div>
        </footer>
    );
}
