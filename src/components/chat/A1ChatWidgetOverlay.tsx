"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  X,
  Maximize2,
  Sparkles,
  FolderKanban,
  Trash2,
  Check,
  ChevronUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ProjectIntelligenceChat } from "~/components/projects/ProjectIntelligenceChat";
import { AUTO_AGENT } from "~/components/agents/AgentPicker";
import { ComposerMenu } from "~/components/chat/ComposerMenu";
import { api } from "~/trpc/react";

const ALL_PROJECTS = "__all__";

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
  /** Both directions, unlike `onClose`. See the note above. */
  onOpenChange?: (open: boolean) => void;
  /** A message to send as soon as the thread mounts. */
  prefill?: string;
  /**
   * Bumped by the host to remount the thread — the only way a `prefill` that
   * arrives after mount can actually be sent, since it is sent once per mount.
   */
  threadKey?: number;
}) {
  const [selfOpen, setSelfOpen] = useState(false);
  const controlled = props.isOpen !== undefined;
  const open = controlled ? props.isOpen! : selfOpen;
  const setOpen = controlled
    ? (v: boolean) => {
        props.onOpenChange?.(v);
        if (!v) props.onClose?.();
      }
    : setSelfOpen;
  const [minimised, setMinimised] = useState(false);
  const [rect, setRect] = useState<Rect>(defaultRect);

  const router = useRouter();
  const t = useTranslations("aiConsole");
  const tAgents = useTranslations("agents");
  const tChat = useTranslations("chat");

  /*
   * Throwing the thread away.
   *
   * The thread lives in `ProjectIntelligenceChat`, so the button here can only
   * ask: `clearKey` is the request and `canClear` is the answer to "is there
   * anything to throw away". The confirmation is owned here rather than there
   * because it is this bar that has to turn into it.
   */
  const [clearKey, setClearKey] = useState(0);
  const [canClear, setCanClear] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  /*
   * Who answers, and what they can see.
   *
   * The same two decisions the full page offers, made with the same control —
   * a user who pins Task Planner in the widget and then opens the page should
   * not have to learn a second way of doing it.
   */
  const [selectedAgent, setSelectedAgent] = useState<string>(AUTO_AGENT);
  const [scope, setScope] = useState<string>(ALL_PROJECTS);

  const agentsQuery = api.agent.agents.useQuery(undefined, {
    enabled: open,
    staleTime: Infinity,
  });
  const projectsQuery = api.project.getMyProjects.useQuery(undefined, {
    enabled: open,
    staleTime: 60_000,
  });
  const quotaQuery = api.agent.rateLimitStatus.useQuery(undefined, {
    enabled: open,
    refetchInterval: 60_000,
  });

  const agents = agentsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  const pinnedAgentId = selectedAgent === AUTO_AGENT ? undefined : selectedAgent;
  // A project passed in by the host wins: a widget mounted on a project page is
  // already scoped, and offering to un-scope it there would be a trap.
  const scopeProjectId =
    props.projectId ?? (scope === ALL_PROJECTS ? undefined : Number(scope));
  const scopeProject = projects.find((pr) => String(pr.id) === scope) ?? null;

  const agentLabel =
    selectedAgent === AUTO_AGENT
      ? tAgents("auto")
      : (agents.find((a) => a.id === selectedAgent)?.name ?? tAgents("auto"));

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
    if (open) saveRect(rect);
  }, [rect, open]);

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
    [rect],
  );

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      /* don't start drag if clicking a button */
      if ((e.target as HTMLElement).closest("button")) return;
      dragging.current = true;
      origin.current = { mx: e.clientX, my: e.clientY, rect: { ...rect } };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [rect],
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

  /**
   * Maximising leaves the widget and opens the AI page.
   *
   * The full-screen chat used to be this same overlay stretched to the viewport
   * with a three-pane workspace inside it. That is now a real page at
   * `/chat/ai` — with the thread list, the audit trail and a URL you can link
   * to or reload — and maintaining a second, worse copy of it inside a floating
   * panel would guarantee the two drift.
   *
   * The widget closes on the way out. `GlobalAIWidget` already hides it on
   * `/chat/ai`, so leaving it open would only mean it springs back the moment
   * the user navigates anywhere else.
   */
  const goFullScreen = () => {
    setMinimised(false);
    setOpen(false);
    router.push("/chat/ai");
  };

  const toggleMinimise = () => {
    setMinimised((v) => !v);
  };

  /* ─── hidden when closed ─── */
  if (!open) return null;

  /* ─── panel styles ─── */
  const panelStyle: React.CSSProperties = {
    left: rect.x,
    top: rect.y,
    width: rect.w,
    /* Collapsed, the panel is exactly its title bar. */
    height: minimised ? 44 : rect.h,
  };

  return (
    <div
      ref={panelRef}
      data-testid="ai-widget-panel"

      /*
       * `kairos-menu-surface` rather than a hand-rolled border and shadow.
       * The panel used to paint a half-opaque black drop shadow and a 1px
       * border regardless of theme — a dark-mode shadow shown over a white
       * page in light mode. The shared surface carries both, in both themes,
       * and keeps carrying them when either one is retuned.
       */
      className="kairos-menu-surface fixed z-50 flex flex-col overflow-hidden rounded-2xl transition-[height] duration-200 ease-out"
      style={panelStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* ─── title bar ─── */}
      {/*
        The bar carries an identity and three verbs, and nothing else.
        It used to open with a grip and a sparkle: the grip labelled a drag
        handle that is the whole bar anyway, and the sparkle said "AI" directly
        above the words "KAIROS AI". The accent dot does the identity, and the
        agent name has moved to the byline on each answer, where it describes
        the answer instead of the panel.
      */}
      <div
        onPointerDown={handleHeaderPointerDown}
        /* Minimise has no button of its own any more. Double-clicking a title
           bar to roll a window up is the gesture every OS already uses, and it
           bought back the third of the bar the button was occupying. */
        onDoubleClick={toggleMinimise}
        className="flex h-11 shrink-0 cursor-grab items-center gap-2.5 border-b border-border-medium/50 px-3 select-none active:cursor-grabbing"
      >
        <span
          className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent-primary shadow-[0_0_0_3px_rgb(var(--accent-primary)/0.14)]"
          aria-hidden
        />

        {confirmClear ? (
          /* The confirmation happens in the bar rather than in a modal. The
             panel is 352px of quick-ask surface; darkening the entire app
             behind it to ask about it is out of proportion to what is being
             thrown away. */
          <>
            <span className="flex-1 truncate text-[12.5px] font-medium text-fg-primary">
              {tChat("deleteChatTitle")}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                data-testid="widget-clear-confirm"
                onClick={() => {
                  setClearKey((k) => k + 1);
                  setConfirmClear(false);
                }}
                className="kairos-tap flex h-6 w-6 items-center justify-center rounded-md text-red-400 transition-colors hover:bg-red-500/15"
                aria-label={tChat("deleteAndStartOver")}
                title={tChat("deleteAndStartOver")}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="kairos-tap flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                aria-label={tChat("cancel")}
                title={tChat("cancel")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="flex-1 truncate text-[13px] font-semibold text-fg-primary">
              {tChat("title")}
            </span>

            {/* Collapsed, the thread is hidden — which is the one moment the
                pinned agent is worth naming in the chrome, because there is no
                byline on screen to name it. */}
            {minimised && (
              <span className="kairos-stamp hidden shrink-0 truncate text-[9.5px] text-fg-tertiary sm:inline">
                {agentLabel}
              </span>
            )}

            <span className="flex shrink-0 items-center gap-1">
              {/* Painted only when it would do something. A permanently
                  disabled destructive control is chrome that never earns its
                  place, and the thread is empty for the whole first visit. */}
              {canClear && !minimised && (
                <button
                  type="button"
                  data-testid="widget-clear"
                  onClick={() => setConfirmClear(true)}
                  className="kairos-tap flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-red-500/15 hover:text-red-400"
                  aria-label={tChat("newChatTooltip")}
                  title={tChat("newChatTooltip")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}

              {minimised && (
                <button
                  type="button"
                  onClick={toggleMinimise}
                  className="kairos-tap flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                  aria-label="Expand"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={goFullScreen}
                className="kairos-tap flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-accent-primary/15 hover:text-accent-primary"
                aria-label="Open full screen"
                title="Open full screen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setMinimised(false);
                }}
                className="kairos-tap flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-red-500/15 hover:text-red-400"
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </>
        )}
      </div>

      {/* ─── body ─── */}
      {/*
        The widget is the quick-ask surface and nothing else. Everything that
        needs room — the agent picker, the tool inspector, the memory editor,
        the audit trail — lives on `/chat/ai`, which the maximise button opens.
      */}
      {!minimised && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ProjectIntelligenceChat
            key={props.threadKey}
            variant="widget"
            hideHeader
            clearKey={clearKey}
            onCanClearChange={setCanClear}
            prefill={props.prefill}
            projectId={scopeProjectId}
            pinnedAgentId={pinnedAgentId}
            composerControls={
              <>
                <ComposerMenu
                  tone="accent"
                  title={tAgents("chooseAgent")}
                  label={agentLabel}
                  icon={<Sparkles className="h-3 w-3 shrink-0" />}
                  selected={selectedAgent}
                  onSelect={setSelectedAgent}
                  options={[
                    {
                      id: AUTO_AGENT,
                      label: tAgents("auto"),
                      description: tAgents("autoDescription"),
                    },
                    ...agents
                      .filter((a) => a.kind === "conversational")
                      .map((a) => ({
                        id: a.id,
                        label: a.name,
                        description: a.description,
                      })),
                    ...agents
                      .filter((a) => a.kind === "scheduled")
                      .map((a) => ({
                        id: a.id,
                        label: a.name,
                        description: a.description,
                        disabled: true,
                      })),
                  ]}
                />

                {/* A widget mounted against a project is already scoped by its
                    host, so the picker would be offering a choice it cannot
                    honour. */}
                {props.projectId === undefined && (
                  <ComposerMenu
                    title={t("scopeTitle")}
                    label={scopeProject?.title ?? t("allProjects")}
                    icon={<FolderKanban className="h-3 w-3 shrink-0" />}
                    selected={scope}
                    onSelect={setScope}
                    options={[
                      {
                        id: ALL_PROJECTS,
                        label: t("allProjects"),
                        description: t("allProjectsHint"),
                      },
                      ...projects.map((pr) => ({
                        id: String(pr.id),
                        label: pr.title,
                      })),
                    ]}
                  />
                )}
              </>
            }
            emptyStateFooter={
              <div className="kairos-stamp flex items-center justify-between gap-3 text-[9.5px] text-fg-tertiary">
                <span>
                  {quotaQuery.data
                    ? t("requestsToday", {
                        used: quotaQuery.data.limit - quotaQuery.data.remaining,
                        limit: quotaQuery.data.limit,
                      })
                    : "\u2014"}
                </span>
                <Link
                  href="/chat/ai"
                  onClick={() => setOpen(false)}
                  className="text-accent-primary transition-opacity hover:opacity-80"
                >
                  {t("openFullPage")}
                </Link>
              </div>
            }
          />
        </div>
      )}

      {/* The resize grip used to be drawn here. Nothing is painted now: the
          8px hit-areas on every edge do the resizing, they already announce
          themselves by swapping the cursor, and a glyph in one corner
          advertised the least of the eight ways to do it. */}
    </div>
  );
}