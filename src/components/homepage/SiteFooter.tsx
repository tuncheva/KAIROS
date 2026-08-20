"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { locales } from "~/i18n/locales";

const COLUMNS = [
    {
        headingKey: "footerProduct",
        links: [
            { labelKey: "footerOrganizations", href: "#workspaces" },
            { labelKey: "footerTeams", href: "#workspaces" },
            { labelKey: "footerEvents", href: "#product" },
            { labelKey: "footerTimelines", href: "#product" },
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
        <footer id="footer" className="border-t border-white/[0.08] bg-[#07070b] px-6 pt-16 pb-10 lg:px-12">
            <div className="mx-auto w-full max-w-[1280px]">
                <div className="grid grid-cols-2 gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
                    <div className="col-span-2 lg:col-span-1">
                        <div className="flex items-center gap-2.5">
                            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-[linear-gradient(140deg,rgb(var(--accent-primary)),rgb(var(--accent-secondary)))]">
                                <Image
                                    src="/logo_white.png"
                                    alt=""
                                    width={15}
                                    height={15}
                                    className="h-[15px] w-[15px] object-contain"
                                />
                            </span>
                            <span className="font-display text-[21px] text-fg-primary">Kairos</span>
                        </div>
                        <p className="mt-4 max-w-[280px] text-sm leading-[1.7] text-[rgb(140,140,152)]">
                            {t("footerTagline")}
                        </p>
                    </div>

                    {COLUMNS.map((col) => (
                        <div key={col.headingKey} className="flex flex-col gap-3">
                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(110,110,124)]">
                                {t(col.headingKey)}
                            </div>
                            {col.links.map((link) => (
                                <Link
                                    key={link.labelKey}
                                    href={link.href}
                                    className="k-nav text-sm text-[rgb(190,190,202)]"
                                >
                                    {t(link.labelKey)}
                                </Link>
                            ))}
                        </div>
                    ))}
                </div>

                <div className="mt-12 flex flex-col gap-2 border-t border-white/[0.07] pt-[22px] font-mono text-[11px] tracking-[0.1em] text-[rgb(105,105,118)] sm:flex-row sm:justify-between">
                    <span>&copy; {new Date().getFullYear()} Kairos</span>
                    <span>{locales.map((l) => l.toUpperCase()).join(" · ")}</span>
                </div>
            </div>
        </footer>
    );
}
