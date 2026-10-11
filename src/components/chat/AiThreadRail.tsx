"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PanelLeftClose, Plus, Search, X } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import { useDateFormat } from "~/hooks/useDateFormat";
import { useSkeletonHold } from "~/hooks/useSkeletonHold";
import { api } from "~/trpc/react";
import { CHAT_EYEBROW, CHAT_ICON_BUTTON, CHAT_PANE } from "./chatUi";
import { AiThreadRowsSkeleton } from "./ChatSkeletons";

export interface ConversationRow {
  id: string;
  title: string | null;
  projectId: number | null;
  updatedAt: Date;
  messageCount: number;
}

interface Props {
  conversations: ConversationRow[];
  loading: boolean;
  /** `null` while a brand-new, unsent thread is on screen. */
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onCollapse: () => void;
  /** `sheet` sits inside a `ConsoleDrawer`, which already draws the pane. */
  variant?: "column" | "sheet";
}

/**
 * The AI console's thread list.
 *
 * Named `AiThreadRail` rather than `ConversationsRail`, which sat one letter
 * away from `ConversationRail` — the direct-message list — and read as a
 * duplicate of it. They are not: that rail lists people-to-people threads from
 * `chat.listAllConversations` with avatars, presence, drafts and typing state;
 * this one lists AI console threads keyed by string id, grouped by day, with
 * server-side message search. Merging them would mean merging two data models,
 * so the names were made to say which is which instead.
 *
 * Grouped by day rather than shown as one flat run: a conversation is looked up
 * by roughly when it happened ("the rebrand one from yesterday"), not by its
 * position in a list of thirty. The groups are computed from the row's own
 * `updatedAt` against the viewer's local midnight, so a thread does not sit
 * under "Today" because the server is in a different timezone.
 *
 * Search does two things at once, and the split matters.
 *
 * Typing filters the thirty loaded threads by **title**, on the client — that is
 * instant, and it is what someone wants when they half-remember a thread name.
 * But a title only exists because it was generated from the first exchange, so
 * "where did we discuss the invoice export" frequently matches nothing while the
 * answer sits in a message six threads back.
 *
 * So past three characters it also queries `agent.searchMessages`, which is
 * full-text over every message the account still retains. Those results appear
 * under their own heading rather than mixed in, because "this thread is called
 * that" and "this thread contains that" are different claims and only one of them
 * shows the matched words.
 *
 * This is also the half of unlimited history that a Pro user can actually feel:
 * keeping every message earns nothing if the only route back is scrolling.
 */
