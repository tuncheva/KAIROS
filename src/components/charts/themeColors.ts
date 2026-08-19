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

function hexToRgb(hex: string): RgbTriplet {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

// Convert RGB to HSL
function rgbToHsl(triplet: RgbTriplet): [number, number, number] {
  const r = triplet[0] / 255;
  const g = triplet[1] / 255;
  const b = triplet[2] / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return [h * 360, s * 100, l * 100];
}

// Predefined vibrant palettes for each accent color
// Each palette has 6 colors that work harmoniously together

  
// Predefined vibrant palettes for each accent color
// Each palette has 6 colors that work harmoniously together
const ACCENT_PALETTES: Record<string, RgbTriplet[]> = {
  // Pink accent - Neon/Electric Pink based
  pink: [
    hexToRgb('#FF14BD'), // Main Neon Pink (was #FF99C8)
    hexToRgb('#FF007F'), // Brightest Electric Pink
    hexToRgb('#FF6EE0'), // Light Neon Pink
    hexToRgb('#D600A4'), // Deep Neon Magenta
    hexToRgb('#FF00CC'), // Vivid Pink
    hexToRgb('#FFB6EB'), // Soft Neon/Pastel
  ],
  
  // Caramel/Yellow accent - #FCF6BD based   
  caramel: [
    hexToRgb('#FCF6BD'), // Caramel
    hexToRgb('#FFE66D'), // Bright yellow
    hexToRgb('#FFF3A3'), // Light yellow
    hexToRgb('#F4D35E'), // Golden
    hexToRgb('#FFD93D'), // Vivid yellow
    hexToRgb('#FFFACD'), // Lemon chiffon
  ],
  
  // Mint/Green accent - #D0F4DE based
  mint: [
    hexToRgb('#D0F4DE'), // Mint
    hexToRgb('#95E1B7'), // Bright mint
    hexToRgb('#B8F0CB'), // Light mint
    hexToRgb('#6BCB77'), // Green
    hexToRgb('#A8E6CF'), // Seafoam
    hexToRgb('#C1F4D5'), // Pale mint
  ],
  
  // Sky/Blue accent - #A9DEF9 based
  sky: [
    hexToRgb('#A9DEF9'), // Sky blue
    hexToRgb('#60C5F1'), // Bright blue
    hexToRgb('#87CEEB'), // Light sky blue
    hexToRgb('#4DB8E8'), // Vivid blue
    hexToRgb('#7DD3FC'), // Light cyan
    hexToRgb('#B8E4FA'), // Pale blue
  ],
  
  // Purple accent - #E4C1F9, #8069BB based
  purple: [
    hexToRgb('#E4C1F9'), // Light purple
    hexToRgb('#8069BB'), // Deep purple
    hexToRgb('#C9A9F5'), // Medium purple
    hexToRgb('#A855F7'), // Vivid purple
    hexToRgb('#D4B3F7'), // Soft purple
    hexToRgb('#9F7AEA'), // Bright purple
  ],
  
  // Default violet palette
  violet: [
    hexToRgb('#8B5CF6'), // Violet
    hexToRgb('#A78BFA'), // Light violet
    hexToRgb('#7C3AED'), // Deep violet
    hexToRgb('#C4B5FD'), // Pale violet
    hexToRgb('#6D28D9'), // Dark violet
    hexToRgb('#DDD6FE'), // Lavender
  ],
  
  // Orange accent
  orange: [
    hexToRgb('#FB923C'), // Orange
    hexToRgb('#FDBA74'), // Light orange
    hexToRgb('#F97316'), // Vivid orange
    hexToRgb('#FED7AA'), // Pale orange
    hexToRgb('#EA580C'), // Deep orange
    hexToRgb('#FFEDD5'), // Cream orange
  ],
  
  // Red accent
  red: [
    hexToRgb('#F87171'), // Red
    hexToRgb('#FCA5A5'), // Light red
    hexToRgb('#EF4444'), // Vivid red
    hexToRgb('#FECACA'), // Pale red
    hexToRgb('#DC2626'), // Deep red
    hexToRgb('#FEE2E2'), // Rose
  ],
  
  // Teal accent
  teal: [
    hexToRgb('#2DD4BF'), // Teal
    hexToRgb('#5EEAD4'), // Light teal
    hexToRgb('#14B8A6'), // Vivid teal
    hexToRgb('#99F6E4'), // Pale teal
    hexToRgb('#0D9488'), // Deep teal
    hexToRgb('#CCFBF1'), // Mint teal
  ],
};

// Detect which accent color is active based on hue
function detectAccentName(triplet: RgbTriplet): string {
  const [h, s] = rgbToHsl(triplet);
  
  // Check saturation - if very low, might be grayscale
  if (s < 10) return 'violet';
  
  // Map hue ranges to accent names
  if (h >= 320 || h < 10) return 'pink';      // Pink/Magenta range
  if (h >= 10 && h < 45) return 'orange';     // Orange range
  if (h >= 45 && h < 70) return 'caramel';    // Yellow/Caramel range
  if (h >= 70 && h < 170) return 'mint';      // Green/Mint range
  if (h >= 170 && h < 200) return 'teal';     // Teal range
  if (h >= 200 && h < 260) return 'sky';      // Blue/Sky range
  if (h >= 260 && h < 290) return 'purple';   // Purple range
  if (h >= 290 && h < 320) return 'violet';   // Violet range
  
  return 'violet';
}

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
    const defaultPalette = ACCENT_PALETTES.violet ?? [];

    const generatePalette = (): string[] => {
      if (!accentPrimaryTriplet) {
        // Fallback to violet palette
        return defaultPalette.map((c, i) => rgbaFromTriplet(c, 0.9 - i * 0.02));
      }

      // Detect which accent is active and use its predefined palette
      const accentName = detectAccentName(accentPrimaryTriplet);
      const palette = ACCENT_PALETTES[accentName] ?? defaultPalette;
      
      return palette.map((color, index) => {
        const alpha = 0.92 - index * 0.02;
        return rgbaFromTriplet(color, alpha);
      });
    };

    const palette = generatePalette();

    // Semantic colors - vibrant and bright
    const successTriplet: RgbTriplet = hexToRgb('#22C55E'); // Bright green
    const warningTriplet: RgbTriplet = hexToRgb('#F59E0B'); // Bright amber
    const infoTriplet: RgbTriplet = hexToRgb('#3B82F6');    // Bright blue
    const errorTriplet: RgbTriplet = hexToRgb('#EF4444');   // Bright red

    // Get accent name for remaining/other colors
    const accentName = accentPrimaryTriplet ? detectAccentName(accentPrimaryTriplet) : 'violet';
    const accentPalette = ACCENT_PALETTES[accentName] ?? defaultPalette;
    const fallbackColor: RgbTriplet = accentPalette[0] ?? [139, 92, 246];

    return {
      palette,
      completed: palette[0] ?? rgbaFromTriplet(fallbackColor, 0.9), // Use accent color for completed items
      other: rgbaFromTriplet(accentPalette[4] ?? fallbackColor, 0.7),
      remaining: rgbaFromTriplet(accentPalette[5] ?? accentPalette[2] ?? fallbackColor, 0.5),
      border: "rgba(170, 175, 190, 0.3)",
      success: rgbaFromTriplet(successTriplet, 0.9),
      warning: rgbaFromTriplet(warningTriplet, 0.9),
      info: rgbaFromTriplet(infoTriplet, 0.9),
      error: rgbaFromTriplet(errorTriplet, 0.9),
      fgPrimary: resolveCssVarToRgba("--fg-primary", 1) ?? "rgba(15, 23, 42, 1)",
      bgOverlay: resolveCssVarToRgba("--bg-overlay", 0.96) ?? "rgba(255, 255, 255, 0.96)",
    };
  }, [tick]);
}