/**
 * The mark inside a button while its action runs.
 *
 * Kairos has no spinners (docs/theme.md): a loading region shows the hatched
 * `Skeleton`, and a button that is busy is disabled and carries this — a small
 * dot in the button's own ink that breathes until the action settles. With
 * reduced motion it holds still.
 */
export function PendingDot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`settings-pulse inline-block h-1.5 w-1.5 flex-none rounded-full bg-current ${className}`}
    />
  );
}
