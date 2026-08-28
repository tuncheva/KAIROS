"use client";

/**
 * The conversation list.
 *
 * The old rail showed each contact's name with their email underneath — the
 * email being information the name already carried. Every row now spends that
 * second line on state instead: who spoke last, what they said, whether it is
 * unread, whether a draft is waiting, whether the thread is muted, and which
 * project it came from.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { BellOff, MessageCircle, Plus, Search, X } from "~/components/ui/icons";

import type { RouterOutputs } from "~/trpc/react";
import { Avatar, displayName, formatRailTimestamp, type ChatUser } from "./chatUi";

type Conversation = RouterOutputs["chat"]["listAllConversations"][number];
type SearchHit = RouterOutputs["chat"]["searchMessages"][number];

export type RailFilter = "all" | "unread" | "projects" | "archived";

export function ConversationRail({
  conversations,
  selectedId,
  userId,
  locale,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  searchHits,
  isSearching,
  onSelect,
  onSelectSearchHit,
  onNewChat,
  isOnline,
  hasDraft,
  typingConversationIds,
  isLoading,
}: {
  conversations: Conversation[];
  selectedId: number | null;
  userId: string;
  locale: string;
  query: string;
  onQueryChange: (next: string) => void;
  filter: RailFilter;
  onFilterChange: (next: RailFilter) => void;
  searchHits: SearchHit[];
  isSearching: boolean;
  onSelect: (conversationId: number) => void;
  onSelectSearchHit: (hit: SearchHit) => void;
  onNewChat: () => void;
  isOnline: (userId: string | null | undefined) => boolean;
  hasDraft: (conversationId: number) => boolean;
  typingConversationIds: Set<number>;
  isLoading: boolean;
}) {
  const t = useTranslations("chat.direct");

  const otherOf = (convo: Conversation): ChatUser =>
    convo.userOne.id === userId ? convo.userTwo : convo.userOne;

  const unreadTotal = useMemo(
    () => conversations.filter((c) => !c.archived && c.unreadCount > 0).length,
    [conversations],
  );

  /* Name matching stays on the client so the list narrows as you type; message
     bodies are searched on the server, because the client only holds the last
     message of each thread. The two results are shown in separate sections. */
  const visible = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return conversations
      .filter((convo) => {
        if (filter === "archived") return convo.archived;
        if (convo.archived) return false;
        if (filter === "unread") return convo.unreadCount > 0;
        if (filter === "projects") return convo.projectId !== null;
        return true;
      })
      .filter((convo) => {
        if (!trimmed) return true;
        const other = otherOf(convo);
        return (
          (other.name?.toLowerCase() ?? "").includes(trimmed) ||
          (other.email?.toLowerCase() ?? "").includes(trimmed)
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, filter, query, userId]);

  const filters: Array<{ key: RailFilter; label: string; count?: number }> = [
    { key: "all", label: t("filterAll") },
    { key: "unread", label: t("filterUnread"), count: unreadTotal },
    { key: "projects", label: t("filterProjects") },
    { key: "archived", label: t("filterArchived") },
  ];

  return (
    <div className="flex flex-col h-full bg-bg-surface border-r border-border-light/40">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 flex-none">
        <h1 className="flex-1 text-xl font-bold text-fg-primary">{t("messages")}</h1>
        <button
          type="button"
          onClick={onNewChat}
          aria-label={t("newChat")}
          title={t("newChat")}
          className="p-2.5 rounded-xl bg-gradient-to-br from-accent-primary to-accent-secondary text-white shadow-accent hover:brightness-110 transition-all"
        >
          <Plus size={17} />
        </button>
      </div>

      <div className="px-4 pb-2.5 flex-none">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary pointer-events-none" size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("searchPeopleAndMessages")}
            aria-label={t("searchPeopleAndMessages")}
            className="w-full pl-9 pr-9 py-2.5 text-sm bg-bg-secondary rounded-xl text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label={t("clearSearch")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-fg-tertiary hover:text-fg-primary transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 px-4 pb-2.5 flex-none overflow-x-auto" role="tablist" aria-label={t("filterConversations")}>
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => onFilterChange(f.key)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap transition-colors ${
              filter === f.key
                ? "bg-accent-primary/12 text-accent-primary ring-1 ring-accent-primary/30"
                : "bg-bg-secondary text-fg-tertiary hover:text-fg-secondary"
            }`}
          >
            {f.label}
            {f.count ? <span className="ml-1.5 tabular-nums">{f.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-2" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 p-2.5">
                <div className="w-[38px] h-[38px] rounded-full bg-bg-secondary animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 rounded bg-bg-secondary animate-pulse" />
                  <div className="h-2.5 w-3/4 rounded bg-bg-secondary animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 && searchHits.length === 0 ? (
          <EmptyRail
            query={query}
            filter={filter}
            isSearching={isSearching}
            onNewChat={onNewChat}
          />
        ) : (
          <>
            {visible.length > 0 && (
              <ul className="flex flex-col gap-0.5" aria-label={t("conversations")}>
                {visible.map((convo) => {
                  const other = otherOf(convo);
                  const selected = convo.id === selectedId;
                  const typing = typingConversationIds.has(convo.id);
                  const draft = hasDraft(convo.id);
                  const preview = previewFor(convo, userId, t, draft, typing);

                  return (
                    <li key={convo.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(convo.id)}
                        aria-current={selected ? "true" : undefined}
                        className={`w-full flex items-start gap-3 p-2.5 rounded-xl text-left transition-colors ${
                          selected
                            ? "bg-accent-primary/10 ring-1 ring-accent-primary/25"
                            : "hover:bg-bg-secondary"
                        }`}
                      >
                        <Avatar
                          user={other}
                          size="md"
                          online={isOnline(other.id)}
                          fallbackLabel={t("userFallback")}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-baseline gap-2">
                            <span className="flex-1 text-sm font-semibold text-fg-primary truncate">
                              {displayName(other, t("userFallback"))}
                            </span>
                            {convo.muted && (
                              <BellOff size={12} className="text-fg-quaternary flex-shrink-0" aria-label={t("muted")} />
                            )}
                            <span className="text-[10px] text-fg-quaternary tabular-nums flex-shrink-0">
                              {formatRailTimestamp(
                                new Date(convo.lastMessage?.createdAt ?? convo.lastMessageAt),
                                locale,
                                { yesterday: t("yesterday") },
                              )}
                            </span>
                          </span>
                          <span className="flex items-center gap-2 mt-0.5">
                            <span
                              className={`flex-1 text-xs truncate ${
                                convo.unreadCount > 0 && !convo.muted
                                  ? "text-fg-primary font-semibold"
                                  : "text-fg-tertiary"
                              }`}
                            >
                              {preview}
                            </span>
                            {convo.unreadCount > 0 && (
                              <span
                                className={`min-w-[19px] h-[19px] px-1.5 grid place-items-center rounded-full text-[10px] font-bold tabular-nums flex-shrink-0 ${
                                  convo.muted
                                    ? "bg-bg-tertiary text-fg-tertiary"
                                    : "bg-accent-primary text-white"
                                }`}
                              >
                                {convo.unreadCount > 99 ? "99+" : convo.unreadCount}
                              </span>
                            )}
                          </span>
                          {convo.projectTitle && (
                            <span className="inline-flex mt-1.5 px-1.5 py-0.5 rounded text-[9.5px] font-semibold uppercase tracking-wide bg-info/12 text-info">
                              {convo.projectTitle}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {searchHits.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border-light/40">
                <p className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-widest text-fg-quaternary">
                  {t("inMessages")}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {searchHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => onSelectSearchHit(hit)}
                        className="w-full text-left p-2.5 rounded-xl hover:bg-bg-secondary transition-colors"
                      >
                        <span className="flex items-baseline gap-2">
                          <span className="flex-1 text-xs font-semibold text-fg-secondary truncate">
                            {hit.senderName ?? t("userFallback")}
                          </span>
                          <span className="text-[10px] text-fg-quaternary tabular-nums">
                            {formatRailTimestamp(new Date(hit.createdAt), locale, { yesterday: t("yesterday") })}
                          </span>
                        </span>
                        <span className="block mt-0.5 text-xs text-fg-tertiary line-clamp-2">{hit.body}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isSearching && (
              <p className="px-3 py-2 text-xs text-fg-quaternary">{t("searching")}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The second line of a rail row, in priority order. */
function previewFor(
  convo: Conversation,
  userId: string,
  t: ReturnType<typeof useTranslations<"chat.direct">>,
  draft: boolean,
  typing: boolean,
): string {
  if (typing) return t("typing");
  if (draft) return t("draftPreview");
  const last = convo.lastMessage;
  if (!last) return t("noMessagesYet");
  if (last.deleted) return t("messageDeleted");

  const body = last.body.trim().length > 0 ? last.body : last.attachmentName ?? t("attachment");
  return last.senderId === userId ? t("youPrefix", { body }) : body;
}

function EmptyRail({
  query,
  filter,
  isSearching,
  onNewChat,
}: {
  query: string;
  filter: RailFilter;
  isSearching: boolean;
  onNewChat: () => void;
}) {
  const t = useTranslations("chat.direct");

  if (query.trim()) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <p className="text-sm text-fg-secondary">
          {isSearching ? t("searching") : t("noResultsFor", { query })}
        </p>
      </div>
    );
  }

  if (filter !== "all") {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <p className="text-sm text-fg-secondary">
          {filter === "unread"
            ? t("noUnread")
            : filter === "projects"
              ? t("noProjectConversations")
              : t("noArchived")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-full bg-accent-primary/10 grid place-items-center mb-3">
        <MessageCircle size={24} className="text-accent-primary" />
      </div>
      <p className="text-sm font-semibold text-fg-primary mb-1">{t("noConversationsYet")}</p>
      <p className="text-xs text-fg-tertiary mb-4">{t("startNewChatToGetStarted")}</p>
      <button
        type="button"
        onClick={onNewChat}
        className="px-4 py-2 rounded-lg bg-accent-primary/10 text-accent-primary text-sm font-semibold hover:bg-accent-primary/20 transition-colors"
      >
        {t("startNewChat")}
      </button>
    </div>
  );
}
