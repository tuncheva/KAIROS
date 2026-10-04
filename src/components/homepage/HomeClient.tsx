"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInModal } from "~/components/auth/SignInModal";
import { LandingIntro } from "~/components/homepage/LandingIntro";
import { SiteHeader } from "~/components/homepage/SiteHeader";
import { Hero } from "~/components/homepage/Hero";
import { Agents } from "~/components/homepage/Agents";
import { Teams } from "~/components/homepage/Teams";
import { Events } from "~/components/homepage/Events";
import { FinalCta } from "~/components/homepage/FinalCta";
import { SiteFooter } from "~/components/homepage/SiteFooter";
import { useLandingReveals } from "~/components/homepage/useLandingReveals";
import { useSmoothAnchors } from "~/components/homepage/useSmoothAnchors";

/**
 * Pre-auth landing page. Composition only — each section owns its own markup;
 * this holds the sign-in modal, the page-wide scroll reveals and the dark scope.
 *
 * The design is dark-only, and that used to be arranged with `setTheme("dark")`
 * in an effect. `next-themes` writes `setTheme` straight to localStorage, so
 * every visit to `/` — including the landing you get *after signing out*, and
 * every visit by someone who never signs in — overwrote the saved preference.
 * A light-mode user then signed back in to a dark first paint that flipped to
 * light once the server preference resolved, and had to set it again. The
 * `dark` class on this element below is the whole of the fix: it scopes the
 * palette to the page instead of storing it. `k-landing` then narrows that
 * palette to the landing's warmer one (see `globals.css`).
 *
 * `k-on` is what starts the hero's CSS entrance; it waits for the intro
 * curtain so the choreography is not spent underneath it.
 */
export function HomeClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    // Arriving here with a `callbackUrl` means the proxy bounced someone off a
    // page they were trying to reach — most sharply, a scanned invite QR. Show
    // them the sign-in box rather than a marketing page they did not ask for.
    // `switchAccount=1` is the same idea from the other direction: "add account"
    // signs the current session out and lands here wanting the sign-in box.
    const [isModalOpen, setIsModalOpen] = useState(
        () =>
            searchParams.get("callbackUrl") !== null ||
            searchParams.get("switchAccount") !== null,
    );
    const [introCleared, setIntroCleared] = useState(false);
    const rootRef = useRef<HTMLElement>(null);

    useLandingReveals(rootRef);
    useSmoothAnchors(rootRef);

    const openModal = useCallback(() => setIsModalOpen(true), []);
    const handleIntroClear = useCallback(() => setIntroCleared(true), []);

    /* A typed code is the same short-lived token a scanned QR carries, so it
       takes the scan's route: `/join/<code>` behind sign-in. Parking it in
       `callbackUrl` is what SignInModal already honours. Separators people
       copy along with the code ("K7M·42Q", "K7M-42Q") are dropped. */
    const handleJoin = useCallback(
        (raw: string) => {
            const code = raw.replace(/[^0-9a-z]/gi, "").toUpperCase();
            if (!code) return;
            router.replace(`/?callbackUrl=${encodeURIComponent(`/join/${code}`)}`, { scroll: false });
            setIsModalOpen(true);
        },
        [router],
    );

    return (
        <main
            id="main-content"
            ref={rootRef}
            className={`dark k-landing relative flex min-h-dvh flex-col overflow-x-hidden bg-bg-primary font-sans text-fg-primary ${
                introCleared ? "k-on" : ""
            }`}
        >
            <LandingIntro onClear={handleIntroClear} />

            <div id="top" className="flex flex-grow flex-col">
                <SiteHeader onSignIn={openModal} />
                <Hero onSignIn={openModal} />
                <Agents />
                <Teams />
                <Events />
                <FinalCta onSignIn={openModal} onJoin={handleJoin} />
                <SiteFooter />
            </div>

            <SignInModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                initialEmail={searchParams.get("email") ?? undefined}
            />
        </main>
    );
}
