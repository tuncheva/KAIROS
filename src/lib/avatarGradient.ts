/**
 * The colour a person gets when they have no profile picture.
 *
 * Picked from a fixed palette by hashing whatever identifies them, so the same
 * person is the same colour on every surface and across reloads — a genuinely
 * random pick would flicker on every render and make people unrecognisable.
 * The palette is hand-picked to stay legible under white bold text in both
 * themes, which is why these are literal colours rather than theme tokens.
 */

const GRADIENTS = [
  ["#6366f1", "#a855f7"],
  ["#0ea5e9", "#2563eb"],
  ["#14b8a6", "#0891b2"],
  ["#10b981", "#059669"],
  ["#f59e0b", "#ea580c"],
  ["#ef4444", "#db2777"],
  ["#8b5cf6", "#d946ef"],
  ["#f43f5e", "#a21caf"],
  ["#0891b2", "#4f46e5"],
  ["#65a30d", "#0d9488"],
  ["#e11d48", "#f97316"],
  ["#7c3aed", "#2563eb"],
] as const;

/** FNV-1a — small, stable, and good enough to spread names over 12 buckets. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A `background` value for a fallback avatar.
 *
 * `seed` should be the most stable thing to hand — an id where we have one,
 * otherwise the email or name. An empty seed still yields a colour rather than
 * a blank circle.
 */
export function avatarGradient(seed: string | null | undefined): string {
  const [from, to] = GRADIENTS[hash(seed?.trim().toLowerCase() ?? "") % GRADIENTS.length]!;
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** The same thing as an inline style, for the common `style={...}` case. */
export function avatarGradientStyle(seed: string | null | undefined): { background: string } {
  return { background: avatarGradient(seed) };
}
