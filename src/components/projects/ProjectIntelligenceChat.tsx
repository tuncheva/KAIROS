"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useAgentStream,
  type AgentTurnPayload,
} from "~/hooks/useAgentStream";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

import { PlanDiffCard } from "./PlanDiffCard";
import { UndoApplyButton } from "./UndoApplyButton";
import { Sparkles, Copy, Check, CheckCircle2, Calendar, FileText, MapPin, Trash2, Pencil, ArrowUp, ArrowUpRight } from "lucide-react";
import { useDateFormat } from "~/hooks/useDateFormat";
import { humanizeToolName, type TrailEvent } from "~/components/chat/trail";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface InlineTask {
  title: string;
  priority?: string;
}

interface EventPreviewItem {
  kind: "create" | "update" | "delete";
  title?: string;
  description?: string;
  eventDate?: string;
  region?: string;
  eventId?: number;
  reason?: string;
}

interface NotePreviewItem {
  kind: "create" | "update" | "delete";
  content?: string;
  noteId?: number;
  reason?: string;
}

type ChatMsg =
  | {
      role: "user";
      text: string;
      createdAt: Date;
    }
  | {
      role: "agent";
      text: string;
      createdAt: Date;
      msgId?: string; // unique ID for tracking edits
      /**
       * Which specialist produced this answer, when A1 handed off.
       *
       * Read off the turn payload rather than off the picker: the picker holds
       * what the *next* message will be sent to, so using it for the byline
       * would relabel every answer above the moment the user changed agent.
       */
      agentId?: string;
      actions?: Array<
        | { type: "notes_confirm"; draftId: string }
        | { type: "notes_apply"; draftId: string; confirmationToken: string }
        | { type: "notes_direct_apply"; draftId: string } // Combined confirm+apply
        | { type: "events_confirm"; draftId: string }
        | { type: "events_apply"; draftId: string; confirmationToken: string }
        | { type: "events_direct_apply"; draftId: string } // Combined confirm+apply
        | { type: "task_confirm"; draftId: string }
        | { type: "task_undo"; draftId: string }
        | { type: "task_apply"; draftId: string; confirmationToken: string }
        | { type: "task_direct_apply"; draftId: string } // Combined confirm+apply
      >;
      inlineTasks?: InlineTask[];
      eventPreviews?: EventPreviewItem[];
      notePreviews?: NotePreviewItem[];
    };

interface NotesDraftResponse {
  draftId?: string;
  plan?: {
    summary?: string;
    operations?: unknown[];
    blocked?: unknown[];
  };
}

interface EventsDraftResponse {
  draftId?: string;
  plan?: {
    summary?: string;
    creates?: unknown[];
    updates?: unknown[];
    deletes?: unknown[];
    comments?: { add?: unknown[]; remove?: unknown[] };
    rsvps?: unknown[];
    likes?: unknown[];
    questionsForUser?: string[];
  };
}

interface TaskPlannerDraftResponse {
  draftId?: string;
  plan?: {
    creates?: unknown[];
    updates?: unknown[];
    statusChanges?: unknown[];
    deletes?: unknown[];
    risks?: string[];
    questionsForUser?: string[];
    diffPreview?: {
      creates?: string[];
      updates?: string[];
      statusChanges?: string[];
      deletes?: string[];
    };
    orderingRationale?: string;
  };
}

interface TaskPlannerConfirmResponse {
  confirmationToken: string;
  summary?: {
    creates: number;
    updates: number;
    statusChanges: number;
    deletes: number;
  };
}

interface TaskPlannerApplyResponse {
  applied?: boolean;
  results?: {
    createdTaskIds?: number[];
    updatedTaskIds?: number[];
    statusChangedTaskIds?: number[];
    deletedTaskIds?: number[];
  };
}

interface ConfirmResponse {
  confirmationToken: string;
  summary?: unknown;
  status?: string;
}

