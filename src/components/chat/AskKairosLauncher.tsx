"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

interface Props {
  onOpen: (prefill?: string) => void;
  /** Hide below `lg`, where a bottom corner lands on a page's own composer. */
  hideBelowLg?: boolean;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNER_STORAGE_KEY = "kairos:launcher-corner";

const CORNER_CLASSES: Record<Corner, string> = {
  /* Clear of the bars on small screens, not `bottom-4`/`top-4`: the mobile
     bottom nav is fixed at `bottom-0`, and at the old offset the pill sat on
     top of it and covered whichever item was in that corner. The nav also now
     outranks this at z-50, so a regression here is visible rather than
     silently winning. The offsets read the bars' own heights plus the
     safe-area inset — a flat `bottom-24` left 2px above the nav on a phone
     with a home indicator, and `top-4` put a top-corner pill under the top
     bar entirely. */
  "bottom-right":
    "right-4 bottom-[calc(var(--kairos-bottomnav-h)+var(--kairos-safe-bottom)+1rem)] flex-col items-end lg:right-6 lg:bottom-6",
  "bottom-left":
    "left-4 bottom-[calc(var(--kairos-bottomnav-h)+var(--kairos-safe-bottom)+1rem)] flex-col items-start lg:left-6 lg:bottom-6",
  "top-right":
    "top-[calc(var(--kairos-topbar-h)+var(--kairos-safe-top)+1rem)] right-4 flex-col-reverse items-end lg:top-6 lg:right-6",
  "top-left":
    "top-[calc(var(--kairos-topbar-h)+var(--kairos-safe-top)+1rem)] left-4 flex-col-reverse items-start lg:top-6 lg:left-6",
};

/* The flattened corner of the nudge bubble points at the pill, so it moves
 * with it: below the bubble in the bottom corners, above it in the top ones. */
const NUDGE_TAIL_CLASSES: Record<Corner, string> = {
  "bottom-right": "rounded-br-sm",
  "bottom-left": "rounded-bl-sm",
  "top-right": "rounded-tr-sm",
  "top-left": "rounded-tl-sm",
};

function isCorner(value: string | null): value is Corner {
  return value !== null && value in CORNER_CLASSES;
}

/**
 * The closed state of the assistant: a pill, and sometimes a nudge above it.
 *
 * The nudge is the whole reason the launcher is more than a button. Risk Radar
 * already finds things — tasks that went overdue, reviews that have sat open —
 * and until now the only way to hear about them was to go and ask. Surfacing
 * the top open finding here turns the assistant from something you remember to
 * consult into something that tells you when it has something to say.
 *
 * It is deliberately one finding, not a feed. A stack of them beside every
 * page is a notification centre, which is a different product and one the user
 * did not ask for; a single line that can be dismissed is a nudge.
 *
 * Dismissing hides the bubble for this page view only — it does not resolve the
 * finding, because the finding is about the workspace and closing a bubble has
 * not changed the workspace. The Risk Radar panel is where a finding is
 * actually dismissed.
 *
 * The pill can also be dragged: releasing it snaps to whichever screen corner
 * is nearest, and the choice persists across pages. Free placement is
 * deliberately not offered — corners are the only positions guaranteed not to
 * sit on top of page content, and snapping means there is no state where the
 * pill half-overlaps something and has to be nudged pixel by pixel.
 */
export function AskKairosLauncher({ onOpen, hideBelowLg = false }: Props) {
  const t = useTranslations("aiConsole");
  const [nudgeHidden, setNudgeHidden] = useState(false);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  /* A drag ends with the same pointerup that fires the button's click, so the
   * click handler needs to know it is the tail end of a drag and not a tap. */
  const didDrag = useRef(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /* Where the pill was when it was let go. The snap itself is a class swap,
   * which would teleport it; the layout effect below plays it back as a glide
   * from here to wherever the new corner put it. */
  const snapFrom = useRef<DOMRect | null>(null);

  useLayoutEffect(() => {
    const from = snapFrom.current;
    const pill = pillRef.current;
    const el = containerRef.current;
    if (!from || dragPos || !pill || !el) return;
    snapFrom.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = pill.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    /* Translating the container by the pill's delta puts the pill back under
     * the pointer for the first frame; the slight overshoot reads as it
     * settling into the corner rather than sliding on a rail. */
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      { duration: 420, easing: "cubic-bezier(0.22, 1.2, 0.36, 1)" },
    );
  }, [corner, dragPos]);

  // localStorage is read after mount rather than in the initializer so the
  // server and first client render agree on the default corner.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CORNER_STORAGE_KEY);
      if (isCorner(stored)) setCorner(stored);
    } catch {
      // Storage being unavailable just means the pill starts bottom-right.
    }
  }, []);

  const findingsQuery = api.agent.findings.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const nudge = nudgeHidden ? null : (findingsQuery.data?.[0] ?? null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") && !target.closest("[data-drag-handle]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    didDrag.current = false;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    // A few pixels of slop keeps an ordinary tap from registering as a drag.
    if (
      !didDrag.current &&
      Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y) < 6
    ) {
      return;
    }
    /* Capture only once a real drag has started. Capturing on pointerdown
     * retargets the pointerup to this container, so the pill's click never
     * fires and a plain tap stops opening the assistant. */
    if (!didDrag.current) e.currentTarget.setPointerCapture(e.pointerId);
    didDrag.current = true;
    setDragPos({ x: e.clientX, y: e.clientY });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = null;
    if (!didDrag.current) return;
    const next: Corner = `${e.clientY < window.innerHeight / 2 ? "top" : "bottom"}-${
      e.clientX < window.innerWidth / 2 ? "left" : "right"
    }`;
    snapFrom.current = pillRef.current?.getBoundingClientRect() ?? null;
    setCorner(next);
    setDragPos(null);
    try {
      localStorage.setItem(CORNER_STORAGE_KEY, next);
    } catch {
      // The pill still moves for this page view; it just will not stick.
    }
  };

  const onPointerCancel = () => {
    dragStart.current = null;
    didDrag.current = false;
    setDragPos(null);
  };

  return (
    <div
      ref={containerRef}
      className={`chat-refined fixed z-40 flex gap-2.5 ${CORNER_CLASSES[corner]} ${hideBelowLg ? "max-lg:hidden" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={
        dragPos
          ? {
              left: dragPos.x,
              top: dragPos.y,
              right: "auto",
              bottom: "auto",
              transform: "translate(-50%, -50%)",
            }
          : undefined
      }
    >
      {nudge && !dragPos && (
        <div
          className={`kairos-console-rail flex max-w-[240px] items-start gap-2 rounded-md border border-border-medium/70 bg-bg-secondary px-3 py-2.5 shadow-lg ${NUDGE_TAIL_CLASSES[corner]}`}
        >
          <button
            type="button"
            // The nudge is a shortcut, not just a notice: opening the assistant
            // with the finding already in the box is the whole point of having
            // said it here rather than in a log.
            onClick={() => onOpen(nudge.suggestedFix?.prompt)}
            className="min-w-0 flex-1 text-left text-[12.5px] leading-snug text-fg-secondary transition-colors hover:text-fg-primary"
          >
            {nudge.title}
          </button>
          <button
            type="button"
            onClick={() => setNudgeHidden(true)}
            aria-label={t("dismissNudge")}
            className="kairos-tap -mt-0.5 -mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-fg-tertiary transition-colors hover:text-fg-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <button
        ref={pillRef}
        type="button"
        data-testid="ask-kairos"
        data-drag-handle
        onClick={() => {
          if (didDrag.current) {
            didDrag.current = false;
            return;
          }
          onOpen();
        }}
        /*
         * The closed state of the panel, and shaped like it.
         *
         * It used to be a solid accent slab with a sparkle in it — a different
         * object from the panel it opens, in a colour the app otherwise
         * reserves for the assistant's own voice. Same surface, same accent
         * dot, so opening it reads as the pill growing rather than as one
         * control being swapped for another.
         */
        className={`kairos-menu-surface flex touch-none items-center gap-2.5 rounded-md px-4 py-2.5 text-[13.5px] font-semibold text-fg-primary transition-[background-color,transform,box-shadow] duration-200 select-none hover:bg-bg-tertiary motion-reduce:transition-none ${
          dragPos ? "scale-[1.04] cursor-grabbing shadow-xl" : ""
        }`}
      >
        <span
          className="h-[7px] w-[7px] rounded-full bg-accent-primary shadow-[0_0_0_3px_rgb(var(--accent-primary)/0.14)]"
          aria-hidden
        />
        {t("askKairos")}
      </button>
    </div>
  );
}
