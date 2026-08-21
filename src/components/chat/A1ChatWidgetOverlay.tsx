"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, X, Maximize2, Minimize2, GripVertical, Sparkles } from "lucide-react";
import { ProjectIntelligenceChat } from "~/components/projects/ProjectIntelligenceChat";
import { AgentWorkspace } from "~/components/agents/AgentWorkspace";

/* ────────────── types ────────────── */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STORAGE_KEY = "kairos-chat-widget-rect";
const MIN_W = 340;
const MIN_H = 380;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function loadRect(): Rect | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Rect;
  } catch {
    return null;
  }
}

function saveRect(r: Rect) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  } catch {
    /* noop */
  }
}

function defaultRect(): Rect {
  if (typeof window === "undefined") return { x: 0, y: 0, w: 420, h: 560 };
  const w = Math.min(420, window.innerWidth - 32);
  const h = Math.min(560, window.innerHeight - 32);
  return {
    x: window.innerWidth - w - 16,
    y: window.innerHeight - h - 16,
    w,
    h,
  };
}

/* ────────────── resize edge helpers ────────────── */
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null;

function edgeCursor(e: Edge): string {
  switch (e) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    default:
      return "default";
  }
}

function detectEdge(el: HTMLElement, cx: number, cy: number, margin = 8): Edge {
  const r = el.getBoundingClientRect();
  const top = cy - r.top < margin;
  const bottom = r.bottom - cy < margin;
  const left = cx - r.left < margin;
  const right = r.right - cx < margin;

  if (top && left) return "nw";
  if (top && right) return "ne";
  if (bottom && left) return "sw";
  if (bottom && right) return "se";
  if (top) return "n";
  if (bottom) return "s";
  if (left) return "w";
  if (right) return "e";
  return null;
}

