/**
 * The one skeleton block.
 *
 * Ten `loading.tsx` files each wrote out `bg-bg-secondary rounded-* animate-pulse`
 * by hand, at four different radii between them. They compose from this instead,
 * so the placeholder surface and the pulse are defined once and a change to
 * either reaches every route.
 *
 * `shape` follows the radius scale: chips and lines sm, controls md, cards lg,
 * and `circle` for an avatar or an icon button.
 */

const SHAPES = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  circle: "rounded-full",
} as const;

export function Skeleton({
  className = "",
  shape = "sm",
}: {
  className?: string;
  shape?: keyof typeof SHAPES;
}) {
  return (
    <div
      aria-hidden="true"
      className={`bg-bg-secondary animate-pulse ${SHAPES[shape]} ${className}`}
    />
  );
}

/**
 * The header strip every in-app route's skeleton draws: a title line on the
 * left, a couple of round controls on the right.
 */
export function SkeletonTopBar({
  titleClassName = "h-7 w-32",
  className = "",
  children,
}: {
  titleClassName?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex items-center gap-3">
        <Skeleton className={titleClassName} />
        {children}
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8" shape="circle" />
        <Skeleton className="h-8 w-8" shape="circle" />
      </div>
    </div>
  );
}

/** A run of identical card placeholders. */
export function SkeletonCards({
  count,
  className = "h-32",
}: {
  count: number;
  className?: string;
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={className} shape="lg" />
      ))}
    </>
  );
}
