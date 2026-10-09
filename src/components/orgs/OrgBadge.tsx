import Image from "next/image";

import { avatarSoftGradientStyle } from "~/lib/avatarGradient";

/**
 * Two-letter monogram for an organisation.
 *
 * Initials of the first two words when there are two, otherwise the first two
 * letters — "Tina's Organization" reads as TO, "Kairos" as KA.
 */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
  }
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/**
 * An org's identity badge: its logo when it has one, otherwise a soft,
 * low-contrast take on the seeded gradient profiles use, with a tinted
 * monogram — seeded by id so the colour survives a rename, not by name.
 */
export function OrgBadge({
  id,
  name,
  image,
  size = 32,
  rounded = "rounded-lg",
}: {
  id: number | string;
  name: string;
  image?: string | null;
  size?: number;
  rounded?: string;
}) {
  if (image) {
    return (
      <Image
        src={image}
        alt=""
        width={size}
        height={size}
        unoptimized
        className={`shrink-0 ${rounded} object-cover`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center ${rounded} font-semibold tracking-wide`}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.3)), ...avatarSoftGradientStyle(String(id)) }}
    >
      {monogram(name)}
    </span>
  );
}