export function AiThreadRail({
  conversations,
  loading,
  activeId,
  onSelect,
  onNew,
  onCollapse,
  variant = "column",
}: Props) {
  const t = useTranslations("aiConsole");
  const { formatDate } = useDateFormat();
  const [query, setQuery] = useState("");
  const showSkeleton = useSkeletonHold(loading);

  /**
   * The query, held back from the server.
   *
   * The title filter runs on every keystroke because it is a local array scan.
   * The message search is a full-text query, so it waits for the typing to stop —
   * without this, "invoice" is eight queries and seven of them are discarded.
   */
  const deferredQuery = useDeferredQuery(query, 250);

  const messageHits = api.agent.searchMessages.useQuery(
    { query: deferredQuery, limit: 8 },
    {
      // Three characters is where a full-text match stops being noise. Below it
      // nearly every thread matches and the section is worse than absent.
      enabled: deferredQuery.trim().length >= 3,
      retry: false,
      staleTime: 30_000,
    },
  );

  const quota = api.agent.rateLimitStatus.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const groups = useMemo(
    () => groupByDay(conversations, query),
    [conversations, query],
  );

  const inMessages = useMemo(() => {
    const hits = messageHits.data ?? [];
    const alreadyShown = new Set(
      groups.flatMap((g) => g.rows.map((r) => r.id)),
    );

    // One row per conversation: several messages in one thread matching is still
    // one place to go, and listing each would crowd out the other threads.
    const seen = new Set<string>();
    return hits.filter((hit) => {
      if (alreadyShown.has(hit.conversationId)) return false;
      if (seen.has(hit.conversationId)) return false;
      seen.add(hit.conversationId);
      return true;
    });
  }, [messageHits.data, groups]);

  return (
    <aside
      className={`${variant === "column" ? `${CHAT_PANE} kairos-console-rail` : ""} flex h-full min-h-0 w-full flex-col`}
      aria-label={t("conversations")}
    >
      {/* The collapse sits on the eyebrow line so the title keeps the width;
          the one loud control, a new thread, sits beside the title. */}
      <div className="flex flex-none flex-col gap-2.5 px-[22px] pt-[22px] pb-[18px]">
        <div className="flex items-center gap-2">
          <span className={`${CHAT_EYEBROW} min-w-0 flex-1 truncate`}>{t("askKairos")}</span>
          <button
            type="button"
            onClick={onCollapse}
            title={t("hideConversations")}
            aria-label={t("hideConversations")}
            className="kairos-tap -my-1 grid h-7 w-7 flex-none place-items-center rounded-full text-tui-ink3 transition-colors hover:bg-tui-accent/6 hover:text-tui-ink"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <h2 className="m-0 truncate font-display text-[28px] leading-none font-light tracking-[-0.02em] text-tui-ink">
              {t("conversations")}
            </h2>
            <span className="flex-none font-display text-[18px] text-tui-ink3 tabular-nums">
              {conversations.length}
            </span>
          </div>
        <button
          type="button"
          onClick={onNew}
          data-testid="new-conversation"
          title={t("newConversation")}
          aria-label={t("newConversation")}
          className={`${CHAT_ICON_BUTTON} h-9 w-9 text-tui-accent`}
        >
          <Plus size={15} />
        </button>
        </div>
      </div>

      <div className="flex-none px-4 pb-3.5">
        <label className="flex h-[38px] items-center gap-2.5 rounded-full border border-tui-ink/16 bg-tui-bg pr-2 pl-3.5 transition-colors focus-within:border-tui-accent/45">
          <Search size={14} className="flex-none text-tui-ink3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchConversations")}
            aria-label={t("searchConversations")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-tui-ink outline-none placeholder:text-tui-ink3"
          />
          {/* The only search box in the app that had no clear of its own, and
              was relying on WebKit's — which is now suppressed for being
              off-palette and doubled up everywhere else. */}
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("clearSearch")}
              className="kairos-tap grid h-6 w-6 flex-none place-items-center rounded-full text-tui-ink3 transition-colors hover:text-tui-ink"
            >
              <X size={12} />
            </button>
          )}
        </label>
      </div>

      <div className="mx-4 h-px flex-none bg-tui-ink/8" />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pt-1 pb-3.5">
        {showSkeleton && conversations.length === 0 ? (
          <AiThreadRowsSkeleton />
        ) : groups.length === 0 ? (
          <p className="px-3.5 py-7 text-center text-[13.5px] leading-[1.55] text-tui-ink3">
            {query ? t("noMatches") : t("noConversations")}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="contents">
              <p className={`${CHAT_EYEBROW} px-3 pt-[18px] pb-2`}>
                {group.key === "today"
                  ? t("today")
                  : group.key === "yesterday"
                    ? t("yesterday")
                    : t("earlier")}
              </p>

              {group.rows.map((row) => {
                const active = row.id === activeId;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onSelect(row.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full flex-col gap-[3px] rounded-lg px-3 py-2.5 text-left text-tui-ink transition-colors ${
                      active ? "bg-tui-accent/15" : "hover:bg-tui-accent/6"
                    }`}
                  >
                    <span
                      className={`line-clamp-2 text-[14px] leading-snug ${
                        active ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {row.title?.trim() ?? t("untitledConversation")}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11.5px] text-tui-ink3 tabular-nums">
                      {t("messageCount", { count: row.messageCount })}
                      <span aria-hidden>·</span>
                      {formatTimestamp(row.updatedAt, formatDate)}
                    </span>
                  </button>
                );
              })}
            </section>
          ))
        )}

        {/*
          Message matches, under their own heading. Threads already shown by the
          title filter are excluded — the same thread appearing in both sections
          reads as a duplicate rather than as two kinds of match.
        */}
        {inMessages.length > 0 ? (
          <div className="mt-2 flex flex-col border-t border-tui-ink/8">
            <p className={`${CHAT_EYEBROW} px-3 pt-[18px] pb-2`}>{t("inMessages")}</p>
            {inMessages.map((hit) => (
              <button
                key={`${hit.conversationId}-${hit.createdAt.toISOString()}`}
                type="button"
                onClick={() => onSelect(hit.conversationId)}
                className="flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left text-tui-ink transition-colors hover:bg-tui-accent/6"
              >
                <span className="line-clamp-1 text-[12.5px] font-medium text-tui-ink2">
                  {hit.conversationTitle?.trim() ?? t("untitledConversation")}
                </span>
                <span className="line-clamp-2 text-[13px] leading-normal text-tui-ink2">
                  {snippetAround(hit.content, query)}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-none items-center justify-between gap-2 border-t border-tui-ink/8 px-[22px] py-3.5 text-[12px] text-tui-ink3 tabular-nums">
        <span>
          {quota.data
            ? t("requestsToday", {
                used: quota.data.limit - quota.data.remaining,
                limit: quota.data.limit,
              })
            : "—"}
        </span>
        <Link
          href="/settings"
          className="font-medium text-tui-accent transition-opacity hover:opacity-80"
        >
          {t("settings")}
        </Link>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Grouping                                                           */
/* ------------------------------------------------------------------ */

type GroupKey = "today" | "yesterday" | "earlier";

function startOfLocalDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupByDay(
  rows: ConversationRow[],
  query: string,
): Array<{ key: GroupKey; rows: ConversationRow[] }> {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((r) => (r.title ?? "").toLowerCase().includes(needle))
    : rows;

  const today = startOfLocalDay(new Date());
  const yesterday = today - 86_400_000;

  const buckets: Record<GroupKey, ConversationRow[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const row of filtered) {
    const day = startOfLocalDay(new Date(row.updatedAt));
    if (day >= today) buckets.today.push(row);
    else if (day >= yesterday) buckets.yesterday.push(row);
    else buckets.earlier.push(row);
  }

  return (["today", "yesterday", "earlier"] as const)
    .map((key) => ({ key, rows: buckets[key] }))
    .filter((g) => g.rows.length > 0);
}

/** Time of day for anything from today, a date for anything older. */
function formatTimestamp(
  value: Date,
  formatDate: (d: Date, style?: "short") => string,
): string {
  const date = new Date(value);
  if (startOfLocalDay(date) >= startOfLocalDay(new Date())) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return formatDate(date, "short");
}

/**
 * A value that trails its input until typing stops.
 *
 * Local rather than a shared hook: this is the only place in the app that needs
 * it, and a debounce whose delay is tuned to one query does not generalise well.
 */
function useDeferredQuery(value: string, delayMs: number): string {
  const [deferred, setDeferred] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDeferred(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return deferred;
}

/**
 * A window of message text around the match.
 *
 * A message can be a page long, and the first 120 characters of it usually do not
 * contain the words the user searched for — which makes the snippet look like a
 * mis-hit. Centring on the match is what makes the result legible.
 *
 * Falls back to the head of the message when the term is not found verbatim:
 * Postgres matched on a normalised token, so the raw substring may genuinely be
 * absent.
 */
function snippetAround(content: string, query: string, width = 140): string {
  const term = query.trim().split(/\s+/)[0] ?? "";
  const at = term ? content.toLowerCase().indexOf(term.toLowerCase()) : -1;

  if (at < 0) {
    return content.length > width ? `${content.slice(0, width)}…` : content;
  }

  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(content.length, start + width);

  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}
