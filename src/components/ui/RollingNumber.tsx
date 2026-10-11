"use client";

import { useState } from "react";

/** Leading number in a stat string ("42%", "7", "—"), or null when there is none. */
function numeric(value: string): number | null {
  const match = /-?\d+(?:\.\d+)?/.exec(value);
  return match ? Number(match[0]) : null;
}

/**
 * A stat value that rolls like an odometer when it changes.
 *
 * Only the characters that differ move: going from 42% to 43% rolls the "2"
 * and leaves the "4" and "%" still, which reads as a count ticking over rather
 * than the whole figure being swapped. A rise rolls up, a fall rolls down.
 * Nothing animates on first render — the page's own entrance covers that.
 */
export function RollingNumber({ value }: { value: string }) {
  const [roll, setRoll] = useState({
    current: value,
    previous: value,
    up: true,
    version: 0,
  });

  // Derived during render rather than in an effect, so the frame that shows
  // the new value is already the first frame of its animation.
  if (roll.current !== value) {
    const from = numeric(roll.current);
    const to = numeric(value);
    setRoll({
      current: value,
      previous: roll.current,
      up: from === null || to === null ? true : to >= from,
      version: roll.version + 1,
    });
  }

  const next = roll.current;
  if (roll.version === 0) return <>{next}</>;

  // Right-aligned so units line up with units when the length changes (9 → 10).
  const width = Math.max(next.length, roll.previous.length);
  const nextChars = next.padStart(width, " ");
  const prevChars = roll.previous.padStart(width, " ");
  const dir = roll.up ? "up" : "down";

  return (
    <span className="relative inline-flex" aria-label={next}>
      {Array.from(nextChars).map((char, index) => {
        if (char === " ") return null;
        const old = prevChars[index];
        if (old === char) {
          return (
            <span key={index} aria-hidden>
              {char}
            </span>
          );
        }
        // The rightmost digit moves first, the way an odometer carries.
        const delay = `${(width - 1 - index) * 45}ms`;
        return (
          <span
            key={`${index}-${roll.version}`}
            className="roll-cell"
            aria-hidden
          >
            {old && old !== " " && (
              <span
                className={`roll-out-${dir}`}
                style={{ animationDelay: delay }}
              >
                {old}
              </span>
            )}
            <span
              className={`roll-in-${dir}`}
              style={{ animationDelay: delay }}
            >
              {char}
            </span>
          </span>
        );
      })}
    </span>
  );
}
