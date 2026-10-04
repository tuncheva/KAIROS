"use client";

import { useEffect, useMemo, useState } from "react";

type RgbTriplet = [number, number, number];

function parseRgbTriplet(raw: string): RgbTriplet | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;

  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;

  return [r, g, b];
}

function rgbaFromTriplet(triplet: RgbTriplet, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${triplet[0]}, ${triplet[1]}, ${triplet[2]}, ${a})`;
}

/** Hue only — enough to rank brand hues against the active accent. */
function hueOf(triplet: RgbTriplet): number {
  const r = triplet[0] / 255;
  const g = triplet[1] / 255;
  const b = triplet[2] / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;

  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return h * 360;
}

/**
 * The categorical ramp is the brand ramp, not a palette of its own.
 *
 * This module used to carry nine hand-written neon palettes keyed by a guessed
 * accent name — sixty-odd hexes that followed neither the theme nor a theme
 * switch. The six brand hues are already a categorical ramp, and they are the
 * only colours the rest of the app draws series-like fills from, so charts now
 * read them straight out of the token layer and rotate the ramp so the hue
 * nearest the active accent leads. That keeps the accent-follows-theme
 * behaviour the old palettes were reaching for, without a second palette.
 */
const BRAND_RAMP_VARS = [
  "--brand-purple",
  "--brand-pink",
  "--brand-caramel",
  "--brand-mint",
  "--brand-sky",
  "--brand-strawberry",
] as const;

/** Used before the document exists (SSR) and if a variable fails to resolve. */
const BRAND_RAMP_FALLBACK: RgbTriplet[] = [
  [168, 85, 247], // purple
  [213, 145, 145], // pink
  [233, 168, 108], // caramel
  [95, 180, 156], // mint
  [39, 111, 191], // sky
  [240, 58, 71], // strawberry
];

const STATUS_INK_FALLBACK: Record<string, RgbTriplet> = {
  success: [95, 180, 156],
  warning: [233, 168, 108],
  danger: [240, 58, 71],
  info: [78, 137, 203],
};

export function resolveCssVarToRgba(varName: string, alpha = 1): string | null {
  if (typeof document === "undefined") return null;

  const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
  const triplet = parseRgbTriplet(value);
  if (!triplet) return null;

  return rgbaFromTriplet(triplet, alpha);
}

function resolveCssVarToTriplet(varName: string): RgbTriplet | null {
  if (typeof document === "undefined") return null;

  const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
  return parseRgbTriplet(value);
}

export function useThemeColorTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const el = document.documentElement;

    const obs = new MutationObserver(() => setTick((t) => t + 1));
    obs.observe(el, {
      attributes: true,
      attributeFilter: ["class", "data-accent"],
    });

    return () => obs.disconnect();
  }, []);

  return tick;
}

export function useResolvedThemeColors() {
  const tick = useThemeColorTick();

  return useMemo(() => {
    const accentPrimaryTriplet = tick >= 0 ? resolveCssVarToTriplet("--accent-primary") : null;

    const ramp: RgbTriplet[] = BRAND_RAMP_VARS.map(
      (name, i) => resolveCssVarToTriplet(name) ?? BRAND_RAMP_FALLBACK[i]!,
    );

    /* Rotate so the brand hue closest to the active accent comes first: the
       leading series then matches the accent the rest of the page is wearing. */
    let lead = 0;
    if (accentPrimaryTriplet) {
      const accentHue = hueOf(accentPrimaryTriplet);
      let best = Number.POSITIVE_INFINITY;
      ramp.forEach((c, i) => {
        const raw = Math.abs(hueOf(c) - accentHue);
        const distance = Math.min(raw, 360 - raw);
        if (distance < best) {
          best = distance;
          lead = i;
        }
      });
    }
    const ordered = [...ramp.slice(lead), ...ramp.slice(0, lead)];
    const palette = ordered.map((color, index) => rgbaFromTriplet(color, 0.92 - index * 0.02));

    const statusInk = (name: keyof typeof STATUS_INK_FALLBACK, alpha: number) =>
      resolveCssVarToRgba(`--status-${name}-ink`, alpha) ??
      rgbaFromTriplet(STATUS_INK_FALLBACK[name]!, alpha);

    const fallbackColor: RgbTriplet = ordered[0] ?? BRAND_RAMP_FALLBACK[0]!;

    return {
      palette,
      completed: palette[0] ?? rgbaFromTriplet(fallbackColor, 0.9),
      other: rgbaFromTriplet(ordered[4] ?? fallbackColor, 0.7),
      remaining: rgbaFromTriplet(ordered[5] ?? ordered[2] ?? fallbackColor, 0.5),
      border: resolveCssVarToRgba("--border-medium", 0.6) ?? "rgba(148, 163, 184, 0.6)",
      /* The same four semantic families the rest of the app uses, rather than a
         neon list of this module's own. */
      success: statusInk("success", 0.9),
      warning: statusInk("warning", 0.9),
      info: statusInk("info", 0.9),
      error: statusInk("danger", 0.9),
      fgPrimary: resolveCssVarToRgba("--fg-primary", 1) ?? "rgba(15, 23, 42, 1)",
      bgOverlay: resolveCssVarToRgba("--bg-overlay", 0.96) ?? "rgba(255, 255, 255, 0.96)",
    };
  }, [tick]);
}
