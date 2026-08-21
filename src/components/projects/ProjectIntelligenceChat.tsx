"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAgentStream,
  type AgentTurnPayload,
} from "~/hooks/useAgentStream";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Sparkles, Copy, Check, CheckCircle2, Calendar, FileText, MapPin, Trash2, Pencil } from "lucide-react";
import { useDateFormat } from "~/hooks/useDateFormat";

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
      actions?: Array<
        | { type: "notes_confirm"; draftId: string }
        | { type: "notes_apply"; draftId: string; confirmationToken: string }
        | { type: "notes_direct_apply"; draftId: string } // Combined confirm+apply
        | { type: "events_confirm"; draftId: string }
        | { type: "events_apply"; draftId: string; confirmationToken: string }
        | { type: "events_direct_apply"; draftId: string } // Combined confirm+apply
        | { type: "task_confirm"; draftId: string }
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
      className="opacity-50 hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-white/10 text-fg-tertiary hover:text-fg-secondary shrink-0"
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
            className="w-full text-sm font-semibold text-fg-primary bg-bg-secondary/50 border border-border-secondary rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent-primary"
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
            className="w-full text-xs text-fg-secondary bg-bg-secondary/50 border border-border-secondary rounded-md p-2 mt-1 resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary min-h-[40px]"
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
            className="w-full text-xs text-fg-secondary bg-bg-secondary/50 border border-border-secondary rounded-md p-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary min-h-[60px]"
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
}) {
  const { projectId, pinnedAgentId } = props;
  const t = useTranslations("chat");
  const utils = api.useUtils();

  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [rateLimitPopup, setRateLimitPopup] = useState<{ show: boolean; message: string }>({ show: false, message: "" });
  
  // Track edits to draft previews (keyed by msgId + index)
  const [noteEdits, setNoteEdits] = useState<Record<string, Record<number, string>>>({});
  const [eventEdits, setEventEdits] = useState<Record<string, Record<number, { title?: string; description?: string }>>>({});

  // Generate unique message IDs
  const generateMsgId = useCallback(() => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, []);

  /* ---- Rate limit status query ---- */
  const rateLimitQuery = api.agent.rateLimitStatus.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
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
          ...(payload.a1.clarify?.options ?? []).map((o) => `• ${o}`),
          ...(payload.a1.answer?.details ?? []).map((d) => `• ${d}`),
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
            text: `${t("needMoreInfo")}\n${questions.map((q) => `• ${q}`).join("\n")}`,
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
          text: `${t("needMoreInfo")}\n${questions.map((q) => `• ${q}`).join("\n")}`,
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

  const { send: sendTurn } = useAgentStream({
    onToolCall: (name) => {
      setProgressLabel(t("lookingUp", { tool: name }));
      // The stream already reports every lookup; it was only ever used for a
      // transient label that the next frame overwrote. Keeping the list turns
      // the same frames into a record of what the answer was actually based on.
      toolsThisTurn.current = [...toolsThisTurn.current, name];
      props.onToolsUsed?.(toolsThisTurn.current);
    },
    onSubAgent: (agent) => {
      setProgressLabel(t("subAgentWorking", { agent }));
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
      setMessages((prev) => replaceThinking(prev, buildPlanMessage(payload)));
      if (payload.plan?.kind === "tasks") void utils.task.invalidate();
    },
    onError: (message, isRateLimit) => {
      setProgressLabel(null);
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
  const historyQuery = api.agent.latestConversation.useQuery(
    { projectId },
    { refetchOnWindowFocus: false, staleTime: Infinity },
  );

  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    const data = historyQuery.data;
    if (!data?.conversationId || data.messages.length === 0) return;

    hydratedRef.current = true;
    conversationIdRef.current = data.conversationId;

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
              ...(parsed.answer.details ?? []).map((d) => `• ${d}`),
            ].join("\n");
          }
        } catch {
          // Older rows, or a turn stored as plain text: show it as-is.
        }

        return { role: "agent", text, createdAt: m.createdAt };
      }),
    );
  }, [historyQuery.data, projectId]);

  /* ---------- Scrolling ---------- */

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

      void sendTurn({
        message: clampText(msg),
        projectId,
        conversationId: conversationIdRef.current,
        agentId: pinnedAgentId,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, pinnedAgentId, sendTurn],
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

      {/* ---- Header ---- */}
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

        <button
          type="button"
          className="text-xs px-2.5 py-1.5 rounded-lg text-fg-secondary transition-colors hover:text-fg-primary"
          style={{ backgroundColor: "rgb(var(--bg-secondary))" }}
          onClick={() => setShowAssumptions((v) => !v)}
        >
          {showAssumptions ? t("hide") : t("info")}
        </button>
      </div>

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
        className="flex-1 min-h-0 overflow-y-auto px-4 py-6"
        style={{ backgroundColor: "rgb(var(--bg-primary))" }}
      >
        <div className="w-full space-y-4">
          {messages.length === 0 ? (
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
                      m.role === "user"
                        ? "group max-w-[85%] rounded-2xl rounded-br-md text-white px-4 py-2.5 shadow-sm"
                        : "group max-w-[85%] rounded-2xl rounded-bl-md text-fg-primary px-4 py-2.5 shadow-sm"
                    }
                    style={{
                      backgroundColor:
                        m.role === "user"
                          ? "rgb(var(--accent-primary))"
                          : "rgb(var(--bg-secondary))",
                    }}
                  >
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
              className="flex-1 bg-transparent px-2 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus-visible:outline-none"
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
      </form>
    </div>
  );
}
