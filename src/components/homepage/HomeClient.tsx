"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { SignInModal } from "~/components/auth/SignInModal";
import { LandingIntro } from "~/components/homepage/LandingIntro";
import { SiteHeader } from "~/components/homepage/SiteHeader";
import { Hero } from "~/components/homepage/Hero";
import { Marquee } from "~/components/homepage/Marquee";
import { Workspaces } from "~/components/homepage/Workspaces";
import { ProductStrip } from "~/components/homepage/ProductStrip";
import { HowItWorks } from "~/components/homepage/HowItWorks";
import { WhyTeams } from "~/components/homepage/WhyTeams";
import { Stats } from "~/components/homepage/Stats";
import { Testimonial } from "~/components/homepage/Testimonial";
import { FinalCta } from "~/components/homepage/FinalCta";
import { SiteFooter } from "~/components/homepage/SiteFooter";
import { useLandingReveals } from "~/components/homepage/useLandingReveals";
import { useSmoothAnchors } from "~/components/homepage/useSmoothAnchors";

/**
 * Pre-auth landing page. Composition only — each section owns its own markup
 * and motion; this holds the sign-in modal, the forced-dark theme and the
 * page-wide scroll reveals.
 */
export function HomeClient() {
    const { setTheme } = useTheme();
    const searchParams = useSearchParams();
    // Arriving here with a `callbackUrl` means the proxy bounced someone off a
    // page they were trying to reach — most sharply, a scanned invite QR. Show
    // them the sign-in box rather than a marketing page they did not ask for.
    const [isModalOpen, setIsModalOpen] = useState(
        () => searchParams.get("callbackUrl") !== null,
    );
    const [introCleared, setIntroCleared] = useState(false);
    const rootRef = useRef<HTMLElement>(null);

    // The design is dark-only.
    useEffect(() => {
        setTheme("dark");
    }, [setTheme]);

    useLandingReveals(rootRef);
    useSmoothAnchors(rootRef);

    const openModal = useCallback(() => setIsModalOpen(true), []);
    const handleIntroClear = useCallback(() => setIntroCleared(true), []);

    return (
        <main
            id="main-content"
            ref={rootRef}
            className="dark relative min-h-screen overflow-x-hidden bg-bg-primary text-fg-primary"
        >
            <LandingIntro onClear={handleIntroClear} />

            {/* Background wash — two calm drifting circles behind everything */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
                <div
                    className="k-drift-slow absolute -top-[160px] -left-[200px] h-[820px] w-[820px] rounded-full blur-[90px]"
                    style={{
                        background:
                            "radial-gradient(circle at 45% 45%, rgb(var(--accent-primary) / 0.22), rgb(var(--accent-secondary) / 0.09), transparent 66%)",
                    }}
                />
                <div
                    className="k-drift-slower absolute top-[1100px] -right-[260px] h-[700px] w-[700px] rounded-full blur-[90px]"
                    style={{
                        background:
                            "radial-gradient(circle at 50% 50%, rgb(var(--accent-secondary) / 0.16), transparent 62%)",
                    }}
                />
            </div>

            <div id="top" className="relative z-10">
                <SiteHeader onSignIn={openModal} />
                <Hero onSignIn={openModal} ready={introCleared} />
                <Marquee />
                <Workspaces />
                <ProductStrip />
                <HowItWorks />
                <WhyTeams />
                <Stats />
                <Testimonial />
                <FinalCta onSignIn={openModal} />
                <SiteFooter />
            </div>

            <SignInModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </main>
    );
}