interface ApplyResponse {
  results?: unknown;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const THINKING_SENTINEL = "__THINKING__";
const SUBAGENT_SENTINEL = "__SUBAGENT__";

/**
 * Renders one line as a bullet.
 *
 * Strips any glyph the text already carries before adding ours. Agent turns are
 * persisted as raw JSON, so rows written while the prompt (or the hand-built
 * fallback) still emitted a leading "•" are in the database for good — without
 * this, every one of them renders as "• • ...".
 */
function asBullet(line: string): string {
  return `• ${line.replace(/^\s*[•\-*]\s*/, "")}`;
}

function clampText(s: string, max = 20_000): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/** Replace the LAST thinking/sub-agent sentinel in messages with a real message. */
function replaceThinking(
  prev: ChatMsg[],
  msg: Omit<ChatMsg & { role: "agent" }, "role">,
): ChatMsg[] {
  const next = [...prev];
  for (let i = next.length - 1; i >= 0; i--) {
    const m = next[i];
    if (
      m?.role === "agent" &&
      (m.text === THINKING_SENTINEL || m.text === SUBAGENT_SENTINEL)
    ) {
      next[i] = { role: "agent", ...msg };
      return next;
    }
  }
  return [...next, { role: "agent", ...msg }];
}

/* ------------------------------------------------------------------ */
/*  Thinking Dots                                                     */
/* ------------------------------------------------------------------ */

function ThinkingDots() {
  return (
    <div className="kairos-thinking-dots" data-testid="thinking-indicator">
      <span />
      <span />
      <span />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-Agent Working Indicator                                       */
/* ------------------------------------------------------------------ */

function SubAgentWorking({ label }: { label: string }) {
  return (
    <div className="kairos-subagent-working" data-testid="subagent-indicator">
      <span className="kairos-subagent-label">{label}</span>
      <div className="kairos-subagent-track">
        <span />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Task Card                                                  */
/* ------------------------------------------------------------------ */

function InlineTaskCard({ task, index }: { task: InlineTask; index: number }) {
  return (
    <div
      className="kairos-inline-task"
      style={{ animationDelay: `${index * 60}ms` }}
      data-testid="inline-task"
    >
      <span className="kairos-task-check">
        <CheckCircle2 size={11} />
      </span>
      <span className="flex-1 truncate">{task.title}</span>
      {task.priority && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
          style={{
            backgroundColor: "rgb(var(--accent-primary) / 0.1)",
            color: "rgb(var(--accent-primary))",
          }}
        >
          {task.priority}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Copy Button                                                       */
/* ------------------------------------------------------------------ */

function CopyButton({ text, tooltip }: { text: string; tooltip: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // silently fail
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="kairos-tap opacity-50 hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-white/10 text-fg-tertiary hover:text-fg-secondary shrink-0"
      title={tooltip}
    >
      {copied ? (
        <Check size={13} className="text-success" />
      ) : (
        <Copy size={13} />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Event Preview Card (Editable)                                     */
/* ------------------------------------------------------------------ */

function EventPreviewCard({ 
  item, 
  index,
  onFieldChange,
}: { 
  item: EventPreviewItem; 
  index: number;
  onFieldChange?: (field: "title" | "description", value: string) => void;
}) {
  const { formatDate: formatDatePref } = useDateFormat();
  const icon = item.kind === "create" ? Calendar : item.kind === "update" ? Pencil : Trash2;
  const Icon = icon;
  const label = item.kind === "create" ? "New Event" : item.kind === "update" ? "Update Event" : "Delete Event";
  const accent =
    item.kind === "create"
      ? "rgb(var(--accent-primary))"
      : item.kind === "update"
        ? "rgb(234 179 8)"
        : "rgb(239 68 68)";

  let dateStr = "";
  if (item.eventDate) {
    try {
      dateStr = formatDatePref(new Date(item.eventDate), "long");
    } catch { /* invalid date */ }
  }

  const isEditable = item.kind !== "delete" && onFieldChange;

  return (
    <div
      className="kairos-preview-card"
      style={{ animationDelay: `${index * 60}ms`, borderLeftColor: accent }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={12} style={{ color: accent }} />
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: accent }}>
          {label}
        </span>
        {isEditable && (
          <span className="text-[10px] text-fg-quaternary ml-auto">(click to edit)</span>
        )}
      </div>
      {item.title && (
        isEditable ? (
          <input
            type="text"
            className="w-full text-sm font-semibold text-fg-primary bg-bg-secondary/50 border border-border-medium rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent-primary"
            defaultValue={item.title}
            onChange={(e) => onFieldChange("title", e.target.value)}
            placeholder="Event title..."
          />
        ) : (
          <p className="text-sm font-semibold text-fg-primary leading-snug">{item.title}</p>
        )
      )}
      {item.description && (
        isEditable ? (
          <textarea
            className="w-full text-xs text-fg-secondary bg-bg-secondary/50 border border-border-medium rounded-md p-2 mt-1 resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary min-h-[40px]"
            defaultValue={item.description}
            onChange={(e) => onFieldChange("description", e.target.value)}
            placeholder="Event description..."
          />
        ) : (
          <p className="text-xs text-fg-secondary mt-0.5 line-clamp-2">{item.description}</p>
        )
      )}
      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        {dateStr && (
          <span className="text-[10px] text-fg-tertiary flex items-center gap-1">
            <Calendar size={10} /> {dateStr}
          </span>
        )}
        {item.region && (
          <span className="text-[10px] text-fg-tertiary flex items-center gap-1">
            <MapPin size={10} /> {item.region.replace("_", " ")}
          </span>
        )}
      </div>
      {item.reason && (
        <p className="text-[10px] text-fg-quaternary mt-1 italic">{item.reason}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Note Preview Card (Editable)                                      */
/* ------------------------------------------------------------------ */

function NotePreviewCard({ 
  item, 
  index,
  onContentChange,
}: { 
  item: NotePreviewItem; 
  index: number;
  onContentChange?: (newContent: string) => void;
}) {
  const icon = item.kind === "create" ? FileText : item.kind === "update" ? Pencil : Trash2;
  const Icon = icon;
  const label = item.kind === "create" ? "New Note" : item.kind === "update" ? "Update Note" : "Delete Note";
  const accent =
    item.kind === "create"
      ? "rgb(var(--accent-primary))"
      : item.kind === "update"
        ? "rgb(234 179 8)"
        : "rgb(239 68 68)";

  const isEditable = item.kind !== "delete" && onContentChange;

  return (
    <div
      className="kairos-preview-card"
      style={{ animationDelay: `${index * 60}ms`, borderLeftColor: accent }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={12} style={{ color: accent }} />
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: accent }}>
          {label}
        </span>
        {item.noteId && (
          <span className="text-[10px] text-fg-quaternary">#{item.noteId}</span>
        )}
        {isEditable && (
          <span className="text-[10px] text-fg-quaternary ml-auto">(click to edit)</span>
        )}
      </div>
      {item.content && (
        isEditable ? (
          <textarea
            className="w-full text-xs text-fg-secondary bg-bg-secondary/50 border border-border-medium rounded-md p-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary min-h-[60px]"
            defaultValue={item.content}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder="Edit note content..."
          />
        ) : (
          <p className="text-xs text-fg-secondary line-clamp-3 whitespace-pre-wrap">{item.content.slice(0, 200)}{item.content.length > 200 ? "…" : ""}</p>
        )
      )}
      {item.reason && (
        <p className="text-[10px] text-fg-quaternary mt-1 italic">{item.reason}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function ProjectIntelligenceChat(props: {
  projectId?: number;
  onAgentMessage?: () => void;
  /**
   * D-1/D-2 — a message to send as soon as the chat mounts.
   *
   * Set by the command palette and by the "fix this" buttons on risk findings,
   * so acting on a nudge costs one click rather than retyping the problem back
   * to the assistant that just reported it. Sent once: re-firing it on every
   * render would loop the turn.
   */
  prefill?: string;
  /**
   * A sub-agent pinned in the workspace picker.
   *
   * Undefined is Auto — A1 routes and hands off, which is what every caller
   * outside the expanded workspace passes and what this chat has always done.
   */
  pinnedAgentId?: string;
  /** Tools the last turn called, so the workspace can render an audit trail. */
  onToolsUsed?: (names: string[]) => void;
  /**
   * Offer "delete this chat and start over" in the header.
   *
   * Opt-in. The expanded workspace is where a thread gets long enough to be
   * worth throwing away; a destructive control should not appear on the compact
   * quick-ask widget just because it was added elsewhere.
   */
  showNewChat?: boolean;
  /**
   * How the thread is dressed.
   *
   * `compact` is the rounded-bubble chat this component has always rendered and
   * is still the default, so the project panels that embed it are untouched.
   *
   * `widget` and `console` are the two designed surfaces — the floating
   * assistant and the full AI page. They share a shape: answers run full-width
   * rather than in a bubble, and the composer is a panel that carries the agent
   * and scope pickers instead of a bare pill. They differ only in density, and
   * in the console additionally naming the specialist that answered.
   *
   * Only the presentation differs. The turn itself is identical in all three.
   */
  variant?: "compact" | "widget" | "console";
  /** The page draws its own header; the built-in one would be a second one. */
  hideHeader?: boolean;
  /**
   * Which stored thread to show.
   *
   * `undefined` keeps the original behaviour: rehydrate whichever conversation
   * was the caller's most recent one for this scope. `null` is an explicitly
   * empty thread — the user pressed "new conversation", and the previous thread
   * must not be poured back into it. A string loads that specific thread.
   */
  conversationId?: string | null;
  /** Fires when a turn creates or continues a thread, with its id. */
  onConversationChange?: (id: string) => void;
  /** The turn's audit trail, rebuilt from the stream as frames arrive. */
  onTrail?: (events: TrailEvent[]) => void;
  /** True while a turn is in flight. */
  onBusyChange?: (busy: boolean) => void;
  /** Pickers rendered in the panel composer's control row. */
  composerControls?: ReactNode;
  /**
   * Rendered at the foot of the empty state — the widget's quota line and its
   * "open full page" link. Supplied by the host because only the host knows
   * where "full page" is from where it is mounted.
   */
  emptyStateFooter?: ReactNode;
}) {
  const { projectId, pinnedAgentId } = props;
  const isConsole = props.variant === "console";
  /** The two designed surfaces. See `variant`. */
  const isPanel = isConsole || props.variant === "widget";
  const t = useTranslations("chat");
  // The console chrome has its own vocabulary — trail nodes, scope chips — and
  // keeping it out of the `chat` namespace stops the widget's message catalogue
  // from growing keys it never renders.
  const tc = useTranslations("aiConsole");
  const utils = api.useUtils();

  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [rateLimitPopup, setRateLimitPopup] = useState<{ show: boolean; message: string }>({ show: false, message: "" });
  
  // Track edits to draft previews (keyed by msgId + index)
  const [noteEdits, setNoteEdits] = useState<Record<string, Record<number, string>>>({});
  const [eventEdits, setEventEdits] = useState<Record<string, Record<number, { title?: string; description?: string }>>>({});

  // Starting over deletes the stored thread, which nothing can undo — so it asks
  // first, and reports a failed delete instead of pretending the chat is gone.
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const [newChatError, setNewChatError] = useState<string | null>(null);

  // Generate unique message IDs
  const generateMsgId = useCallback(() => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, []);

  /* ---- Rate limit status query ---- */
  const rateLimitQuery = api.agent.rateLimitStatus.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  /**
   * The agent roster, for the console byline.
   *
   * Static content the page has already fetched, so this resolves from cache;
   * it is enabled only in the console because the widget never renders a
   * byline and should not pay for the round trip.
   */
  const rosterQuery = api.agent.agents.useQuery(undefined, {
    enabled: isConsole,
    staleTime: Infinity,
  });

  const suggestedQuestions = [
    t("suggestedQ1"),
    t("suggestedQ2"),
    t("suggestedQ3"),
    t("suggestedQ4"),
  ];

  /* ---------- Agent turn ---------- */

  /**
   * One user message is one server round trip.
   *
   * This component used to be the orchestrator: it pattern-matched the message
   * for "note"/"event" substrings and called a write agent directly, answered
   * greetings from a local array, and chained a second mutation whenever A1
   * returned a handoff. All of that now happens server-side in `runAgentTurn`,
   * where A1 — which handles every language and actually reads the workspace —
   * makes the routing decision.
   */

  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const conversationIdRef = useRef<string | undefined>(undefined);
  /** Tool names this turn has called, in order. Reset when a turn starts. */
  const toolsThisTurn = useRef<string[]>([]);

  /**
   * The session's audit trail.
   *
   * Kept in a ref and pushed out through `onTrail` rather than held in state:
   * the trail is rendered by the page's right rail, and re-rendering the whole
   * transcript on every tool frame in order to move a panel next door is waste.
   *
   * It accumulates for as long as the thread is open. The trail used to be
   * wiped on every send, which meant the panel could only ever answer "what did
   * the last message do" — and a user auditing an answer is usually looking at
   * a claim made several messages back. Each event records its turn, so the
   * panel can still separate them.
   *
   * `turnStartedAt` is re-stamped on send, so every node's elapsed time is
   * measured from the moment *its own* request left the browser. That includes
   * network time, which is why the panel labels it as time-since-start rather
   * than as a server-side duration it cannot actually observe.
   */
  const trailRef = useRef<TrailEvent[]>([]);
  const turnStartedAt = useRef(0);
  /** 1-based; incremented on send, so trail nodes can be grouped by turn. */
  const turnIndex = useRef(0);
  /** The message that opened the current turn, used as the group heading. */
  const turnPrompt = useRef<string | undefined>(undefined);

  const pushTrail = useCallback(
    (
      event: Omit<
        TrailEvent,
        "id" | "elapsedMs" | "at" | "turnIndex" | "turnPrompt"
      >,
    ) => {
      const now = Date.now();
      trailRef.current = [
        ...trailRef.current,
        {
          ...event,
          id: `${String(turnIndex.current)}-${String(trailRef.current.length)}-${event.kind}`,
          turnIndex: turnIndex.current,
          turnPrompt: turnPrompt.current,
          elapsedMs: now - turnStartedAt.current,
          at: new Date(now),
        },
      ];
      props.onTrail?.(trailRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * One line of trail for the widget.
   *
   * The floating panel has no room for the full timeline the page renders, but
   * "3 lookups · 5.4s" and the name of the last one is enough to tell a user
   * that the answer came from their workspace rather than from thin air — and
   * it is the same data, not a second, looser claim about it.
   */
  const [trailSummary, setTrailSummary] = useState<{
    lastLabel: string;
    lookups: number;
    latencyMs: number;
  } | null>(null);

  const resetTrail = useCallback(() => {
    trailRef.current = [];
    turnIndex.current = 0;
    turnPrompt.current = undefined;
    setTrailSummary(null);
    props.onTrail?.([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /** Render a sub-agent's plan into chat text, previews and action buttons. */
  const buildPlanMessage = useCallback(
    (payload: AgentTurnPayload): Omit<ChatMsg & { role: "agent" }, "role"> => {
      const summary = payload.a1.answer?.summary;
      const msgId = generateMsgId();
      const plan = payload.plan;

      if (!plan) {
        const text = [
          summary,
          // E-1: a clarifying question is an answer, not a failure — render the
          // question and the options it offered rather than "no response".
          payload.a1.clarify?.question,
          ...(payload.a1.clarify?.options ?? []).map((o) => asBullet(o)),
          ...(payload.a1.answer?.details ?? []).map((d) => asBullet(d)),
          // E-2: a turn can now fail more than one handoff, so this is a list.
          ...(payload.handoffErrors ?? []),
        ]
          .filter(Boolean)
          .join("\n");
        return { text: text || t("noResponse"), createdAt: new Date(), msgId };
      }

      if (plan.kind === "tasks") {
        const p = plan.plan as TaskPlannerDraftResponse["plan"];
        const questions = p?.questionsForUser ?? [];
        if (questions.length > 0) {
          return {
            text: `${t("needMoreInfo")}\n${questions.map((q) => asBullet(q)).join("\n")}`,
            createdAt: new Date(),
            msgId,
          };
        }

        const creates = p?.creates?.length ?? 0;
        const updates = p?.updates?.length ?? 0;
        const statusChanges = p?.statusChanges?.length ?? 0;
        const deletes = p?.deletes?.length ?? 0;
        const total = creates + updates + statusChanges + deletes;

        if (total === 0) {
          return { text: t("noChanges"), createdAt: new Date(), msgId };
        }

        const diffLines: string[] = [];
        for (const c of p?.diffPreview?.creates ?? []) diffLines.push(`+ ${c}`);
        for (const u of p?.diffPreview?.updates ?? []) diffLines.push(`~ ${u}`);
        for (const c of p?.diffPreview?.statusChanges ?? []) diffLines.push(`→ ${c}`);
        for (const d of p?.diffPreview?.deletes ?? []) diffLines.push(`- ${d}`);

        const ops = [
          creates > 0 ? t("createOps", { count: creates }) : null,
          updates > 0 ? t("updateOps", { count: updates }) : null,
          statusChanges > 0
            ? `${statusChanges} status change${statusChanges > 1 ? "s" : ""}`
            : null,
          deletes > 0 ? t("deleteOps", { count: deletes }) : null,
        ]
          .filter(Boolean)
          .join(" · ");

        const inlineTasks: InlineTask[] = (
          (p?.creates ?? []) as Array<{ title?: string; priority?: string }>
        )
          .filter((c) => typeof c?.title === "string")
          .map((c) => ({ title: c.title!, priority: c.priority }));

        return {
          text: [ops, diffLines.join("\n"), t("clickConfirm")]
            .filter(Boolean)
            .join("\n"),
          createdAt: new Date(),
          msgId,
          actions: [{ type: "task_confirm" as const, draftId: plan.draftId }],
          inlineTasks: inlineTasks.length > 0 ? inlineTasks : undefined,
        };
      }

      if (plan.kind === "notes") {
        const p = plan.plan as NotesDraftResponse["plan"];
        const operations = Array.isArray(p?.operations) ? p.operations : [];
        const blocked = Array.isArray(p?.blocked) ? p.blocked : [];

        const counts = (type: string) =>
          operations.filter(
            (o) => (o as Record<string, unknown>)?.type === type,
          ).length;
        const creates = counts("create");
        const updates = counts("update");
        const deletes = counts("delete");

        const headline =
          creates > 0
            ? t("noteCreate")
            : updates > 0
              ? t("noteUpdate")
              : deletes > 0
                ? t("noteDelete")
                : t("noNoteChanges");

        const ops = [
          creates > 0 ? t("createOps", { count: creates }) : null,
          updates > 0 ? t("updateOps", { count: updates }) : null,
          deletes > 0 ? t("deleteOps", { count: deletes }) : null,
          blocked.length > 0 ? t("blockedOps", { count: blocked.length }) : null,
        ]
          .filter(Boolean)
          .join(" · ");

        const notePreviews: NotePreviewItem[] = operations.map((o) => {
          const op = o as Record<string, unknown>;
          return {
            kind: (op.type as "create" | "update" | "delete") ?? "create",
            content:
              (op.content as string) ?? (op.nextContent as string) ?? undefined,
            noteId: (op.noteId as number) ?? undefined,
            reason: (op.reason as string) ?? undefined,
          };
        });

        return {
          text: [headline, ops, operations.length > 0 ? t("editThenApply") : ""]
            .filter(Boolean)
            .join("\n"),
          createdAt: new Date(),
          msgId,
          actions:
            operations.length > 0
              ? [{ type: "notes_direct_apply" as const, draftId: plan.draftId }]
              : undefined,
          notePreviews: notePreviews.length > 0 ? notePreviews : undefined,
        };
      }

      const p = plan.plan as EventsDraftResponse["plan"];
      const questions = Array.isArray(p?.questionsForUser)
        ? p.questionsForUser
        : [];
      if (questions.length > 0) {
        return {
          text: `${t("needMoreInfo")}\n${questions.map((q) => asBullet(q)).join("\n")}`,
          createdAt: new Date(),
          msgId,
        };
      }

      const creates = Array.isArray(p?.creates) ? p.creates.length : 0;
      const updates = Array.isArray(p?.updates) ? p.updates.length : 0;
      const deletes = Array.isArray(p?.deletes) ? p.deletes.length : 0;
      const hasOps = creates + updates + deletes > 0;

      const ops = [
        creates > 0 ? t("createOps", { count: creates }) : null,
        updates > 0 ? t("updateOps", { count: updates }) : null,
        deletes > 0 ? t("deleteOps", { count: deletes }) : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const eventPreviews: EventPreviewItem[] = [
        ...(Array.isArray(p?.creates)
          ? (p.creates as Array<Record<string, unknown>>).map((c) => ({
              kind: "create" as const,
              title: c.title as string | undefined,
              description: c.description as string | undefined,
              eventDate: c.eventDate as string | undefined,
              region: c.region as string | undefined,
            }))
          : []),
        ...(Array.isArray(p?.updates)
          ? (p.updates as Array<Record<string, unknown>>).map((u) => ({
              kind: "update" as const,
              eventId: u.eventId as number | undefined,
              title: (u.patch as Record<string, unknown> | undefined)?.title as
                | string
                | undefined,
              description: (u.patch as Record<string, unknown> | undefined)
                ?.description as string | undefined,
              eventDate: (u.patch as Record<string, unknown> | undefined)
                ?.eventDate as string | undefined,
              reason: u.reason as string | undefined,
            }))
          : []),
        ...(Array.isArray(p?.deletes)
          ? (p.deletes as Array<Record<string, unknown>>).map((d) => ({
              kind: "delete" as const,
              eventId: d.eventId as number | undefined,
              reason: d.reason as string | undefined,
            }))
          : []),
      ];

      return {
        text: [
          p?.summary ?? summary ?? "",
          ops || t("noChanges"),
          hasOps ? t("editThenApply") : "",
        ]
          .filter(Boolean)
          .join("\n"),
        createdAt: new Date(),
        msgId,
        actions: hasOps
          ? [{ type: "events_direct_apply" as const, draftId: plan.draftId }]
          : undefined,
        eventPreviews: eventPreviews.length > 0 ? eventPreviews : undefined,
      };
    },
    [generateMsgId, t],
  );

  const { send: sendTurn, cancel: cancelTurn } = useAgentStream({
    onToolCall: (name) => {
      setProgressLabel(t("lookingUp", { tool: name }));
      // The stream already reports every lookup; it was only ever used for a
      // transient label that the next frame overwrote. Keeping the list turns
      // the same frames into a record of what the answer was actually based on.
      toolsThisTurn.current = [...toolsThisTurn.current, name];
      props.onToolsUsed?.(toolsThisTurn.current);
      pushTrail({ kind: "tool", label: humanizeToolName(name), code: name });
    },
    onSubAgent: (agent) => {
      setProgressLabel(t("subAgentWorking", { agent }));
      pushTrail({ kind: "handoff", label: tc("trailHandoff"), code: agent });
      // Swap the dots for the sub-agent bar: a handoff has actually happened.
      setMessages((prev) =>
        replaceThinking(prev, {
          text: SUBAGENT_SENTINEL,
          createdAt: new Date(),
        }),
      );
    },
    onResult: (payload) => {
      conversationIdRef.current = payload.conversationId;
      setProgressLabel(null);

      // A draft is the only thing in a turn that can still change the
      // workspace, so it gets its own node rather than being folded into
      // "answered" — the trail is where a user checks what is pending.
      for (const plan of payload.plans ?? []) {
        pushTrail({
          kind: "draft",
          label: tc("trailDraft"),
          detail: tc("trailDraftDetail", { kind: plan.kind }),
          code: plan.draftId,
        });
      }
      pushTrail({
        kind: "done",
        label: tc("trailAnswered"),
        detail: tc("trailLatency", { ms: payload.latencyMs }),
      });

      // Per-turn, unlike the trail itself: the widget chip is a claim about
      // the answer just rendered, not about the session.
      const lookups = trailRef.current.filter(
        (e) => e.kind === "tool" && e.turnIndex === turnIndex.current,
      );
      setTrailSummary({
        lastLabel: lookups[lookups.length - 1]?.label ?? tc("trailStarted"),
        lookups: lookups.length,
        latencyMs: payload.latencyMs,
      });

      props.onConversationChange?.(payload.conversationId);
      props.onBusyChange?.(false);
      setMessages((prev) =>
        replaceThinking(prev, {
          ...buildPlanMessage(payload),
          agentId:
            payload.a1.handoff?.targetAgent ??
            payload.a1.handoffs?.[0]?.targetAgent,
        }),
      );
      if (payload.plan?.kind === "tasks") void utils.task.invalidate();
    },
    onError: (message, isRateLimit) => {
      setProgressLabel(null);
      pushTrail({ kind: "error", label: tc("trailFailed"), detail: message });
      props.onBusyChange?.(false);
      if (isRateLimit) {
        setRateLimitPopup({ show: true, message });
        void rateLimitQuery.refetch();
        setMessages((prev) =>
          replaceThinking(prev, {
            text: t("dailyLimitReached"),
            createdAt: new Date(),
          }),
        );
        return;
      }
      setMessages((prev) =>
        replaceThinking(prev, {
          text: t("somethingWentWrong", { error: message }),
          createdAt: new Date(),
        }),
      );
    },
  });

  /* ---------- Notes & Events mutations ---------- */

  const notesConfirmMutation = api.agent.notesVaultConfirm.useMutation();
  const notesApplyMutation = api.agent.notesVaultApply.useMutation();

  const eventsConfirmMutation = api.agent.eventsPublisherConfirm.useMutation();
  const eventsApplyMutation = api.agent.eventsPublisherApply.useMutation();

  /* ---------- Task Planner mutations ---------- */

  const taskConfirmMutation = api.agent.taskPlannerConfirm.useMutation();
  const taskApplyMutation = api.agent.taskPlannerApply.useMutation();

  /* ---------- Rehydration ---------- */

  /**
   * Restore the last conversation on mount.
   *
   * The transcript used to live only in component state, so a reload lost it and
   * the assistant lost every reference a follow-up depended on. Assistant turns
   * are stored as the JSON A1 produced, which is why they are re-rendered from
   * `summary`/`details` here rather than read back as display text.
   *
   * Action buttons are deliberately not restored: their drafts may have been
   * applied or expired since, and a button that fails on click is worse than no
   * button. The user can ask again.
   */
  /**
   * `undefined` means "whichever thread was most recent", which is what every
   * caller outside the AI page passes and what this component has always done.
   * The page passes an explicit id — or `null` for a deliberately empty thread —
   * so exactly one of the two queries below is ever enabled.
   */
  const pinnedConversationId = props.conversationId;
  const wantsLatest = pinnedConversationId === undefined;

  const latestQuery = api.agent.latestConversation.useQuery(
    { projectId },
    { enabled: wantsLatest, refetchOnWindowFocus: false, staleTime: Infinity },
  );

  const pinnedQuery = api.agent.conversation.useQuery(
    { conversationId: pinnedConversationId ?? "" },
    {
      enabled: typeof pinnedConversationId === "string",
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
  );

  const historyData = wantsLatest
    ? latestQuery.data
    : typeof pinnedConversationId === "string" && pinnedQuery.data
      ? { conversationId: pinnedConversationId, messages: pinnedQuery.data }
      : undefined;

  const hydratedRef = useRef(false);

  /**
   * A pinned thread's id is known before its messages have loaded. Seeding it
   * here means a message sent during that window continues the thread the user
   * is looking at, rather than quietly forking a second one beside it.
   */
  useEffect(() => {
    if (typeof pinnedConversationId === "string") {
      conversationIdRef.current = pinnedConversationId;
    } else if (pinnedConversationId === null) {
      conversationIdRef.current = undefined;
    }
  }, [pinnedConversationId]);

  useEffect(() => {
    if (hydratedRef.current) return;
    const data = historyData;
    if (!data?.conversationId || data.messages.length === 0) return;

    hydratedRef.current = true;
    conversationIdRef.current = data.conversationId;
    // A restored thread is as much "the conversation you are in" as one you
    // just started, so the page can name it in the header and highlight it in
    // the rail without waiting for the next turn to tell it which one this is.
    props.onConversationChange?.(data.conversationId);

    setMessages(
      data.messages.map((m): ChatMsg => {
        if (m.role === "user") {
          return { role: "user", text: m.content, createdAt: m.createdAt };
        }

        let text = m.content;
        try {
          const parsed = JSON.parse(m.content) as {
            answer?: { summary?: string; details?: string[] };
          };
          if (parsed.answer?.summary) {
            text = [
              parsed.answer.summary,
              ...(parsed.answer.details ?? []).map((d) => asBullet(d)),
            ].join("\n");
          }
        } catch {
          // Older rows, or a turn stored as plain text: show it as-is.
        }

        return { role: "agent", text, createdAt: m.createdAt };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyData, projectId]);

  /* ---------- Start over ---------- */

  const deleteConversationMutation = api.agent.deleteConversation.useMutation();

  /**
   * Throw the thread away — on the server as well as on screen.
   *
   * Clearing local state alone would not be starting over: the conversation id
   * would still ride along with the next message, so the model would keep
   * replaying a history the user believes they deleted. The row goes first and
   * the screen is cleared only once it is gone, because a chat that looks empty
   * while its history still feeds the next answer is the worst of both.
   *
   * `hydratedRef` is latched shut on the way out. Rehydration restores *the most
   * recent* conversation, so the invalidate below would otherwise pour the
   * previous thread straight into the empty one.
   */
  const startNewChat = useCallback(async () => {
    const doomed = conversationIdRef.current;
    setNewChatError(null);

    if (doomed) {
      try {
        await deleteConversationMutation.mutateAsync({ conversationId: doomed });
      } catch (err) {
        setNewChatError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    // A turn still in flight would call onResult against the thread that no
    // longer exists and re-seed conversationIdRef with its id.
    cancelTurn();
    hydratedRef.current = true;
    conversationIdRef.current = undefined;

    setMessages([]);
    setDraft("");
    setProgressLabel(null);
    setNoteEdits({});
    setEventEdits({});
    toolsThisTurn.current = [];
    props.onToolsUsed?.([]);
    resetTrail();
    setConfirmNewChat(false);

    if (doomed) {
      void utils.agent.latestConversation.invalidate();
      void utils.agent.conversations.invalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelTurn, deleteConversationMutation, resetTrail, utils]);

  /* ---------- Scrolling ---------- */

  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    // Collapse first: without it the box can grow but never shrink back when
    // the draft is cleared or edited down.
    el.style.height = "auto";
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [draft]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /* ---------- Send handler ---------- */

  const prefillSent = useRef(false);

  const handleSend = useCallback(
    (text: string) => {
      const msg = text.trim();
      if (!msg) return;

      setDraft("");
      setMessages((prev) => [
        ...prev,
        { role: "user", text: msg, createdAt: new Date() },
        { role: "agent", text: THINKING_SENTINEL, createdAt: new Date() },
      ]);
      setProgressLabel(null);

      // A new turn starts a new audit trail; otherwise the chip under the answer
      // would accumulate every lookup of the whole session.
      toolsThisTurn.current = [];
      props.onToolsUsed?.([]);

      // The trail is *not* cleared here: it spans the thread, and a new turn
      // opens a new group inside it rather than replacing it.
      turnIndex.current += 1;
      turnPrompt.current = msg;
      turnStartedAt.current = Date.now();
      setTrailSummary(null);
      props.onBusyChange?.(true);
      pushTrail({
        kind: "start",
        label: tc("trailStarted"),
        detail: pinnedAgentId ? undefined : tc("trailAutoRouting"),
        code: pinnedAgentId,
      });

      void sendTurn({
        message: clampText(msg),
        projectId,
        conversationId: conversationIdRef.current,
        agentId: pinnedAgentId,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, pinnedAgentId, pushTrail, sendTurn, tc],
  );

  /**
   * D-1/D-2 — send the prefilled message once, on mount.
   *
   * Guarded by a ref rather than by a dependency array: `handleSend` is
   * recreated on most renders, and depending on it would re-send the message
   * every time the conversation state changed.
   */
  useEffect(() => {
    if (!props.prefill || prefillSent.current) return;
    prefillSent.current = true;
    handleSend(props.prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.prefill]);

  const isThinking =
    messages.length > 0 &&
    (messages[messages.length - 1]?.text === THINKING_SENTINEL ||
     messages[messages.length - 1]?.text === SUBAGENT_SENTINEL);

  /* fire callback when AI finishes responding (thinking → done) */
  const wasThinkingRef = useRef(false);
  useEffect(() => {
    if (wasThinkingRef.current && !isThinking && messages.length > 0) {
      props.onAgentMessage?.();
    }
    wasThinkingRef.current = isThinking;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThinking]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{ backgroundColor: "rgb(var(--bg-primary))" }}
    >
      {/* ---- Rate Limit Popup ---- */}
      {rateLimitPopup.show && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="w-[90vw] max-w-md rounded-2xl p-6 shadow-2xl border"
            style={{
              backgroundColor: "rgb(var(--bg-primary))",
              borderColor: "rgb(var(--border-medium))",
            }}
          >
            <div className="flex flex-col items-center text-center gap-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "rgb(var(--accent-primary) / 0.12)" }}
              >
                <Sparkles size={28} style={{ color: "rgb(var(--accent-primary))" }} />
              </div>
              <h3 className="text-lg font-bold text-fg-primary">
                You&apos;ve reached your limit for messages to KAIROS
              </h3>
              <p className="text-sm text-fg-secondary leading-relaxed">
                You can send up to {rateLimitQuery.data?.limit ?? 50} AI messages per day.
                {rateLimitQuery.data?.resetsAt && (
                  <> Your limit resets at{" "}
                    <span className="font-semibold text-fg-primary">
                      {new Date(rateLimitQuery.data.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>.
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => setRateLimitPopup({ show: false, message: "" })}
                className="mt-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
                style={{ backgroundColor: "rgb(var(--accent-primary))" }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Delete chat & start over confirmation ---- */}
      {confirmNewChat && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kairos-new-chat-title"
        >
          <div
            className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl"
            style={{
              backgroundColor: "rgb(var(--bg-primary))",
              borderColor: "rgb(var(--border-medium))",
            }}
          >
            <h3
              id="kairos-new-chat-title"
              className="mb-2 text-lg font-bold text-fg-primary"
            >
              {t("deleteChatTitle")}
            </h3>
            <p className="text-sm text-fg-secondary">
              {t("deleteChatConfirmMessage")}
            </p>
            {newChatError && (
              <p className="mt-3 text-xs text-red-400" role="alert">
                {t("deleteChatFailed", { error: newChatError })}
              </p>
            )}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmNewChat(false);
                  setNewChatError(null);
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-surface"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                data-testid="new-chat-confirm"
                onClick={() => void startNewChat()}
                disabled={deleteConversationMutation.isPending}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {deleteConversationMutation.isPending
                  ? t("deleting")
                  : t("deleteAndStartOver")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Header ---- */}
      {!props.hideHeader && (
      <div
        className="px-4 py-3 flex items-center justify-between gap-3 border-b"
        style={{
          backgroundColor: "rgb(var(--bg-primary))",
          borderBottomColor: "rgb(var(--border-medium))",
          borderBottomWidth: "1px",
          borderBottomStyle: "solid",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
            style={{
              backgroundColor: "rgb(var(--accent-primary) / 0.15)",
            }}
          >
            <Sparkles
              size={13}
              style={{ color: "rgb(var(--accent-primary))" }}
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-fg-primary truncate">
              {t("title")}
            </p>
            <p className="text-[10px] text-fg-tertiary truncate">
              {messages.length > 0 &&
               messages[messages.length - 1]?.text === SUBAGENT_SENTINEL
                ? t("taskPlannerWorking")
                : isThinking
                  ? t("thinking")
                  : t("subtitle")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {props.showNewChat && (
            <button
              type="button"
              data-testid="new-chat"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: "rgb(var(--bg-secondary))" }}
              // Nothing on screen means nothing to start over from — and the
              // stored thread, if any, is already empty.
              disabled={messages.length === 0}
              title={t("newChatTooltip")}
              aria-label={t("newChatTooltip")}
              onClick={() => {
                setNewChatError(null);
                setConfirmNewChat(true);
              }}
            >
              <Trash2 size={12} />
              <span className="hidden sm:inline">{t("newChat")}</span>
            </button>
          )}

          <button
            type="button"
            className="text-xs px-2.5 py-1.5 rounded-lg text-fg-secondary transition-colors hover:text-fg-primary"
            style={{ backgroundColor: "rgb(var(--bg-secondary))" }}
            onClick={() => setShowAssumptions((v) => !v)}
          >
            {showAssumptions ? t("hide") : t("info")}
          </button>
        </div>
      </div>
      )}

      {showAssumptions && (
        <div
          className="px-4 py-3 border-b"
          style={{
            backgroundColor: "rgb(var(--bg-secondary))",
            borderBottomColor: "rgb(var(--border-medium))",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
          }}
        >
          <div className="w-full space-y-1">
            <p className="text-xs text-fg-tertiary leading-relaxed">
              {t("infoDesc")}
            </p>
            <p className="text-xs text-fg-tertiary">{t("infoCaps")}</p>
          </div>
        </div>
      )}

      {/* ---- Messages ---- */}
      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-y-auto ${
          isConsole ? "px-6 py-7 lg:px-10" : isPanel ? "px-4 py-5" : "px-4 py-6"
        }`}
        style={{ backgroundColor: "rgb(var(--bg-primary))" }}
      >
        <div
          className={
            isConsole
              ? "flex w-full flex-col gap-7"
              : isPanel
                ? "flex w-full flex-col gap-4"
                : "w-full space-y-4"
          }
        >
          {messages.length === 0 && isPanel ? (
            /*
             * A menu, not a greeting.
             *
             * The old empty state was an icon, two lines of copy and four
             * pill-shaped chips. The chips were the only useful thing on it and
             * were also the hardest to read — a suggestion is a sentence, and a
             * sentence set in an 11px pill wraps badly and reads as decoration.
             * Full-width rows give each one the line it needs and make it
             * obvious they are pressable.
             */
            <div className="flex h-full flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-[17px] font-semibold tracking-[-0.015em] text-fg-primary">
                  {t("emptyTitle")}
                </p>
                <p className="text-[13px] leading-relaxed text-fg-tertiary">
                  {tc("emptyDescription")}
                </p>
              </div>

              <div className="flex flex-col overflow-hidden rounded-[10px] border border-border-medium/70">
                {suggestedQuestions.map((q, qi) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleSend(q)}
                    className={`flex items-center justify-between gap-2.5 bg-bg-secondary px-3.5 py-3 text-left text-[13px] text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary ${
                      qi > 0 ? "border-t border-border-medium/50" : ""
                    }`}
                  >
                    {q}
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" />
                  </button>
                ))}
              </div>

              {props.emptyStateFooter && (
                <div className="mt-auto">{props.emptyStateFooter}</div>
              )}
            </div>
          ) : messages.length === 0 ? (
            <div className="py-8 text-center space-y-5">
              <div
                className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mx-auto"
                style={{
                  backgroundColor: "rgb(var(--accent-primary) / 0.1)",
                }}
              >
                <Sparkles
                  size={22}
                  style={{ color: "rgb(var(--accent-primary))" }}
                />
              </div>
              <div>
                <p className="text-sm text-fg-secondary font-medium mb-1">
                  {t("emptyTitle")}
                </p>
                <p className="text-xs text-fg-tertiary">
                  {t("emptySubtitle")}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleSend(q)}
                    className="text-[11px] px-3 py-1.5 rounded-full border transition-all hover:scale-[1.03]"
                    style={{
                      borderColor:
                        "rgb(var(--accent-primary) / 0.2)",
                      color: "rgb(var(--accent-primary))",
                      backgroundColor:
                        "rgb(var(--accent-primary) / 0.06)",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isThinkingMsg =
                m.role === "agent" && m.text === THINKING_SENTINEL;
              const isSubAgentMsg =
                m.role === "agent" && m.text === SUBAGENT_SENTINEL;
              const hasInlineTasks =
                m.role === "agent" &&
                Array.isArray((m as { inlineTasks?: InlineTask[] }).inlineTasks) &&
                ((m as { inlineTasks?: InlineTask[] }).inlineTasks?.length ?? 0) > 0;
              const hasEventPreviews =
                m.role === "agent" &&
                Array.isArray((m as { eventPreviews?: EventPreviewItem[] }).eventPreviews) &&
                ((m as { eventPreviews?: EventPreviewItem[] }).eventPreviews?.length ?? 0) > 0;
              const hasNotePreviews =
                m.role === "agent" &&
                Array.isArray((m as { notePreviews?: NotePreviewItem[] }).notePreviews) &&
                ((m as { notePreviews?: NotePreviewItem[] }).notePreviews?.length ?? 0) > 0;

              return (
                <div
                  key={`${m.createdAt.toISOString()}-${idx}`}
                  className={`kairos-msg-enter ${m.role === "user" ? "flex justify-end" : "flex justify-start"}`}
                >
                  <div
                    className={
                      isPanel
                        ? m.role === "user"
                          ? // The console's user turn is a quiet raised card
                            // rather than an accent slab: on a full page the
                            // accent belongs to the assistant's identity and to
                            // the controls that change the workspace, not to
                            // every line the user has ever typed.
                            "group max-w-[520px] rounded-xl rounded-br-sm border border-border-medium/60 bg-bg-tertiary px-4 py-3 text-fg-primary"
                          : "group w-full max-w-[720px] text-fg-primary"
                        : m.role === "user"
                          ? "group max-w-[85%] rounded-2xl rounded-br-md text-white px-4 py-2.5 shadow-sm"
                          : "group max-w-[85%] rounded-2xl rounded-bl-md text-fg-primary px-4 py-2.5 shadow-sm"
                    }
                    style={
                      isPanel
                        ? undefined
                        : {
                            backgroundColor:
                              m.role === "user"
                                ? "rgb(var(--accent-primary))"
                                : "rgb(var(--bg-secondary))",
                          }
                    }
                  >
                    {/* Console byline: who is answering, and how they got here.
                        An answer that cannot be attributed cannot be checked. */}
                    {isConsole && m.role === "agent" && (
                      <div className="mb-3 flex flex-wrap items-center gap-2.5">
                        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-accent-primary/15 text-accent-primary">
                          <Sparkles size={13} />
                        </span>
                        <span className="text-[13px] font-semibold text-fg-primary">
                          {rosterQuery.data?.find(
                            (a) => a.id === (m as { agentId?: string }).agentId,
                          )?.name ?? t("title")}
                        </span>
                        <span className="kairos-stamp text-[10px] text-fg-tertiary">
                          {(m as { agentId?: string }).agentId
                            ? tc("bylineRouted")
                            : pinnedAgentId
                              ? tc("bylinePinned")
                              : tc("bylineAuto")}
                        </span>
                      </div>
                    )}

                    {/* Message content */}
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        {isThinkingMsg ? (
                          <div className="kairos-chat-response text-sm leading-relaxed py-1">
                            <span className="sr-only">
                              {progressLabel ?? t("thinking")}
                            </span>
                            {progressLabel ? (
                              <SubAgentWorking label={progressLabel} />
                            ) : (
                              <ThinkingDots />
                            )}
                          </div>
                        ) : isSubAgentMsg ? (
                          <div className="kairos-chat-response text-sm leading-relaxed py-1">
                            <span className="sr-only">
                              {t("taskPlannerWorking")}
                            </span>
                            <SubAgentWorking
                              label={progressLabel ?? t("taskPlannerWorking")}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="w-full text-left"
                            title={t("copyTooltip")}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  m.text,
                                );
                              } catch {
                                // silently fail
                              }
                            }}
                          >
                            <div
                              className={
                                m.role === "agent"
                                  ? "kairos-chat-response text-sm leading-relaxed"
                                  : "whitespace-pre-wrap text-sm leading-relaxed"
                              }
                            >
                              {m.text}
                            </div>
                          </button>
                        )}
                      </div>

                      {/* Copy icon for agent messages */}
                      {!isThinkingMsg && !isSubAgentMsg && m.role === "agent" && (
                        <CopyButton
                          text={m.text}
                          tooltip={t("copyTooltip")}
                        />
                      )}
                    </div>

                    {/* Inline tasks (shown after task planner creates tasks) */}
                    {hasInlineTasks && (
                      <div className="kairos-inline-tasks" data-testid="inline-tasks">
                        {(
                          (m as { inlineTasks?: InlineTask[] })
                            .inlineTasks ?? []
                        ).map((task, tIdx) => (
                          <InlineTaskCard
                            key={`task-${tIdx}`}
                            task={task}
                            index={tIdx}
                          />
                        ))}
                      </div>
                    )}

                    {/* Event previews (shown before user confirms) */}
                    {hasEventPreviews && (
                      <div className="kairos-preview-list" data-testid="event-previews">
                        {(
                          (m as { eventPreviews?: EventPreviewItem[]; msgId?: string })
                            .eventPreviews ?? []
                        ).map((ev, eIdx) => {
                          const msgId = (m as { msgId?: string }).msgId ?? "";
                          const edits = eventEdits[msgId]?.[eIdx];
                          const editedItem = edits ? { ...ev, title: edits.title ?? ev.title, description: edits.description ?? ev.description } : ev;
                          return (
                            <EventPreviewCard
                              key={`ev-${eIdx}`}
                              item={editedItem}
                              index={eIdx}
                              onFieldChange={(field, value) => {
                                if (!msgId) return;
                                setEventEdits((prev) => ({
                                  ...prev,
                                  [msgId]: {
                                    ...prev[msgId],
                                    [eIdx]: { ...prev[msgId]?.[eIdx], [field]: value },
                                  },
                                }));
                              }}
                            />
                          );
                        })}
                      </div>
                    )}

                    {/* Note previews (shown before user confirms) */}
                    {hasNotePreviews && (
                      <div className="kairos-preview-list" data-testid="note-previews">
                        {(
                          (m as { notePreviews?: NotePreviewItem[]; msgId?: string })
                            .notePreviews ?? []
                        ).map((n, nIdx) => {
                          const msgId = (m as { msgId?: string }).msgId ?? "";
                          const editedContent = noteEdits[msgId]?.[nIdx];
                          const editedItem = editedContent !== undefined ? { ...n, content: editedContent } : n;
                          return (
                            <NotePreviewCard
                              key={`note-${nIdx}`}
                              item={editedItem}
                              index={nIdx}
                              onContentChange={(newContent) => {
                                if (!msgId) return;
                                setNoteEdits((prev) => ({
                                  ...prev,
                                  [msgId]: { ...prev[msgId], [nIdx]: newContent },
                                }));
                              }}
                            />
                          );
                        })}
                      </div>
                    )}

                    {/*
                      The real, field-level diff — read from the rows, not from
                      the model's own description of its plan. Rendered above the
                      confirm button so the count on the button is something the
                      user has had a chance to check.
                    */}
                    {m.role === "agent"
                      ? m.actions
                          ?.filter((a) => a.type === "task_confirm")
                          .map((a) => (
                            <PlanDiffCard
                              key={`diff-${a.draftId}`}
                              draftId={a.draftId}
                            />
                          ))
                      : null}

                    {/* Action buttons */}
                    {m.role === "agent" && m.actions?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {m.actions.map((a, aIdx) => {
                          /* ---- Notes Direct Apply (Combined Confirm + Apply) ---- */
                          if (a.type === "notes_direct_apply") {
                            const msgId = (m as { msgId?: string }).msgId ?? "";
                            const isApplying = notesConfirmMutation.isPending || notesApplyMutation.isPending;
                            return (
                              <button
                                key={`${a.type}-${a.draftId}-${aIdx}`}
                                type="button"
                                className="text-xs px-4 py-2 rounded-lg text-white font-medium transition-all hover:scale-[1.03] active:scale-95 flex items-center gap-2"
                                style={{
                                  backgroundColor: "rgb(var(--accent-primary))",
                                }}
                                disabled={isApplying}
                                onClick={async () => {
                                  try {
                                    // Step 1: Confirm (hidden from user) — pass any user edits
                                    const edits = noteEdits[msgId] 
                                      ? Object.entries(noteEdits[msgId]).map(([idx, content]) => ({
                                          index: parseInt(idx, 10),
                                          content,
                                        }))
                                      : undefined;
                                    const confirmRes = (await notesConfirmMutation.mutateAsync({
                                      draftId: a.draftId,
                                      edits,
                                    })) as ConfirmResponse;
                                    
                                    // Step 2: Apply immediately
                                    const applyRes = (await notesApplyMutation.mutateAsync({
                                      draftId: a.draftId,
                                      confirmationToken: confirmRes.confirmationToken,
                                    })) as ApplyResponse;
                                    
                                    const results = applyRes.results;
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: `✅ Done! ${results ? `(${typeof results === "object" ? Object.keys(results as Record<string, unknown>).length : 1} operations applied)` : "Changes applied successfully."}`,
                                        createdAt: new Date(),
                                      },
                                    ]);
                                    // Clear edits for this message
                                    setNoteEdits((prev) => {
                                      const next = { ...prev };
                                      delete next[msgId];
                                      return next;
                                    });
                                    // Invalidate notes cache
                                    void utils.note.invalidate();
                                  } catch (err) {
                                    const msg = err instanceof Error ? err.message : "Apply failed";
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: `❌ ${msg.includes("status=confirmed") ? "Already applied!" : `Something went wrong: ${msg}`}`,
                                        createdAt: new Date(),
                                      },
                                    ]);
                                  }
                                }}
                              >
                                {isApplying ? (
                                  <>
                                    <span className="animate-spin">⏳</span>
                                    Applying...
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 size={14} />
                                    Apply
                                  </>
                                )}
                              </button>
                            );
                          }

                          /* ---- Events Direct Apply (Combined Confirm + Apply) ---- */
                          if (a.type === "events_direct_apply") {
                            const msgId = (m as { msgId?: string }).msgId ?? "";
                            const isApplying = eventsConfirmMutation.isPending || eventsApplyMutation.isPending;
                            return (
                              <button
                                key={`${a.type}-${a.draftId}-${aIdx}`}
                                type="button"
                                className="text-xs px-4 py-2 rounded-lg text-white font-medium transition-all hover:scale-[1.03] active:scale-95 flex items-center gap-2"
                                style={{
                                  backgroundColor: "rgb(var(--accent-primary))",
                                }}
                                disabled={isApplying}
                                onClick={async () => {
                                  try {
                                    // Step 1: Confirm (hidden from user) — pass any user edits
                                    const edits = eventEdits[msgId]
                                      ? Object.entries(eventEdits[msgId]).map(([idx, fields]) => ({
                                          index: parseInt(idx, 10),
                                          ...fields,
                                        }))
                                      : undefined;
                                    const confirmRes = (await eventsConfirmMutation.mutateAsync({
                                      draftId: a.draftId,
                                      edits,
                                    })) as ConfirmResponse;
                                    
                                    // Step 2: Apply immediately
                                    const applyRes = (await eventsApplyMutation.mutateAsync({
                                      draftId: a.draftId,
                                      confirmationToken: confirmRes.confirmationToken,
                                    })) as ApplyResponse;
                                    
                                    const results = applyRes.results;
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: `✅ Done! ${results ? `(${typeof results === "object" ? Object.keys(results as Record<string, unknown>).length : 1} operations applied)` : "Changes applied successfully."}`,
                                        createdAt: new Date(),
                                      },
                                    ]);
                                    // Clear edits for this message
                                    setEventEdits((prev) => {
                                      const next = { ...prev };
                                      delete next[msgId];
                                      return next;
                                    });
                                    // Invalidate events cache
                                    void utils.event.invalidate();
                                  } catch (err) {
                                    const msg = err instanceof Error ? err.message : "Apply failed";
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: `❌ ${msg.includes("status=confirmed") ? "Already applied!" : `Something went wrong: ${msg}`}`,
                                        createdAt: new Date(),
                                      },
                                    ]);
                                  }
                                }}
                              >
                                {isApplying ? (
                                  <>
                                    <span className="animate-spin">⏳</span>
                                    Applying...
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 size={14} />
                                    Apply
                                  </>
                                )}
                              </button>
                            );
                          }

                          /* ---- Notes Confirm (legacy) ---- */
                          if (a.type === "notes_confirm") {
                            return (
                              <button
                                key={`${a.type}-${a.draftId}-${aIdx}`}
                                type="button"
                                className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:scale-[1.03] active:scale-95"
                                style={{
                                  backgroundColor:
                                    "rgb(var(--accent-primary) / 0.15)",
                                  color:
                                    "rgb(var(--accent-primary))",
                                }}
                                disabled={
                                  notesConfirmMutation.isPending
                                }
                                onClick={async () => {
                                  try {
                                    const res =
                                      (await notesConfirmMutation.mutateAsync(
                                        {
                                          draftId: a.draftId,
                                        },
                                      )) as ConfirmResponse;
                                    const token =
                                      res.confirmationToken;
                                    const summary = res.summary;

                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: t("notesConfirmed", {
                                          summary:
                                            typeof summary ===
                                            "string"
                                              ? summary
                                              : t("readyToApply"),
                                        }),
                                        createdAt: new Date(),
                                        actions: [
                                          {
                                            type: "notes_apply",
                                            draftId: a.draftId,
                                            confirmationToken:
                                              token,
                                          },
                                        ],
                                      },
                                    ]);
                                  } catch (err) {
                                    const msg =
                                      err instanceof Error
                                        ? err.message
                                        : typeof err === "string"
                                          ? err
                                          : "Confirm failed";

                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: msg.includes(
                                          "status=confirmed",
                                        )
                                          ? t("alreadyConfirmed")
                                          : t("confirmFailed", {
                                              error: msg,
                                            }),
                                        createdAt: new Date(),
                                      },
                                    ]);
                                  }
                                }}
                              >
                                {notesConfirmMutation.isPending
                                  ? t("confirming")
                                  : t("confirm")}
                              </button>
                            );
                          }

                          /* ---- Notes Apply ---- */
                          if (a.type === "notes_apply") {
                            return (
                              <button
                                key={`${a.type}-${a.draftId}-${aIdx}`}
                                type="button"
                                className="text-xs px-3 py-1.5 rounded-lg text-white transition-all hover:scale-[1.03] active:scale-95"
                                style={{
                                  backgroundColor:
                                    "rgb(var(--accent-primary))",
                                }}
                                disabled={
                                  notesApplyMutation.isPending
                                }
                                onClick={async () => {
                                  try {
                                    const res =
                                      (await notesApplyMutation.mutateAsync(
                                        {
                                          draftId: a.draftId,
                                          confirmationToken:
                                            a.confirmationToken,
                                        },
                                      )) as ApplyResponse;
                                    const results = res.results;
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: `${t("notesDone")}${results ? ` (${typeof results === "object" ? Object.keys(results as Record<string, unknown>).length : 1} operations)` : ""}`,
                                        createdAt: new Date(),
                                      },
                                    ]);
                                    // Instant update: invalidate notes cache
                                    void utils.note.invalidate();
                                  } catch (err) {
                                    const msg =
                                      err instanceof Error
                                        ? err.message
                                        : "Apply failed";
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: t("applyFailed", {
                                          error: msg,
                                        }),
                                        createdAt: new Date(),
                                      },
                                    ]);
                                  }
                                }}
                              >
                                {notesApplyMutation.isPending
                                  ? t("applying")
                                  : t("apply")}
                              </button>
                            );
                          }

                          /* ---- Events Confirm ---- */
                          if (a.type === "events_confirm") {
                            return (
                              <button
                                key={`${a.type}-${a.draftId}-${aIdx}`}
                                type="button"
                                className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:scale-[1.03] active:scale-95"
                                style={{
                                  backgroundColor:
                                    "rgb(var(--accent-primary) / 0.15)",
                                  color:
                                    "rgb(var(--accent-primary))",
                                }}
                                disabled={
                                  eventsConfirmMutation.isPending
                                }
                                onClick={async () => {
                                  try {
                                    const res =
                                      (await eventsConfirmMutation.mutateAsync(
                                        {
                                          draftId: a.draftId,
                                        },
                                      )) as ConfirmResponse;
                                    const token =
                                      res.confirmationToken;
                                    const summary = res.summary;

                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: t("eventsConfirmed", {
                                          summary:
                                            typeof summary ===
                                            "string"
                                              ? summary
                                              : t("readyToApply"),
                                        }),
                                        createdAt: new Date(),
                                        actions: [
                                          {
                                            type: "events_apply",
                                            draftId: a.draftId,
                                            confirmationToken:
                                              token,
                                          },
                                        ],
                                      },
                                    ]);
                                  } catch (err) {
                                    const msg =
                                      err instanceof Error
                                        ? err.message
                                        : "Confirm failed";
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: msg.includes(
                                          "status=confirmed",
                                        )
                                          ? t("alreadyConfirmed")
                                          : t("confirmFailed", {
                                              error: msg,
                                            }),
                                        createdAt: new Date(),
                                      },
                                    ]);
                                  }
                                }}
                              >
                                {eventsConfirmMutation.isPending
                                  ? t("confirming")
                                  : t("confirmEvents")}
                              </button>
                            );
                          }

                          /* ---- Events Apply ---- */
                          if (a.type === "events_apply") {
                            return (
                              <button
                                key={`${a.type}-${a.draftId}-${aIdx}`}
                                type="button"
                                className="text-xs px-3 py-1.5 rounded-lg text-white transition-all hover:scale-[1.03] active:scale-95"
                                style={{
                                  backgroundColor:
                                    "rgb(var(--accent-primary))",
                                }}
                                disabled={
                                  eventsApplyMutation.isPending
                                }
                                onClick={async () => {
                                  try {
                                    const res =
                                      (await eventsApplyMutation.mutateAsync(
                                        {
                                          draftId: a.draftId,
                                          confirmationToken:
                                            a.confirmationToken,
                                        },
                                      )) as ApplyResponse;
                                    const results = res.results;
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: `${t("eventsDone")}${results ? ` (${typeof results === "object" ? Object.keys(results as Record<string, unknown>).length : 1} operations)` : ""}`,
                                        createdAt: new Date(),
                                      },
                                    ]);
                                    // Instant update: invalidate events cache
                                    void utils.event.invalidate();
                                  } catch (err) {
                                    const msg =
                                      err instanceof Error
                                        ? err.message
                                        : "Apply failed";
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: t("applyFailed", {
                                          error: msg,
                                        }),
                                        createdAt: new Date(),
                                      },
                                    ]);
                                  }
                                }}
                              >
                                {eventsApplyMutation.isPending
                                  ? t("applying")
                                  : t("applyEvents")}
                              </button>
                            );
                          }

                          /* ---- Undo an applied plan ---- */
                          if (a.type === "task_undo") {
                            return (
                              <UndoApplyButton
                                key={`${a.type}-${a.draftId}-${aIdx}`}
                                draftId={a.draftId}
                                kind="tasks"
                                onUndone={() => {
                                  void utils.task.invalidate();
                                  void utils.project.invalidate();
                                }}
                              />
                            );
                          }

                          /* ---- Task Confirm ---- */
                          if (a.type === "task_confirm") {
                            return (
                              <button
                                key={`${a.type}-${a.draftId}-${aIdx}`}
                                type="button"
                                className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:scale-[1.03] active:scale-95"
                                style={{
                                  backgroundColor:
                                    "rgb(var(--accent-primary) / 0.15)",
                                  color:
                                    "rgb(var(--accent-primary))",
                                }}
                                disabled={
                                  taskConfirmMutation.isPending
                                }
                                onClick={async () => {
                                  try {
                                    const res =
                                      (await taskConfirmMutation.mutateAsync(
                                        {
                                          draftId: a.draftId,
                                        },
                                      )) as TaskPlannerConfirmResponse;
                                    const token =
                                      res.confirmationToken;

                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: t("readyToApply"),
                                        createdAt: new Date(),
                                        actions: [
                                          {
                                            type: "task_apply",
                                            draftId: a.draftId,
                                            confirmationToken:
                                              token,
                                          },
                                        ],
                                      },
                                    ]);
                                  } catch (err) {
                                    const msg =
                                      err instanceof Error
                                        ? err.message
                                        : "Confirm failed";
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: msg.includes(
                                          "status=confirmed",
                                        )
                                          ? t("alreadyConfirmed")
                                          : t("confirmFailed", {
                                              error: msg,
                                            }),
                                        createdAt: new Date(),
                                      },
                                    ]);
                                  }
                                }}
                              >
                                {taskConfirmMutation.isPending
                                  ? t("confirming")
                                  : t("confirmTaskPlan")}
                              </button>
                            );
                          }

                          /* ---- Task Apply ---- */
                          if (a.type === "task_apply") {
                            return (
                              <button
                                key={`${a.type}-${a.draftId}-${aIdx}`}
                                type="button"
                                className="text-xs px-3 py-1.5 rounded-lg text-white transition-all hover:scale-[1.03] active:scale-95"
                                style={{
                                  backgroundColor:
                                    "rgb(var(--accent-primary))",
                                }}
                                disabled={
                                  taskApplyMutation.isPending
                                }
                                onClick={async () => {
                                  try {
                                    const res =
                                      (await taskApplyMutation.mutateAsync(
                                        {
                                          draftId: a.draftId,
                                          confirmationToken:
                                            a.confirmationToken,
                                        },
                                      )) as TaskPlannerApplyResponse;
                                    const created =
                                      res?.results?.createdTaskIds
                                        ?.length ?? 0;

                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text:
                                          created > 0
                                            ? t(
                                                "taskPlannerDone",
                                                {
                                                  count: created,
                                                },
                                              )
                                            : t(
                                                "taskPlannerDoneNoCount",
                                              ),
                                        createdAt: new Date(),
                                        // The point of the draft/confirm/apply
                                        // lifecycle: pressing Apply is safe
                                        // because it can be taken back. Offered
                                        // here for the first time.
                                        actions: [
                                          {
                                            type: "task_undo",
                                            draftId: a.draftId,
                                          },
                                        ],
                                      },
                                    ]);
                                    // Instant update: invalidate task/project caches
                                    void utils.task.invalidate();
                                    void utils.project.invalidate();
                                  } catch (err) {
                                    const msg =
                                      err instanceof Error
                                        ? err.message
                                        : "Apply failed";
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "agent",
                                        text: t("applyFailed", {
                                          error: msg,
                                        }),
                                        createdAt: new Date(),
                                      },
                                    ]);
                                  }
                                }}
                              >
                                {taskApplyMutation.isPending
                                  ? t("applying")
                                  : t("applyTaskPlan")}
                              </button>
                            );
                          }

                          return null;
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          {/* The widget's one-line trail. The page renders the full timeline
              in its right rail, so it would only be a duplicate there. */}
          {props.variant === "widget" && trailSummary && (
            <div className="kairos-stamp mt-1 flex items-center gap-2.5 text-[9.5px] text-fg-tertiary">
              <span className="truncate">{trailSummary.lastLabel}</span>
              <span className="h-px flex-1 bg-border-medium/60" />
              <span className="shrink-0">
                {tc("trailSummary", {
                  count: trailSummary.lookups,
                  seconds: (trailSummary.latencyMs / 1000).toFixed(1),
                })}
              </span>
            </div>
          )}

          <div className="h-2" />
        </div>
      </div>

      {/* ---- Input form ---- */}
      <form
        className="shrink-0 border-t"
        style={{
          backgroundColor: "rgb(var(--bg-primary))",
          borderTopColor: "rgb(var(--border-medium))",
          borderTopWidth: "1px",
          borderTopStyle: "solid",
        }}
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(draft);
        }}
      >
        {isPanel ? (
          /*
           * The console composer.
           *
           * A panel rather than a pill, because it carries more than text: who
           * answers and what they can see are decisions about the *next*
           * message, so they sit with the message being written rather than in
           * a settings pane the user would have to go and find.
           *
           * Enter inserts a newline and ⌘/Ctrl+Enter sends. On a full page a
           * prompt is routinely several lines long, and a composer where Enter
           * fires the turn makes writing one an exercise in avoiding the key.
           * The shortcut is spelled out beside the send button rather than left
           * to be discovered.
           */
          <div
            className={
              isConsole ? "w-full px-6 pt-4 pb-5 lg:px-10" : "w-full p-3"
            }
          >
            <div className="flex flex-col gap-3 rounded-2xl border border-border-medium/70 bg-bg-secondary px-3 py-2.5 transition-colors focus-within:border-accent-primary">
              <textarea
                ref={composerRef}
                value={draft}
                rows={1}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSend(draft);
                  }
                }}
                placeholder={t("placeholder")}
                className="kairos-field-bare max-h-40 min-h-[24px] w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-fg-primary placeholder:text-fg-tertiary focus:outline-none"
              />

              <div className="flex flex-wrap items-center gap-2">
                {props.composerControls}

                {isConsole && (
                  <span className="kairos-stamp ml-auto hidden text-[10px] text-fg-tertiary sm:inline">
                    {tc("sendShortcut")}
                  </span>
                )}

                <button
                  type="submit"
                  aria-label={t("send")}
                  title={tc("sendShortcut")}
                  className={`kairos-tap ${
                    isConsole ? "" : "ml-auto "
                  }flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50`}
                  style={{
                    backgroundColor:
                      !isThinking && draft.trim()
                        ? "rgb(var(--accent-primary))"
                        : "rgb(var(--bg-tertiary))",
                  }}
                  disabled={isThinking || !draft.trim()}
                >
                  <ArrowUp size={15} />
                </button>
              </div>
            </div>

            {isConsole && (
              <p className="mt-2.5 px-0.5 text-[11.5px] leading-relaxed text-fg-tertiary">
                {tc("composerDisclaimer")}
              </p>
            )}
          </div>
        ) : (
        <div className="w-full px-4 py-4">
          <div
            className="flex items-end gap-2 rounded-[999px] px-3 py-2 shadow-sm"
            style={{ backgroundColor: "rgb(var(--bg-secondary))" }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("placeholder")}
              className="kairos-field-bare flex-1 bg-transparent px-2 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus-visible:outline-none"
            />
            <button
              type="submit"
              className="h-10 shrink-0 px-4 rounded-full text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed text-white hover:scale-[1.03] active:scale-95"
              style={{
                backgroundColor:
                  !isThinking && draft.trim()
                    ? "rgb(var(--accent-primary))"
                    : "rgb(var(--bg-tertiary))",
              }}
              disabled={isThinking || !draft.trim()}
            >
              {t("send")}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-fg-tertiary text-center">
            {t("disclaimer")}
          </p>
        </div>
        )}
      </form>
    </div>
  );
}
