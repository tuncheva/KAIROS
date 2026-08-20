"use client";

import { useEffect, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { prefersReducedMotion } from "~/components/homepage/useLandingReveals";

gsap.registerPlugin(ScrollToPlugin);

/**
 * In-page anchors glide to their section instead of jumping to it, on the same
 * easing the page's reveals use.
 *
 * Wired as one delegated listener on the page root rather than per link, so
 * every `href="#…"` on the page — nav, hero CTA, footer columns — behaves the
 * same way without each component knowing about it.
 *
 * The landing target is offset by the sticky header's real measured height, so
 * a section heading is never left tucked underneath it. Under reduced motion
 * the same offset is applied, just without the travel.
 */
export function useSmoothAnchors(rootRef: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const onClick = (event: MouseEvent) => {
            // Leave modified clicks (new tab, new window) to the browser.
            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
            ) {
                return;
            }

            const target = event.target;
            if (!(target instanceof Element)) return;

            const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
            if (!link || !root.contains(link)) return;

            const id = link.getAttribute("href")?.slice(1);
            if (!id) return;

            const section = document.getElementById(id);
            if (!section) return;

            event.preventDefault();

            const header = root.querySelector("header");
            const offsetY = (header?.getBoundingClientRect().height ?? 0) + 24;

            if (prefersReducedMotion()) {
                const top = section.getBoundingClientRect().top + window.scrollY - offsetY;
                window.scrollTo(0, Math.max(0, top));
            } else {
                gsap.to(window, {
                    duration: 1.1,
                    ease: "power3.out",
                    scrollTo: { y: section, offsetY, autoKill: true },
                });
            }

            // Keep the address bar in step without handing the browser a jump.
            window.history.replaceState(null, "", `#${id}`);
        };

        root.addEventListener("click", onClick);
        return () => root.removeEventListener("click", onClick);
    }, [rootRef]);
}
