import { KairosMark } from "~/components/layout/KairosMark";

/**
 * The brand vocabulary for the screens nobody designed.
 *
 * 404, the error boundaries and the full-page loading state were the only
 * surfaces in the app with no design pass: a bold sans heading at text-2xl, a
 * warning character in whatever emoji font the OS supplied, and no mark, eyebrow
 * or stamp anywhere. They now read like the rest of the product — a mono
 * eyebrow, the Kairos mark, a display-serif headline, Geist body copy and a
 * mono footer line.
 *
 * Deliberately hook-free and provider-free so the server-rendered `loading.tsx`
 * and the client-rendered `error.tsx` can both use it. Every string arrives
 * already translated from the caller.
 */
export function SystemScreen({
  eyebrow,
  title,
  body,
  icon,
  actions,
  footer,
  className = "",
}: {
  /** A mono stamp: "ERROR · 500", "404 · NOT FOUND", "LOADING". */
  eyebrow: string;
  title: string;
  body?: string;
  /** An icon from `ui/icons`, never a text glyph. */
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  /** A mono line under the actions — the error digest, a hint. */
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`kairos-page-enter bg-bg-primary flex min-h-dvh flex-col items-center justify-center px-6 ${className}`}
    >
      <div className="flex w-full max-w-[460px] flex-col items-center text-center">
        {icon ? (
          <span className="h-control-lg w-control-lg border-border-light bg-bg-elevated text-fg-tertiary mb-6 grid place-items-center rounded-lg border">
            {icon}
          </span>
        ) : (
          <KairosMark size={34} className="mb-6" />
        )}

        <p className="text-fg-quaternary font-mono text-[11px] tracking-[0.18em] uppercase">
          {eyebrow}
        </p>

        <h1 className="font-display text-fg-primary mt-4 text-[clamp(1.75rem,5vw,2.5rem)] leading-[1.1] font-normal">
          {title}
        </h1>

        {body ? (
          <p className="text-fg-secondary mt-4 max-w-[42ch] text-[15px] leading-[1.65]">
            {body}
          </p>
        ) : null}

        {actions ? (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {actions}
          </div>
        ) : null}

        {footer ? <div className="mt-8">{footer}</div> : null}
      </div>
    </div>
  );
}

const ACTION_BASE =
  "inline-flex h-control-md items-center justify-center rounded-md px-5 text-[13px] font-semibold transition-colors";

/** The action that does the thing. Flat accent, not a gradient. */
export const SYSTEM_ACTION_PRIMARY = `${ACTION_BASE} bg-accent-primary text-white hover:bg-accent-hover`;

/** The way back. Flat ink on a hairline, which is the house style for accent. */
export const SYSTEM_ACTION_QUIET = `${ACTION_BASE} border border-border-medium text-fg-secondary hover:border-accent-primary/50 hover:text-fg-primary`;
