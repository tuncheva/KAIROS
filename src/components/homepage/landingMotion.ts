"use client";

import { useEffect, useState, type RefObject } from "react";
import { prefersReducedMotion } from "~/components/homepage/useLandingReveals";

/**
 * Whether reduced motion is asked for, read once on mount. The landing's CSS
 * already answers this with media queries; this is for the scripted pieces
 * (the assistant replay, the chat loop, agent autoplay) that have to choose
 * between playing and showing their end state.
 */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);
    useEffect(() => setReduced(prefersReducedMotion()), []);
    return reduced;
}

/**
 * True once the element has been on screen, and it stays true — illustrations
 * play once. Under reduced motion it is true straight away, so every
 * illustration is drawn at its end state rather than waiting to be seen.
 */
export function useInView(
    ref: RefObject<Element | null>,
    { threshold = 0.25, rootMargin = "0px 0px -8% 0px" }: IntersectionObserverInit = {},
): boolean {
    const [seen, setSeen] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
            setSeen(true);
            return;
        }
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setSeen(true);
                    io.disconnect();
                }
            },
            { threshold, rootMargin },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [ref, threshold, rootMargin]);

    return seen;
}

/**
 * Whether the element is on screen right now — for loops that should only run
 * while someone can see them (the assistant replay, the chat tile, autoplay).
 */
export function useOnScreen(ref: RefObject<Element | null>, threshold = 0.2): boolean {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
            threshold,
        });
        io.observe(el);
        return () => io.disconnect();
    }, [ref, threshold]);

    return visible;
}

/**
 * Pointer details for the whole page, delegated from the root so no section
 * wires its own listeners:
 *
 * - `data-magnetic` — a CTA leans a few pixels toward the cursor.
 * - `data-spotlight` — a tile tracks the cursor in `--k-mx` / `--k-my`, which
 *   its neutral `.k-spot` glow reads.
 *
 * Fine pointers only, and nothing under reduced motion.
 */
export function useLandingPointer(rootRef: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const root = rootRef.current;
        if (!root || prefersReducedMotion()) return;
        if (typeof window.matchMedia === "function" && !window.matchMedia("(pointer: fine)").matches) return;

        let magnet: HTMLElement | null = null;

        const onMove = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null;

            const spot = target?.closest<HTMLElement>("[data-spotlight]");
            if (spot) {
                const r = spot.getBoundingClientRect();
                spot.style.setProperty("--k-mx", `${event.clientX - r.left}px`);
                spot.style.setProperty("--k-my", `${event.clientY - r.top}px`);
            }

            const next = target?.closest<HTMLElement>("[data-magnetic]") ?? null;
            if (magnet && magnet !== next) magnet.style.translate = "";
            magnet = next;
            if (next) {
                const r = next.getBoundingClientRect();
                const dx = Math.max(-8, Math.min(8, (event.clientX - (r.left + r.width / 2)) * 0.18));
                const dy = Math.max(-6, Math.min(6, (event.clientY - (r.top + r.height / 2)) * 0.3));
                next.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
            }
        };
        const onLeave = () => {
            if (magnet) magnet.style.translate = "";
            magnet = null;
        };

        root.addEventListener("pointermove", onMove, { passive: true });
        root.addEventListener("pointerleave", onLeave);
        return () => {
            root.removeEventListener("pointermove", onMove);
            root.removeEventListener("pointerleave", onLeave);
        };
    }, [rootRef]);
}
