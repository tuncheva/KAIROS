import Image from "next/image";

/**
 * The Kairos glyph.
 *
 * Two files rather than one recoloured file: the mark is a solid silhouette, so
 * a CSS filter would flatten the two-tone purple in light mode. The theme picks
 * which one is in the flow; the hidden one costs no layout.
 */
export function KairosMark({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Image
        src="/logo_purple.png"
        alt=""
        width={size}
        height={size}
        className="h-full w-full object-contain dark:hidden"
        priority
      />
      <Image
        src="/logo_white.png"
        alt=""
        width={size}
        height={size}
        className="hidden h-full w-full object-contain dark:block"
        priority
      />
    </span>
  );
}
