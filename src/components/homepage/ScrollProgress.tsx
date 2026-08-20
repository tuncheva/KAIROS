"use client";

import { useEffect, useRef } from "react";

/**
 * Read-progress rail. It rides the bottom edge of the sticky header, so it is
 * the one piece of chrome that tracks how far down the page you are.
 *
 * The width is written straight to the node rather than through state — this
 * updates on every scroll frame and must not re-render the header.
 */
export function ScrollProgress() {
    const fillRef = useRef<HTMLElement>(null);

    useEffect(() => {
        const fill = fillRef.current;
        if (!fill) return;

        let frame = 0;

        const tick = () => {
            frame = 0;
            const max = document.documentElement.scrollHeight - window.innerHeight;
            const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
            fill.style.width = `${(progress * 100).toFixed(2)}%`;
        };

        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(tick);
        };

        tick();
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);

        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
        };
    }, []);

    return (
        <div className="k-prog" aria-hidden="true">
            <i ref={fillRef} />
        </div>
    );
}
