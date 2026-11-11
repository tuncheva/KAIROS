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
 * - `data-reveal`       up-and-unblur, the page's default entrance
 * - `data-reveal-rule`  hairline scaling out from its left edge
 * - `data-reveal-split` a heading whose `[data-word]` spans each slide up
 *                       through their own mask (see `SplitHeading`)
 * - `data-stagger`      direct children rise one after another
 * - `data-parallax="N"` drifts N px against the scroll while on screen
 *                       (from 640px up; put it on a wrapper, not on an
 *                       element that also has `data-reveal`)
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
        const splits = root.querySelectorAll<HTMLElement>("[data-reveal-split]");
        const staggers = root.querySelectorAll<HTMLElement>("[data-stagger]");
        const parallax = root.querySelectorAll<HTMLElement>("[data-parallax]");

        if (prefersReducedMotion()) {
            gsap.set(ups, { opacity: 1, y: 0, filter: "none" });
            gsap.set(rules, { scaleX: 1 });
            return;
        }

        const ctx = gsap.context(() => {
            ups.forEach((el) => {
                gsap.set(el, { opacity: 0, y: 32, filter: "blur(6px)" });
                gsap.to(el, {
                    opacity: 1,
                    y: 0,
                    filter: "blur(0px)",
                    duration: 0.8,
                    ease: ENTER_EASE,
                    scrollTrigger: { trigger: el, start: "top 88%", once: true },
                });
            });

            rules.forEach((el) => {
                gsap.set(el, { scaleX: 0, transformOrigin: "left center" });
                gsap.to(el, {
                    scaleX: 1,
                    duration: 0.9,
                    ease: ENTER_EASE,
                    scrollTrigger: { trigger: el, start: "top 92%", once: true },
                });
            });

            splits.forEach((el) => {
                const words = el.querySelectorAll<HTMLElement>("[data-word]");
                gsap.set(words, { yPercent: 110 });
                gsap.to(words, {
                    yPercent: 0,
                    duration: 0.8,
                    stagger: 0.04,
                    ease: "expo.out",
                    scrollTrigger: { trigger: el, start: "top 88%", once: true },
                });
            });

            staggers.forEach((el) => {
                const children = Array.from(el.children);
                gsap.set(children, { opacity: 0, y: 16 });
                gsap.to(children, {
                    opacity: 1,
                    y: 0,
                    duration: 0.6,
                    stagger: 0.06,
                    delay: 0.08,
                    ease: ENTER_EASE,
                    scrollTrigger: { trigger: el, start: "top 88%", once: true },
                });
            });

            if (window.innerWidth >= 640) {
                parallax.forEach((el) => {
                    const amount = Number(el.dataset.parallax) || 0;
                    gsap.fromTo(
                        el,
                        { y: amount },
                        {
                            y: -amount,
                            ease: "none",
                            scrollTrigger: {
                                trigger: el.parentElement ?? el,
                                start: "top bottom",
                                end: "bottom top",
                                scrub: true,
                            },
                        },
                    );
                });
            }
        }, root);

        return () => ctx.revert();
    }, [rootRef]);
}
