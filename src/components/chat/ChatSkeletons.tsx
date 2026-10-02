/**
 * The loading states of the two chat surfaces — direct messages and the
 * Kairos AI console.
 *
 * Kept beside the real panes and built from the same classNames, so a route
 * `loading.tsx` and the in-component placeholders (a rail still fetching, a
 * thread still opening) draw the exact geometry the loaded state lands in.
 * Only data is hatched: titles, labels, filter names and control outlines are
 * real and inert.
 *
 * No `"use client"`: these render from server `loading.tsx` files as well as
 * from the client panes (next-intl's `useTranslations` works in both).
 */

import { useTranslations } from "next-intl";

import {
  ArrowUp,
  Brain,
  Eraser,
  FileText,
  Info,
  ListTree,
  LogOut,
  PanelLeftClose,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wrench,
  X,
  Archive,
  BellRing,
} from "~/components/ui/icons";
import { Skeleton, SkeletonStatus, skeletonWidth } from "~/components/ui/Skeleton";
import { SkeletonSlow } from "~/components/ui/SkeletonSlow";
import { Stamp } from "~/components/ui/Stamp";

import { TurnTrailPanel } from "./TurnTrailPanel";

/* Copies of `chatUi`'s pane vocabulary. `chatUi` is a client module, and a
   value imported from one into a server component arrives as a client
   reference rather than a string — so the route skeletons cannot read these
   from there. Keep them in step with `CHAT_PANE` / `CHAT_EYEBROW` /
   `CHAT_ICON_BUTTON` / `chatPill`. */
const CHAT_PANE =
  "bg-tui-pane border border-tui-ink/10 rounded-lg shadow-[var(--tui-pane-shadow)]";
const CHAT_EYEBROW = "text-[11px] font-medium tracking-[0.18em] uppercase text-tui-ink3";
const CHAT_ICON_BUTTON =
  "grid place-items-center flex-none rounded-full border border-tui-ink/16 bg-transparent text-tui-ink2";
function chatPill(on: boolean): string {
  return on
    ? "border-tui-accent/45 bg-tui-accent/15 text-tui-accent"
    : "border-tui-ink/16 bg-transparent text-tui-ink2";
}

/* ================================================================== */
/*  Direct messages                                                    */
/* ================================================================== */

/**
 * Conversation rows, as `ConversationRail` draws them: a 38px face, the name
 * line (14.5px) with its timestamp, the preview line (13px · 1.4).
 */
