"use client";

import { useEffect, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function prefersReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const ENTER_EASE = "power3.out";

/**
 * Scroll reveals for the landing page, wired once over the whole page rather
 * than per section. Elements opt in with a data attribute:
 *
 * - `data-reveal`      up-and-unblur, the page's default entrance
 * - `data-reveal-rule` hairline scaling out from its left edge
 *
 * Reveals fire once and never reverse. Under reduced motion every element is
 * set straight to its visible state — nothing waits on a transition.
 */
export function useLandingReveals(rootRef: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const ups = root.querySelectorAll<HTMLElement>("[data-reveal]");
        const rules = root.querySelectorAll<HTMLElement>("[data-reveal-rule]");

        if (prefersReducedMotion()) {
            gsap.set(ups, { opacity: 1, y: 0, filter: "none" });
            gsap.set(rules, { scaleX: 1 });
            return;
        }

        const ctx = gsap.context(() => {
            ups.forEach((el) => {
                gsap.set(el, { opacity: 0, y: 44, filter: "blur(8px)" });
                gsap.to(el, {
                    opacity: 1,
                    y: 0,
                    filter: "blur(0px)",
                    duration: 1.1,
                    ease: ENTER_EASE,
                    scrollTrigger: { trigger: el, start: "top 88%", once: true },
                });
            });

            rules.forEach((el) => {
                gsap.set(el, { scaleX: 0, transformOrigin: "left center" });
                gsap.to(el, {
                    scaleX: 1,
                    duration: 1.2,
                    ease: ENTER_EASE,
                    scrollTrigger: { trigger: el, start: "top 92%", once: true },
                });
            });
        }, root);

        return () => ctx.revert();
    }, [rootRef]);
}
