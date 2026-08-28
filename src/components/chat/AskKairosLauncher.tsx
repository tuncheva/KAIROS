"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

interface Props {
  onOpen: (prefill?: string) => void;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNER_STORAGE_KEY = "kairos:launcher-corner";

const CORNER_CLASSES: Record<Corner, string> = {
  "bottom-right": "right-4 bottom-4 flex-col items-end lg:right-6 lg:bottom-6",
  "bottom-left": "left-4 bottom-4 flex-col items-start lg:left-6 lg:bottom-6",
  "top-right": "top-4 right-4 flex-col-reverse items-end lg:top-6 lg:right-6",
  "top-left": "top-4 left-4 flex-col-reverse items-start lg:top-6 lg:left-6",
};

/* The flattened corner of the nudge bubble points at the pill, so it moves
 * with it: below the bubble in the bottom corners, above it in the top ones. */
const NUDGE_TAIL_CLASSES: Record<Corner, string> = {
  "bottom-right": "rounded-br-[3px]",
  "bottom-left": "rounded-bl-[3px]",
  "top-right": "rounded-tr-[3px]",
  "top-left": "rounded-tl-[3px]",
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
export function AskKairosLauncher({ onOpen }: Props) {
  const t = useTranslations("aiConsole");
  const [nudgeHidden, setNudgeHidden] = useState(false);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  /* A drag ends with the same pointerup that fires the button's click, so the
   * click handler needs to know it is the tail end of a drag and not a tap. */
  const didDrag = useRef(false);

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
    e.currentTarget.setPointerCapture(e.pointerId);
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
    didDrag.current = true;
    setDragPos({ x: e.clientX, y: e.clientY });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = null;
    if (!didDrag.current) return;
    const next: Corner = `${e.clientY < window.innerHeight / 2 ? "top" : "bottom"}-${
      e.clientX < window.innerWidth / 2 ? "left" : "right"
    }`;
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
      className={`fixed z-40 flex gap-2.5 ${CORNER_CLASSES[corner]}`}
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
          className={`kairos-console-rail flex max-w-[240px] items-start gap-2 rounded-[11px] border border-border-medium/70 bg-bg-secondary px-3 py-2.5 shadow-lg ${NUDGE_TAIL_CLASSES[corner]}`}
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
            className="-mt-0.5 -mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-tertiary transition-colors hover:text-fg-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <button
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
        className="flex touch-none items-center gap-2.5 rounded-xl bg-accent-primary px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-lg transition-[filter] select-none hover:brightness-110"
      >
        <Sparkles className="h-4 w-4" />
        {t("askKairos")}
      </button>
    </div>
  );
}
