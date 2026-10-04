"use client";

import { useEffect, useRef, useState } from "react";

/** The skeleton stays invisible this long (`.k-skel`'s `k-skel-in` delay). */
const HOLD_OFF_MS = 300;
/** Once it has been seen, it stays at least this long. */
const MIN_VISIBLE_MS = 400;

/**
 * Rule 5 of the skeletons: don't flash.
 *
 * The first 300ms are handled in CSS — a skeleton renders, but transparent.
 * This handles the other end: if data lands after the skeleton became visible,
 * keep it up until it has been on screen for 400ms, so a 320ms load doesn't
 * blink a patch of hatch for 20ms. Loads that finish inside the hold-off swap
 * straight to content.
 *
 *   const showSkeleton = useSkeletonHold(query.isLoading);
 */
export function useSkeletonHold(loading: boolean): boolean {
  const [holding, setHolding] = useState(false);
  const visibleAt = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      visibleAt.current ??= performance.now() + HOLD_OFF_MS;
      return;
    }
    const since = visibleAt.current;
    visibleAt.current = null;
    if (since === null) return;
    const now = performance.now();
    // Never became visible — or already shown long enough.
    if (now < since || now - since >= MIN_VISIBLE_MS) return;

    setHolding(true);
    const timer = setTimeout(() => setHolding(false), since + MIN_VISIBLE_MS - now);
    return () => clearTimeout(timer);
  }, [loading]);

  return loading || holding;
}
