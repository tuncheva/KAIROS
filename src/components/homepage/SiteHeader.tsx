"use client";

import { useEffect, useRef, useState } from "react";
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
    { href: "#how", ns: "landing", key: "navHow" },
    { href: "#agents", ns: "home", key: "navAgents" },
    { href: "#teams", ns: "home", key: "navTeams" },
    { href: "#events", ns: "home", key: "navEvents" },
] as const;

/**
 * Fixed over the page. Transparent at the top, frosted once you scroll, tucked
 * away on the way down and back on the way up; the hairline along its foot is
 * reading progress. The link for the section under the fold line is marked
 * current. Drops in with the rest of the page once the intro curtain lifts.
 */
export function SiteHeader({ onSignIn }: { onSignIn: () => void }) {
    const t = useTranslations("home");
    const tl = useTranslations("landing");
    const headerRef = useRef<HTMLElement>(null);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const openRef = useRef(open);
    openRef.current = open;

    useEffect(() => {
        const header = headerRef.current;
        if (!header) return;
        let lastY = window.scrollY;
        let frame = 0;
        const reduced =
            typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const update = () => {
            frame = 0;
            const y = window.scrollY;
            const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
            header.classList.toggle("is-scrolled", y > 8);
            if (!reduced && !openRef.current) header.classList.toggle("is-tucked", y > lastY && y > 480);
            if (y < lastY) header.classList.remove("is-tucked");
            lastY = y;
            header.style.setProperty("--k-sp", (y / max).toFixed(4));

            const fold = window.innerHeight * 0.4;
            let current = -1;
            NAV.forEach((item, i) => {
                const section = document.getElementById(item.href.slice(1));
                if (section && section.getBoundingClientRect().top < fold) current = i;
            });
            setActive(current);
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };

        update();
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
        };
    }, []);

    return (
        <header
            ref={headerRef}
            className={`k-hdr k-in-down fixed inset-x-0 top-0 z-50 [animation-delay:0.1s] ${open ? "is-open" : ""}`}
        >
            <div className="flex h-[76px] w-full items-center justify-between gap-4 px-6 lg:grid lg:h-20 lg:grid-cols-[1fr_auto_1fr] lg:px-20">
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
                    <span className="font-display text-fg-primary text-[22px] tracking-[0.08em]">KAIROS</span>
                </a>

                <nav aria-label="Primary" className="hidden items-center gap-10 text-sm lg:flex">
                    {NAV.map((item, i) => (
                        <a
                            key={item.href}
                            href={item.href}
                            aria-current={i === active ? "true" : undefined}
                            className="k-nav text-fg-tertiary"
                        >
                            {item.ns === "landing" ? tl(item.key) : t(item.key)}
                        </a>
                    ))}
                </nav>

                <div className="flex flex-shrink-0 items-center gap-4 justify-self-end sm:gap-6">
                    <LanguageSwitcher variant="compact" />
                    <button type="button" onClick={onSignIn} className="k-nav text-fg-primary hidden text-sm sm:inline">
                        {t("logIn")}
                    </button>
                    <button
                        type="button"
                        onClick={onSignIn}
                        data-magnetic
                        className="k-lift bg-fg-primary text-bg-primary hidden h-11 rounded-full px-[22px] sm:inline-block text-sm font-semibold whitespace-nowrap"
                    >
                        {t("startFree")}
                    </button>
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        aria-controls="landing-menu"
                        aria-label={open ? tl("closeMenu") : tl("openMenu")}
                        className="border-fg-primary/14 flex h-10 w-10 flex-col items-center justify-center gap-1 rounded-full border lg:hidden"
                    >
                        <span
                            className={`bg-fg-primary block h-px w-3.5 transition-transform duration-400 ${open ? "translate-y-[2.5px] rotate-45" : ""}`}
                        />
                        <span
                            className={`bg-fg-primary block h-px w-3.5 transition-transform duration-400 ${open ? "-translate-y-[2.5px] -rotate-45" : ""}`}
                        />
                    </button>
                </div>
            </div>

            <div
                id="landing-menu"
                className={`grid transition-[grid-template-rows] duration-500 lg:hidden ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            >
                <div className="overflow-hidden" inert={!open}>
                    <ul className="m-0 flex list-none flex-col px-6 pt-2 pb-5">
                        {NAV.map((item, i) => (
                            <li key={item.href}>
                                <a
                                    href={item.href}
                                    onClick={() => setOpen(false)}
                                    className="border-fg-primary/7 font-display text-fg-primary flex justify-between border-b py-3.5 text-[22px]"
                                >
                                    {item.ns === "landing" ? tl(item.key) : t(item.key)}
                                    <span className="text-fg-tertiary self-center font-mono text-[11px] tracking-[0.14em]">
                                        {String(i + 1).padStart(2, "0")}
                                    </span>
                                </a>
                            </li>
                        ))}
                    </ul>
                    {/* Below sm the header has no room for the account buttons. */}
                    <div className="flex items-center gap-3 px-6 pb-6 sm:hidden">
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onSignIn();
                            }}
                            className="bg-fg-primary text-bg-primary h-11 flex-1 rounded-full text-sm font-semibold"
                        >
                            {t("startFree")}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onSignIn();
                            }}
                            className="border-fg-primary/14 text-fg-primary h-11 flex-1 rounded-full border text-sm"
                        >
                            {t("logIn")}
                        </button>
                    </div>
                </div>
            </div>

            <i
                aria-hidden="true"
                className="k-progress bg-accent-primary pointer-events-none absolute inset-x-0 -bottom-px block h-px"
            />
        </header>
    );
}
