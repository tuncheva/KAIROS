"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "~/components/homepage/landingMotion";
import { prefersReducedMotion } from "~/components/homepage/useLandingReveals";

/**
 * A figure that counts up from zero the first time it is seen, easing out.
 * It renders the real number until then — on the server, without script and
 * under reduced motion the figure is simply correct.
 */
export function CountUp({ to, duration = 1600 }: { to: number; duration?: number }) {
    const ref = useRef<HTMLSpanElement>(null);
    const seen = useInView(ref);
    const [value, setValue] = useState(to);

    useEffect(() => {
        if (!seen || prefersReducedMotion()) return;
        let frame = 0;
        const start = performance.now();
        const step = (now: number) => {
            const p = Math.min(1, (now - start) / duration);
            setValue(Math.round(to * (p === 1 ? 1 : 1 - Math.pow(2, -10 * p))));
            if (p < 1) frame = requestAnimationFrame(step);
        };
        setValue(0);
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [seen, to, duration]);

    return (
        <span ref={ref} className="tabular-nums">
            {value}
        </span>
    );
}
