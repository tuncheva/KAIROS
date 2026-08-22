"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PanelLeftClose, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { useDateFormat } from "~/hooks/useDateFormat";
import { api } from "~/trpc/react";

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
}

/**
 * The thread list.
 *
 * Grouped by day rather than shown as one flat run: a conversation is looked up
 * by roughly when it happened ("the rebrand one from yesterday"), not by its
 * position in a list of thirty. The groups are computed from the row's own
 * `updatedAt` against the viewer's local midnight, so a thread does not sit
 * under "Today" because the server is in a different timezone.
 *
 * Search filters the rows already loaded rather than querying the server. The
 * list is capped at thirty threads, so everything the filter could match is
 * already on the client, and a round trip per keystroke would buy nothing.
 */
export function ConversationsRail({
  conversations,
  loading,
  activeId,
  onSelect,
  onNew,
  onCollapse,
}: Props) {
  const t = useTranslations("aiConsole");
  const { formatDate } = useDateFormat();
  const [query, setQuery] = useState("");

  const quota = api.agent.rateLimitStatus.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const groups = useMemo(
    () => groupByDay(conversations, query),
    [conversations, query],
  );

  return (
    <aside className="kairos-console-rail flex h-full w-[284px] shrink-0 flex-col border-r border-border-medium/60 bg-bg-surface">
      <div className="flex flex-col gap-3.5 border-b border-border-medium/60 px-[18px] pt-5 pb-3.5">
        <div className="flex items-center justify-between gap-2.5">
          <span className="kairos-stamp text-[10px] text-fg-tertiary">
            {t("conversations")}
          </span>
          <span className="flex items-center gap-2.5">
            <span className="kairos-mono text-[10px] text-fg-tertiary">
              {conversations.length}
            </span>
            <button
              type="button"
              onClick={onCollapse}
              title={t("hideConversations")}
              aria-label={t("hideConversations")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
            >
              <PanelLeftClose className="h-[15px] w-[15px]" />
            </button>
          </span>
        </div>

        <button
          type="button"
          onClick={onNew}
          data-testid="new-conversation"
          className="flex items-center justify-center gap-2 rounded-lg bg-accent-primary px-3 py-2.5 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110"
        >
          <Plus className="h-[15px] w-[15px]" />
          {t("newConversation")}
        </button>

        <label className="flex items-center gap-2.5 rounded-lg border border-border-medium/60 bg-bg-secondary px-2.5 py-2 focus-within:border-accent-primary/50">
          <Search className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchConversations")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg-primary placeholder:text-fg-tertiary focus:outline-none"
          />
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 py-3.5">
        {loading && conversations.length === 0 ? (
          <p className="px-2 py-4 text-xs text-fg-tertiary">{t("loading")}</p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-4 text-xs leading-relaxed text-fg-tertiary">
            {query ? t("noMatches") : t("noConversations")}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="contents">
              <span className="kairos-stamp px-2 pt-3 pb-1.5 text-[10px] text-fg-tertiary first:pt-1.5">
                {group.key === "today"
                  ? t("today")
                  : group.key === "yesterday"
                    ? t("yesterday")
                    : t("earlier")}
              </span>

              {group.rows.map((row) => {
                const active = row.id === activeId;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onSelect(row.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex flex-col gap-1.5 rounded-[9px] px-2.5 py-2.5 text-left transition-colors ${
                      active
                        ? "border-l-2 border-accent-primary bg-accent-primary/10"
                        : "border-l-2 border-transparent hover:bg-bg-tertiary/70"
                    }`}
                  >
                    <span
                      className={`line-clamp-2 text-[13.5px] leading-snug ${
                        active
                          ? "font-semibold text-fg-primary"
                          : "font-medium text-fg-secondary"
                      }`}
                    >
                      {row.title?.trim() ?? t("untitledConversation")}
                    </span>
                    <span className="kairos-stamp flex items-center gap-1.5 text-[9.5px] text-fg-tertiary">
                      {t("messageCount", { count: row.messageCount })}
                      <span aria-hidden>·</span>
                      <span className="normal-case tracking-normal">
                        {formatTimestamp(row.updatedAt, formatDate)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))
        )}
      </div>

      <div className="kairos-stamp flex shrink-0 items-center justify-between gap-2 border-t border-border-medium/60 px-[18px] py-3.5 text-[10px] text-fg-tertiary">
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
          className="text-accent-primary transition-opacity hover:opacity-80"
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