export function ConversationRowsSkeleton({ count = 7 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-0.5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex w-full items-start gap-3 rounded-lg p-3">
          <Skeleton shape="circle" row={i} className="h-[38px] w-[38px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="flex h-[22px] items-center gap-2">
              <Skeleton row={i} className="h-[9px]" style={{ width: skeletonWidth(i + 1, 34, 62) }} />
              <span className="flex-1" />
              <Skeleton row={i} className="h-[7px] w-[30px]" />
            </span>
            <span className="flex h-[18px] items-center">
              <Skeleton row={i} className="h-[8px]" style={{ width: skeletonWidth(i + 11, 58, 92) }} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The whole rail: the title, search and filters for real, the rows hatched. */
export function ConversationRailSkeleton() {
  const t = useTranslations("chat.direct");
  const filters = [t("filterAll"), t("filterUnread"), t("filterProjects"), t("filterArchived")];

  return (
    <aside className={`${CHAT_PANE} flex h-full min-h-0 flex-col`} aria-label={t("conversations")}>
      <div className="flex flex-none items-end gap-3 px-[22px] pt-[26px] pb-[18px]">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {/* The workspace name is data; the line box is the eyebrow's. */}
          <span className="flex h-[16.5px] items-center">
            <Skeleton className="h-[7px] w-[120px]" />
          </span>
          <div className="flex items-baseline gap-2.5">
            <h1 className="m-0 font-display text-[46px] leading-none font-light tracking-[-0.02em] text-tui-ink">
              {t("chats")}
            </h1>
            <Skeleton shape="title" className="h-[14px] w-[18px]" />
          </div>
        </div>
        <span aria-hidden="true" className={`${CHAT_ICON_BUTTON} h-9 w-9 text-tui-accent`}>
          <Pencil size={15} />
        </span>
      </div>

      <div className="flex-none px-4 pb-3" aria-hidden="true">
        <span className="flex h-[38px] items-center gap-2.5 rounded-full border border-tui-ink/16 bg-tui-bg pr-2 pl-3.5">
          <Search size={14} className="flex-none text-tui-ink3" />
          <span className="truncate text-[13.5px] text-tui-ink3">{t("searchPeopleAndMessages")}</span>
        </span>
      </div>

      <div className="flex flex-none flex-wrap gap-1.5 px-4 pb-3.5" aria-hidden="true">
        {filters.map((label, i) => (
          <span
            key={label}
            className={`flex h-7 items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] font-medium whitespace-nowrap ${chatPill(i === 0)}`}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="mx-4 h-px flex-none bg-tui-ink/8" />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-2.5 pt-2.5 pb-3.5">
        <ConversationRowsSkeleton />
      </div>
    </aside>
  );
}

/** One message group: the sender line, then its bubbles. */
const BUBBLES: ReadonlyArray<{ own: boolean; head: boolean; lines: 1 | 2; w: number }> = [
  { own: false, head: true, lines: 1, w: 58 },
  { own: false, head: false, lines: 2, w: 76 },
  { own: true, head: true, lines: 1, w: 44 },
  { own: false, head: true, lines: 1, w: 52 },
  { own: true, head: true, lines: 2, w: 68 },
  { own: true, head: false, lines: 1, w: 34 },
];

/**
 * The thread body, as `MessageThread` lays it out: bubbles 14.5px · 1.55 with
 * 11px/15px padding (one line ≈ 45px, two ≈ 67px), capped at min(480px, 88%),
 * yours on the right in the accent hatch. Anchored to the bottom, where a
 * thread opens.
 */
export function MessagesSkeleton({ slow = false }: { slow?: boolean }) {
  return (
    <div className="relative min-h-0 flex-1">
      <div className="flex h-full flex-col justify-end overflow-hidden px-4 pt-3.5 pb-[26px] sm:px-7">
        {BUBBLES.map((b, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={`flex flex-col gap-1.5 ${b.own ? "items-end" : "items-start"} ${b.head ? "pt-5" : "pt-1"}`}
          >
            {b.head && (
              <span className="flex h-[19px] items-center">
                <Skeleton row={i} className={`h-[8px] ${b.own ? "w-[64px]" : "w-[96px]"}`} />
              </span>
            )}
            <Skeleton
              shape="bubble"
              row={i}
              tone={b.own ? "yours" : undefined}
              className={`max-w-[min(480px,88%)] ${b.lines === 2 ? "h-[67px]" : "h-[45px]"}`}
              style={{ width: `${b.w}%` }}
            />
          </div>
        ))}
        {slow && <SkeletonSlow what="messages" className="mt-0 justify-center" />}
      </div>
    </div>
  );
}

/** The thread header: the person is data, the two round controls are real. */
export function ThreadHeaderSkeleton() {
  return (
    <header className="flex flex-none items-center gap-3 border-b border-tui-ink/8 py-[18px] pr-4 pl-3 sm:gap-3.5 sm:pr-5 sm:pl-6">
      <Skeleton shape="circle" className="h-[42px] w-[42px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex h-[25px] items-center">
          <Skeleton className="h-[14px] w-[150px]" />
        </span>
        <span className="flex h-[19px] items-center">
          <Skeleton className="h-[8px] w-[64px]" />
        </span>
      </div>
      <span aria-hidden="true" className={`${CHAT_ICON_BUTTON} hidden h-9 w-9 lg:grid`}>
        <Search size={15} />
      </span>
      <span aria-hidden="true" className={`${CHAT_ICON_BUTTON} h-9 w-9`}>
        <Info size={15} />
      </span>
    </header>
  );
}

/** The composer, outline only — the same box `Composer` draws, inert. */
export function ComposerSkeleton() {
  const t = useTranslations("chat.direct");
  return (
    <div
      aria-hidden="true"
      className="flex flex-none flex-col gap-2.5 border-t border-tui-ink/8 px-4 pt-3.5 pb-5 opacity-60 sm:px-6"
    >
      <div className="flex flex-col gap-2 rounded-xl border border-tui-ink/16 bg-tui-bg pt-3 pr-3 pb-2.5 pl-4">
        {/* rows={2} at 14.5px · 1.5 */}
        <span className="block h-[43.5px]" />
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-tui-ink/16 text-tui-ink2">
            <Paperclip size={14} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-tui-ink3">{t("sendHint")}</span>
          <span className="flex h-[34px] flex-none items-center gap-[7px] rounded-full border border-tui-ink/16 px-[15px] text-[13px] font-semibold text-tui-ink3">
            {t("send")}
            <ArrowUp size={13} />
          </span>
        </div>
      </div>
    </div>
  );
}

/** Everything inside the thread pane while a conversation opens. */
export function ThreadSkeleton({ slow = false }: { slow?: boolean }) {
  return (
    <>
      <ThreadHeaderSkeleton />
      <MessagesSkeleton slow={slow} />
      <ComposerSkeleton />
    </>
  );
}

/** The `/chat` thread pane before anything is picked — the empty state, real. */
export function NoThreadSkeleton() {
  const t = useTranslations("chat.direct");
  return (
    <div className="m-auto flex max-w-[380px] flex-col items-center gap-3 p-6 text-center">
      <span className={CHAT_EYEBROW}>{t("chats")}</span>
      <h2 className="font-display text-[40px] leading-[1.05] font-light tracking-[-0.02em]">
        {t("noConversationOpen")}
      </h2>
      {/* "…message anyone in {workspace}" — the workspace is data. */}
      <span aria-hidden="true" className="flex w-[300px] max-w-full flex-col items-center">
        <span className="flex h-[23px] w-full items-center justify-center">
          <Skeleton className="h-[9px] w-full" />
        </span>
        <span className="flex h-[23px] w-full items-center justify-center">
          <Skeleton className="h-[9px] w-[62%]" row={1} />
        </span>
      </span>
      <span
        aria-hidden="true"
        className="mt-2 flex h-[38px] items-center gap-2 rounded-full border border-tui-accent/45 px-[18px] text-[13.5px] font-semibold text-tui-accent"
      >
        <Plus size={14} />
        {t("newChat")}
      </span>
    </div>
  );
}

/**
 * The data sections of `ConversationDetails` — pinned messages and shared
 * files — as `Section` + `ROW` lay them out. The label carries a count, so it
 * hatches too.
 */
export function DetailsSectionsSkeleton() {
  return (
    <section aria-hidden="true" className="flex flex-col gap-0.5 border-b border-tui-ink/8 px-4 pt-5 pb-4">
      <span className="flex h-[16.5px] items-center px-1.5 pb-2 box-content">
        <Skeleton className="h-[7px] w-[104px]" />
      </span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex w-full items-center gap-[11px] rounded-lg px-1.5 py-2">
          <Skeleton shape="circle" row={i + 1} className="h-[30px] w-[30px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="flex h-[19.5px] items-center">
              <Skeleton row={i + 1} className="h-[9px]" style={{ width: skeletonWidth(i + 21, 52, 84) }} />
            </span>
            <span className="flex h-[17px] items-center">
              <Skeleton row={i + 1} className="h-[7px] w-[40px]" />
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}

/** The whole details pane, for the route skeleton (open by default at xl). */
export function DetailsPaneSkeleton() {
  const t = useTranslations("chat.direct");
  const toggles = [
    { icon: <BellRing size={14} />, label: t("muteConversation") },
    { icon: <Archive size={14} />, label: t("archiveConversation") },
  ];

  return (
    <aside className={`${CHAT_PANE} flex h-full min-h-0 flex-col`} aria-label={t("details")}>
      <div className="flex flex-none items-center border-b border-tui-ink/8 pt-[18px] pr-4 pb-4 pl-[22px]">
        <h2 className="flex-1 font-display text-[21px] text-tui-ink">{t("details")}</h2>
        <span aria-hidden="true" className={`${CHAT_ICON_BUTTON} h-[30px] w-[30px]`}>
          <X size={12} />
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden text-tui-ink">
        <section className="flex flex-col items-center gap-1.5 border-b border-tui-ink/8 px-[22px] pt-7 pb-6 text-center">
          <div className="mb-2">
            <Skeleton shape="circle" className="h-[72px] w-[72px]" />
          </div>
          <span className="flex h-[26.5px] items-center">
            <Skeleton className="h-[14px] w-[130px]" />
          </span>
          <span className="flex h-[19.5px] items-center">
            <Skeleton className="h-[8px] w-[96px]" />
          </span>
        </section>

        <DetailsSectionsSkeleton />

        <section aria-hidden="true" className="flex flex-col gap-0.5 border-b border-tui-ink/8 px-4 pt-5 pb-4">
          <h3 className={`${CHAT_EYEBROW} px-1.5 pb-2`}>{t("notifications")}</h3>
          {toggles.map((row, i) => (
            <span key={row.label} className="flex h-10 w-full items-center gap-[11px] rounded-lg px-1.5 text-tui-ink">
              <span className="flex-none text-tui-ink3">{row.icon}</span>
              <span className="flex-1 text-[13.5px]">{row.label}</span>
              {/* The switch is drawn; whether it is on is data. */}
              <span className="relative h-5 w-[34px] flex-none rounded-full border border-tui-ink/16">
                <Skeleton shape="circle" row={4 + i} className="absolute top-0.5 left-0.5 h-3.5 w-3.5" />
              </span>
            </span>
          ))}
        </section>

        <section aria-hidden="true" className="flex flex-col gap-0.5 px-4 pt-3.5 pb-[22px]">
          <span className="flex h-10 w-full items-center gap-[11px] rounded-lg px-1.5 text-[13.5px] text-tui-ink2">
            <Eraser size={14} className="flex-none text-tui-ink3" />
            {t("clearHistory")}
          </span>
          <span className="flex h-10 w-full items-center gap-[11px] rounded-lg px-1.5 text-[13.5px] text-tui-danger">
            <LogOut size={14} className="flex-none" />
            {t("leaveConversation")}
          </span>
          <span className="flex flex-col px-1.5 pt-2">
            <span className="flex h-[18.5px] items-center">
              <Skeleton row={6} className="h-[7px] w-full" />
            </span>
            <span className="flex h-[18.5px] items-center">
              <Skeleton row={6} className="h-[7px] w-[58%]" />
            </span>
          </span>
        </section>
      </div>
    </aside>
  );
}

/**
 * The direct-message route skeleton: the same three columns `ChatShell`
 * draws. `threadOpen` mirrors the route — `/chat/[id]` shows the thread (and
 * the details pane at xl, where it opens by default), `/chat` the empty state.
 */
export function ChatShellSkeleton({ threadOpen }: { threadOpen: boolean }) {
  const t = useTranslations("skeleton");
  return (
    <div className="tui-screen flex h-full w-full gap-4 overflow-hidden p-2 text-tui-ink sm:px-6 sm:pt-5 sm:pb-6">
      <SkeletonStatus label={t("status")} />
      <div
        className={`${threadOpen ? "hidden lg:flex" : "flex"} min-h-0 w-full flex-none flex-col lg:w-[312px]`}
      >
        <ConversationRailSkeleton />
      </div>

      <section
        className={`${threadOpen ? "flex" : "hidden lg:flex"} ${CHAT_PANE} relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden`}
      >
        {threadOpen ? <ThreadSkeleton slow /> : <NoThreadSkeleton />}
      </section>

      {threadOpen && (
        <div className="hidden min-h-0 w-[296px] flex-none xl:flex xl:flex-col">
          <DetailsPaneSkeleton />
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Kairos AI console                                                  */
/* ================================================================== */

/**
 * AI thread rows, as `AiThreadRail` draws them: the title (13.5px, snug) and
 * the stamp line under it. The day group is data, so its stamp hatches too.
 */
export function AiThreadRowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="contents">
      <span className="flex h-[15px] items-center px-2 pt-1.5 pb-1.5 box-content">
        <Skeleton className="h-[6px] w-[44px]" />
      </span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-1.5 rounded-sm border-l-2 border-transparent px-2.5 py-2.5"
        >
          <span className="flex h-[18.5px] items-center">
            <Skeleton row={i} className="h-[9px]" style={{ width: skeletonWidth(i + 31, 48, 90) }} />
          </span>
          <span className="flex h-[14px] items-center">
            <Skeleton row={i} className="h-[6px]" style={{ width: skeletonWidth(i + 41, 30, 46) }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The whole AI thread rail — heading, New conversation, search real. */
export function AiThreadRailSkeleton() {
  const t = useTranslations("aiConsole");
  return (
    <aside className="kairos-console-rail flex h-full w-[284px] max-w-full shrink-0 flex-col border-r border-border-medium/60 bg-bg-surface">
      <div className="flex flex-col gap-3.5 border-b border-border-medium/60 px-[18px] pt-5 pb-3.5">
        <div className="flex items-center justify-between gap-2.5">
          <Stamp>{t("conversations")}</Stamp>
          <span className="flex items-center gap-2.5" aria-hidden="true">
            <Skeleton className="h-[7px] w-[14px]" />
            <span className="flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary">
              <PanelLeftClose className="h-[15px] w-[15px]" />
            </span>
          </span>
        </div>

        {/* The real button is a filled accent; while loading it is its
            outline, so the one loud thing on the page is not inert. */}
        <span
          aria-hidden="true"
          className="flex items-center justify-center gap-2 rounded-lg border border-accent-primary/45 px-3 py-[9px] text-[13px] font-semibold text-accent-primary"
        >
          <Plus className="h-[15px] w-[15px]" />
          {t("newConversation")}
        </span>

        <span
          aria-hidden="true"
          className="flex items-center gap-2.5 rounded-lg border border-border-medium/60 bg-bg-secondary px-2.5 py-2"
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-fg-tertiary">{t("searchConversations")}</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-2.5 py-3.5">
        <AiThreadRowsSkeleton />
      </div>

      <div className="kairos-stamp flex shrink-0 items-center justify-between gap-2 border-t border-border-medium/60 px-[18px] py-3.5 text-[10px] text-fg-tertiary">
        <Skeleton className="h-[6px] w-[96px]" />
        <span className="text-accent-primary" aria-hidden="true">
          {t("settings")}
        </span>
      </div>
    </aside>
  );
}

/**
 * The console thread while it restores: your turn (the raised card, accent
 * hatch) and the answer under its byline. Same paddings and 28px turn gap as
 * `ProjectIntelligenceChat` in its console variant.
 */
export function AiAnswerSkeleton({ slow = false }: { slow?: boolean }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-hidden px-6 py-7 lg:px-10"
      style={{ backgroundColor: "rgb(var(--bg-primary))" }}
    >
      <div className="flex h-full w-full flex-col gap-7">
        <div className="flex justify-end" aria-hidden="true">
          <Skeleton shape="bubble" tone="yours" className="h-[46px] w-[52%] max-w-[520px]" />
        </div>
        <div className="w-full max-w-[720px]" aria-hidden="true">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm bg-accent-primary/15 text-accent-primary">
              <Sparkles size={13} />
            </span>
            <Skeleton row={1} className="h-[9px] w-[96px]" />
            <Skeleton row={1} className="h-[6px] w-[60px]" />
          </div>
          <span className="flex flex-col">
            {[96, 88, 92, 74, 85, 46].map((w, i) => (
              <span key={i} className="flex h-[22.75px] items-center">
                <Skeleton row={2 + i * 0.5} className="h-[9px]" style={{ width: `${w}%` }} />
              </span>
            ))}
          </span>
        </div>
        {slow && <SkeletonSlow what="answer" />}
      </div>
    </div>
  );
}

/** The console composer, outline only. */
function AiComposerSkeleton() {
  const t = useTranslations("chat");
  const tc = useTranslations("aiConsole");
  return (
    <div className="w-full px-6 pt-4 pb-5 lg:px-10" aria-hidden="true">
      <div className="flex flex-col gap-3 rounded-md border border-border-medium/70 bg-bg-secondary px-3 py-2.5 opacity-60">
        <span className="block min-h-[24px] text-[14.5px] leading-relaxed text-fg-tertiary">
          {t("placeholder")}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {/* Agent, scope, effort: the menus are drawn, their picks hatch. */}
          {[64, 88, 52].map((w, i) => (
            <span
              key={i}
              className="flex h-8 items-center rounded-md border border-border-medium/70 px-2.5"
            >
              <Skeleton row={i} className="h-[7px]" style={{ width: w }} />
            </span>
          ))}
          <span
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: "rgb(var(--bg-tertiary))" }}
          >
            <ArrowUp size={15} />
          </span>
        </div>
      </div>
      <p className="mt-2.5 px-0.5 text-[11.5px] leading-relaxed text-fg-tertiary">
        {tc("composerDisclaimer")}
      </p>
    </div>
  );
}

/** The `/chat/ai` route skeleton: the same three columns `AIChatPageClient` draws. */
export function AiConsoleSkeleton() {
  const t = useTranslations("aiConsole");
  const tAgents = useTranslations("agents");
  const tDocs = useTranslations("documents");
  const tSkel = useTranslations("skeleton");

  const tabs = [
    [t("tabTrail"), ListTree],
    [tAgents("memory"), Brain],
    [tAgents("tools"), Wrench],
    [tDocs("tabShort"), FileText],
  ] as const;

  return (
    <div className="flex h-full min-h-0 w-full">
      <SkeletonStatus label={tSkel("status")} />
      <div className="hidden lg:flex">
        <AiThreadRailSkeleton />
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-border-medium/60 bg-bg-surface px-4 sm:gap-5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton shape="title" className="h-[13px] w-[180px]" />
          </div>
          <div className="flex shrink-0 items-center gap-2.5" aria-hidden="true">
            <span className="kairos-stamp flex items-center gap-1.5 rounded-sm border border-border-medium/70 px-2.5 py-1.5 text-[10px] text-fg-secondary opacity-40">
              <Trash2 className="h-3 w-3" />
              <span className="hidden sm:inline">{t("delete")}</span>
            </span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <AiAnswerSkeleton slow />
          <AiComposerSkeleton />
        </div>
      </main>

      <aside className="kairos-console-rail hidden w-[332px] shrink-0 flex-col border-l border-border-medium/60 bg-bg-surface xl:flex">
        <div className="flex shrink-0 gap-1.5 px-4 pt-3.5" aria-hidden="true">
          {tabs.map(([label, Icon], i) => (
            <span
              key={label}
              className={`kairos-stamp flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] ${
                i === 0 ? "bg-accent-primary/10 text-accent-primary" : "text-fg-tertiary"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </span>
          ))}
        </div>
        {/* No turn has run yet, so the trail's empty state is the real one. */}
        <div className="min-h-0 flex-1 overflow-hidden pt-1">
          <TurnTrailPanel events={[]} running={false} />
        </div>
      </aside>
    </div>
  );
}

/**
 * The console's right-rail cards (memory facts, documents) while they load:
 * the same `rounded-xl bg-bg-secondary` card, its text hatched — a 14px snug
 * line and the 11px meta line under it.
 */
export function RailCardsSkeleton({
  count = 3,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <ul aria-hidden="true" className={`space-y-1.5 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="rounded-xl bg-bg-secondary px-2.5 py-2">
          <span className="flex h-[22px] items-center">
            <Skeleton row={i} className="h-[9px]" style={{ width: skeletonWidth(i + 51, 52, 86) }} />
          </span>
          <span className="flex h-[16.5px] items-center pt-1 box-content">
            <Skeleton row={i} className="h-[7px]" style={{ width: skeletonWidth(i + 61, 28, 44) }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
