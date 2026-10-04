import type { ReactNode } from "react";

/**
 * Small pieces every landing section repeats. The palette they read is the
 * landing-scoped token override on `.k-landing` in `globals.css`, so these are
 * plain token utilities rather than the design file's hexes.
 */

/** Mono eyebrow above a section heading. */
export function Eyebrow({ children }: { children: ReactNode }) {
    return (
        <span className="font-mono text-[11px] tracking-[0.24em] text-fg-quaternary uppercase">
            {children}
        </span>
    );
}

/** Section heading: serif, with the closing phrase in italic accent. */
export function SectionHeading({ lead, accent }: { lead: string; accent: string }) {
    return (
        <h2 className="m-0 font-display text-[clamp(2.75rem,4.5vw,4rem)] leading-[1.02] font-normal tracking-[-0.015em] text-fg-primary">
            {lead} <span className="text-accent-primary italic">{accent}</span>
        </h2>
    );
}

/** The mono tag on a list row or card corner. */
export function Tag({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
    return (
        <span
            className={`font-mono text-[10px] tracking-[0.16em] uppercase ${
                accent ? "text-accent-primary" : "text-fg-quaternary"
            }`}
        >
            {children}
        </span>
    );
}
