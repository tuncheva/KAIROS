import { Fragment, type ReactNode } from "react";

/**
 * Small pieces every landing section repeats. The palette they read is the
 * landing-scoped token override on `.k-landing` in `globals.css`, so these are
 * plain token utilities rather than the design file's hexes.
 */

/** Mono eyebrow above a section heading. */
export function Eyebrow({ children }: { children: ReactNode }) {
    return <span className="text-fg-tertiary font-mono text-[11px] tracking-[0.24em] uppercase">{children}</span>;
}

/**
 * One word per mask, so `data-reveal-split` can slide each up in turn. The
 * words are rendered rather than split from the DOM afterwards, so a locale
 * switch re-renders them like any other text.
 */
function Words({ text, italic = false }: { text: string; italic?: boolean }) {
    return (
        <>
            {text
                .split(/\s+/)
                .filter(Boolean)
                .map((word, i, all) => (
                    <Fragment key={`${word}-${i}`}>
                        <span className="-mx-[0.06em] -mb-[0.12em] inline-block overflow-hidden px-[0.06em] pb-[0.12em] align-top">
                            <span data-word className={`inline-block ${italic ? "text-accent-primary italic" : ""}`}>
                                {word}
                            </span>
                        </span>
                        {i < all.length - 1 ? " " : null}
                    </Fragment>
                ))}
        </>
    );
}

/** Section heading: display face, with the closing phrase in italic accent. */
export function SectionHeading({
    lead,
    accent,
    id,
    className = "",
}: {
    lead: string;
    accent: string;
    id?: string;
    className?: string;
}) {
    return (
        <h2
            id={id}
            data-reveal-split
            aria-label={`${lead} ${accent}`}
            className={`font-display text-fg-primary m-0 text-[clamp(2.5rem,4.5vw,4rem)] leading-[1.02] font-normal tracking-[-0.02em] ${className}`}
        >
            <span aria-hidden="true">
                <Words text={lead} /> <Words text={accent} italic />
            </span>
        </h2>
    );
}

/** Eyebrow + heading + lead, the head every section opens with. */
export function SectionHead({
    eyebrow,
    lead,
    accent,
    body,
    id,
    children,
}: {
    eyebrow: string;
    lead: string;
    accent: string;
    body: string;
    id: string;
    children?: ReactNode;
}) {
    return (
        <div className="flex max-w-[760px] flex-col gap-[26px]">
            <div data-reveal>
                <Eyebrow>{eyebrow}</Eyebrow>
            </div>
            <SectionHeading id={id} lead={lead} accent={accent} />
            <p data-reveal className="text-fg-tertiary m-0 text-[17px] leading-[1.75] font-light">
                {body}
            </p>
            {children}
        </div>
    );
}

/** The mono tag on a list row or card corner. */
export function Tag({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
    return (
        <span
            className={`font-mono text-[10px] tracking-[0.16em] uppercase ${
                accent ? "text-accent-primary" : "text-fg-tertiary"
            }`}
        >
            {children}
        </span>
    );
}