/* ────────────── component ────────────── */
export function A1ChatWidgetOverlay(props: {
  projectId?: number;
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const [selfOpen, setSelfOpen] = useState(false);
  const controlled = props.isOpen !== undefined;
  const open = controlled ? props.isOpen! : selfOpen;
  const setOpen = controlled
    ? (v: boolean) => { if (!v && props.onClose) props.onClose(); }
    : setSelfOpen;
  const [minimised, setMinimised] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [rect, setRect] = useState<Rect>(defaultRect);
  const [prevRect, setPrevRect] = useState<Rect | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const resizing = useRef<Edge>(null);
  const origin = useRef({ mx: 0, my: 0, rect: rect });

  /* restore persisted position once */
  useEffect(() => {
    const saved = loadRect();
    if (saved) setRect(saved);
  }, []);

  /* persist on change */
  useEffect(() => {
    if (open && !maximised) saveRect(rect);
  }, [rect, open, maximised]);

  /* constrain on window resize */
  useEffect(() => {
    const handler = () => {
      setRect((r) => ({
        ...r,
        x: clamp(r.x, 0, window.innerWidth - r.w),
        y: clamp(r.y, 0, window.innerHeight - r.h),
        w: Math.min(r.w, window.innerWidth),
        h: Math.min(r.h, window.innerHeight),
      }));
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  /* listen for external open signal (e.g. from SideNav) */
  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setMinimised(false);
    };
    window.addEventListener("kairos:openAI", handler);
    return () => window.removeEventListener("kairos:openAI", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── drag / resize pointer handlers ─── */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (maximised) return;
      const el = panelRef.current;
      if (!el) return;
      // Never intercept clicks on interactive elements
      if ((e.target as HTMLElement).closest("button, input, textarea, a, select")) return;

      const edge = detectEdge(el, e.clientX, e.clientY);
      if (edge) {
        resizing.current = edge;
        origin.current = { mx: e.clientX, my: e.clientY, rect: { ...rect } };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    },
    [rect, maximised],
  );

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (maximised) return;
      /* don't start drag if clicking a button */
      if ((e.target as HTMLElement).closest("button")) return;
      dragging.current = true;
      origin.current = { mx: e.clientX, my: e.clientY, rect: { ...rect } };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [rect, maximised],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const el = panelRef.current;
      if (!el) return;

      /* cursor feedback for resize edges */
      if (!dragging.current && !resizing.current) {
        const edge = detectEdge(el, e.clientX, e.clientY);
        el.style.cursor = edge ? edgeCursor(edge) : "default";
      }

      const dx = e.clientX - origin.current.mx;
      const dy = e.clientY - origin.current.my;
      const o = origin.current.rect;

      if (dragging.current) {
        setRect({
          ...o,
          x: clamp(o.x + dx, 0, window.innerWidth - o.w),
          y: clamp(o.y + dy, 0, window.innerHeight - o.h),
        });
        return;
      }

      if (resizing.current) {
        let { x, y, w, h } = o;
        const edge = resizing.current;

        if (edge.includes("e")) w = clamp(o.w + dx, MIN_W, window.innerWidth - o.x);
        if (edge.includes("w")) {
          const newW = clamp(o.w - dx, MIN_W, o.x + o.w);
          x = o.x + (o.w - newW);
          w = newW;
        }
        if (edge.includes("s")) h = clamp(o.h + dy, MIN_H, window.innerHeight - o.y);
        if (edge.includes("n")) {
          const newH = clamp(o.h - dy, MIN_H, o.y + o.h);
          y = o.y + (o.h - newH);
          h = newH;
        }

        setRect({ x, y, w, h });
      }
    },
    [],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
    resizing.current = null;
  }, []);

  /* ─── maximise / minimise helpers ─── */
  const toggleMaximise = () => {
    if (maximised) {
      if (prevRect) setRect(prevRect);
      setMaximised(false);
    } else {
      setPrevRect(rect);
      setMaximised(true);
    }
    setMinimised(false);
  };

  const toggleMinimise = () => {
    setMinimised((v) => !v);
  };

  /* ─── hidden when closed ─── */
  if (!open) return null;

  /* ─── panel styles ─── */
  const panelStyle: React.CSSProperties = maximised
    ? { inset: 0, width: "100vw", height: "100vh" }
    : {
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: minimised ? 48 : rect.h,
      };

  return (
    <div
      ref={panelRef}
      className="fixed z-50 flex flex-col overflow-hidden rounded-2xl shadow-2xl transition-[height] duration-200 ease-out"
      style={{
        ...panelStyle,
        backgroundColor: 'rgb(var(--bg-primary))',
        border: '1px solid rgb(var(--border-medium))'
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* ─── title bar ─── */}
      <div
        onPointerDown={handleHeaderPointerDown}
        className="flex h-12 shrink-0 cursor-grab items-center gap-2 border-b px-3 select-none active:cursor-grabbing"
        style={{
          backgroundColor: 'rgb(var(--bg-secondary))',
          borderBottomColor: 'rgb(var(--border-medium))',
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid'
        }}
      >
        <GripVertical className="h-4 w-4" style={{ color: 'rgb(var(--fg-tertiary))', opacity: 0.7 }} />
        <Sparkles className="h-4 w-4" style={{ color: 'rgb(var(--fg-secondary))' }} />
        <span className="flex-1 text-sm font-medium truncate" style={{ color: 'rgb(var(--fg-primary))' }}>KAIROS AI</span>

        <button
          type="button"
          onClick={toggleMinimise}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
          style={{ 
            color: 'rgb(var(--fg-tertiary))',
            backgroundColor: 'transparent'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          aria-label={minimised ? "Expand" : "Minimise"}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={toggleMaximise}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
          style={{ 
            color: 'rgb(var(--fg-tertiary))',
            backgroundColor: 'transparent'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          aria-label={maximised ? "Restore" : "Maximise"}
        >
          {maximised ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMaximised(false);
            setMinimised(false);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
          style={{ 
            color: 'rgb(var(--fg-tertiary))',
            backgroundColor: 'transparent'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ─── body ─── */}
      {/*
        Maximising is not just a bigger chat: it is where the agent picker, the
        tool inspector and the memory editor live. At the floating size there is
        no room for three panes, and the quick-ask surface people already use
        should not change shape because a feature was added elsewhere.
      */}
      {!minimised && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {maximised ? (
            <AgentWorkspace projectId={props.projectId} />
          ) : (
            <ProjectIntelligenceChat projectId={props.projectId} />
          )}
        </div>
      )}

      {/* ─── resize indicator (bottom-right corner, visual only) ─── */}
      {!maximised && !minimised && (
        <div className="pointer-events-none absolute bottom-1 right-1.5" style={{ color: 'rgb(var(--fg-tertiary))', opacity: 0.3 }}>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M11 1v10H1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M11 5v6H5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}