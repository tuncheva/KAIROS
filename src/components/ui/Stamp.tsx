/**
 * The mono stamp, in one place.
 *
 * An uppercase mono label — section headings, meta rows, status chips. It lived
 * in `publish/publishUi` while every other surface wrote `kairos-stamp` out by
 * hand at a slightly different size; this is that component promoted so the
 * stamp reads the same everywhere it appears.
 */

export function Stamp({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`kairos-stamp text-fg-tertiary text-[10px] ${className}`}>
      {children}
    </span>
  );
}
