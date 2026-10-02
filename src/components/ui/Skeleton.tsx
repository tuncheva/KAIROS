/**
 * The one skeleton block — a hatched placeholder.
 *
 * Every loading state in the app composes from this, so the hatch, the crawl,
 * the per-row wave and the 300ms hold-off are defined once (`.k-skel` in
 * `globals.css`) and a change to any of them reaches every route.
 *
 * ## Rules
 *
 * 1. Hatch only what's unknown. The rail, the top bar, page titles, column
 *    headers, field labels and control outlines render for real — only data
 *    turns to hatch.
 * 2. Match the real geometry: same row heights, gaps and radii as the loaded
 *    state, so nothing moves when data lands. A text bar follows the
 *    x-height (≈9px for body copy), not the line box; the last line of a block
 *    runs short.
 * 3. Pass `row` so the wave reads top to bottom (+90ms per row, capped at 12).
 * 4. `tone="yours"` for your own messages and the selected row.
 *
 * `shape` picks the radius: `line` for text (3px), `title` for a display line
 * or a figure (6px), `tile` for orgs and files (9px), `block` for covers and
 * cards (8px), `bubble` for messages (14px), `circle` for people.
 */

import type { CSSProperties } from "react";

const SHAPES = {
  line: "rounded-[3px]",
  title: "rounded-[6px]",
  tile: "rounded-[9px]",
  block: "rounded-[8px]",
  bubble: "rounded-[14px]",
  circle: "rounded-full",
} as const;

export type SkeletonShape = keyof typeof SHAPES;

/** The wave offset for the `row`th row of a panel: 90ms a row, capped at 12. */
export function skeletonDelay(row: number): CSSProperties {
  return {
    "--k-skel-delay": `${Math.round(Math.min(Math.max(row, 0), 12) * 90)}ms`,
  } as CSSProperties;
}

export function Skeleton({
  className = "",
  shape = "line",
  row = 0,
  tone,
  style,
  children,
}: {
  className?: string;
  shape?: SkeletonShape;
  /** Position in the panel, top to bottom — offsets the opacity wave. */
  row?: number;
  /** `yours` — the faint accent hatch for your own message or row. */
  tone?: "yours";
  style?: CSSProperties;
  /** Rarely needed: a ring or a cut-out drawn inside the patch. */
  children?: React.ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={`k-skel ${tone === "yours" ? "k-skel--yours" : ""} ${SHAPES[shape]} ${className}`}
      style={{ ...skeletonDelay(row), ...style }}
    >
      {children}
    </span>
  );
}

/**
 * A run of text lines, the last one short — a paragraph, a preview, a
 * message body. `widths` are percentages of the column.
 */
export function SkeletonLines({
  widths,
  row = 0,
  className = "h-[9px]",
  gap = "gap-[11px]",
}: {
  widths: readonly number[];
  row?: number;
  className?: string;
  gap?: string;
}) {
  return (
    <span aria-hidden="true" className={`flex flex-col ${gap}`}>
      {widths.map((w, i) => (
        <Skeleton
          key={i}
          className={className}
          row={row + i * 0.5}
          style={{ width: `${w}%` }}
        />
      ))}
    </span>
  );
}

/**
 * Deterministic widths so a skeleton renders identically on the server and the
 * client (no hydration mismatch) while rows still vary like real data does.
 * Returns a percentage between `lo` and `hi`.
 */
export function skeletonWidth(seed: number, lo: number, hi: number): string {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return `${Math.round(lo + (x - Math.floor(x)) * (hi - lo))}%`;
}

/**
 * The screen-reader side of a loading region. Skeleton blocks are
 * `aria-hidden`; one of these per page says what is happening instead.
 */
export function SkeletonStatus({ label }: { label: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}
