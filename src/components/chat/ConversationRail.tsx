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
import { BellOff, FolderKanban, Pencil, Search, X } from "~/components/ui/icons";

import { useSkeletonHold } from "~/hooks/useSkeletonHold";
import type { RouterOutputs } from "~/trpc/react";
import { ConversationRowsSkeleton } from "./ChatSkeletons";
import {
  Avatar,
  CHAT_EYEBROW,
  CHAT_ICON_BUTTON,
  CHAT_PANE,
  chatPill,
  displayName,
  formatRailTimestamp,
  type ChatUser,
} from "./chatUi";

type Conversation = RouterOutputs["chat"]["listAllConversations"][number];
type SearchHit = RouterOutputs["chat"]["searchMessages"][number];

export type RailFilter = "all" | "unread" | "projects" | "archived";

/** The second line of a row: what it says and how it is set. */
interface Preview {
  text: string;
  tone: "plain" | "accent" | "quiet";
}

export function ConversationRail({
  conversations,
  selectedId,
  userId,
  locale,
  workspaceName,
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
  draftOf,
  typingConversationIds,
  isLoading,
}: {
  conversations: Conversation[];
  selectedId: number | null;
  userId: string;
  locale: string;
  workspaceName: string;
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
  /** The saved draft for a conversation, or "" when there is none. */
  draftOf: (conversationId: number) => string;
  typingConversationIds: Set<number>;
  isLoading: boolean;
}) {
  const t = useTranslations("chat.direct");
  const showSkeleton = useSkeletonHold(isLoading);

  const otherOf = (convo: Conversation): ChatUser =>
    convo.userOne.id === userId ? convo.userTwo : convo.userOne;

  const unreadTotal = useMemo(
    () => conversations.filter((c) => !c.archived && c.unreadCount > 0).length,
    [conversations],
  );

  const activeCount = useMemo(
    () => conversations.filter((c) => !c.archived).length,
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
    <aside className={`${CHAT_PANE} flex h-full min-h-0 flex-col`} aria-label={t("conversations")}>
      <div className="flex flex-none items-end gap-3 px-[22px] pt-[26px] pb-[18px]">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <span className={`${CHAT_EYEBROW} truncate`}>{workspaceName}</span>
          <div className="flex items-baseline gap-2.5">
            <h1 className="m-0 font-display text-[46px] leading-none font-light tracking-[-0.02em] text-tui-ink">
              {t("chats")}
            </h1>
            <span className="font-display text-[22px] text-tui-ink3 tabular-nums">{activeCount}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onNewChat}
          aria-label={t("newChat")}
          title={t("newChat")}
          className={`${CHAT_ICON_BUTTON} h-9 w-9 text-tui-accent`}
        >
          <Pencil size={15} />
        </button>
      </div>

      <div className="flex-none px-4 pb-3">
        <label className="flex h-[38px] items-center gap-2.5 rounded-full border border-tui-ink/16 bg-tui-bg pr-2 pl-3.5 transition-colors focus-within:border-tui-accent/45">
          <Search size={14} className="flex-none text-tui-ink3" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("searchPeopleAndMessages")}
            aria-label={t("searchPeopleAndMessages")}
            data-chat-search
            className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-tui-ink outline-none placeholder:text-tui-ink3"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label={t("clearSearch")}
              className="kairos-tap grid h-6 w-6 flex-none place-items-center rounded-full text-tui-ink3 transition-colors hover:text-tui-ink"
            >
              <X size={12} />
            </button>
          )}
        </label>
      </div>

      <div
        className="flex flex-none flex-wrap gap-1.5 px-4 pb-3.5"
        role="tablist"
        aria-label={t("filterConversations")}
      >
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => onFilterChange(f.key)}
            className={`flex h-7 items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] font-medium whitespace-nowrap transition-colors ${chatPill(filter === f.key)}`}
          >
            {f.label}
            {f.count ? <span className="text-[11.5px] tabular-nums opacity-80">{f.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="mx-4 h-px flex-none bg-tui-ink/8" />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pt-2.5 pb-3.5">
        {showSkeleton ? (
          <ConversationRowsSkeleton />
        ) : visible.length === 0 && searchHits.length === 0 ? (
          <EmptyRail query={query} filter={filter} isSearching={isSearching} />
        ) : (
          <>
            {visible.length > 0 && (
              <ul className="flex flex-col gap-0.5" aria-label={t("conversations")}>
                {visible.map((convo) => {
                  const other = otherOf(convo);
                  const selected = convo.id === selectedId;
                  const typing = typingConversationIds.has(convo.id);
                  /* The open thread's draft is in the composer right under the
                     reader's eyes; repeating it on the row is noise. */
                  const draft = selected ? "" : draftOf(convo.id).trim();
                  const preview = previewFor(convo, userId, t, draft, typing);
                  const loud = convo.unreadCount > 0 && !convo.muted;

                  return (
                    <li key={convo.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(convo.id)}
                        aria-current={selected ? "true" : undefined}
                        className={`flex w-full items-start gap-3 rounded-lg p-3 text-left text-tui-ink transition-colors ${
                          selected ? "bg-tui-accent/15" : "hover:bg-tui-accent/6"
                        }`}
                      >
                        <Avatar
                          user={other}
                          size="md"
                          online={isOnline(other.id)}
                          fallbackLabel={t("userFallback")}
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <span className="flex items-baseline gap-2">
                            <span
                              className={`min-w-0 flex-1 truncate text-[14.5px] ${loud ? "font-semibold" : "font-medium"}`}
                            >
                              {displayName(other, t("userFallback"))}
                            </span>
                            {convo.muted && (
                              <BellOff size={12} className="flex-none text-tui-ink3" aria-label={t("muted")} />
                            )}
                            <span className="flex-none text-[11.5px] text-tui-ink3 tabular-nums">
                              {formatRailTimestamp(
                                new Date(convo.lastMessage?.createdAt ?? convo.lastMessageAt),
                                locale,
                                { yesterday: t("yesterday") },
                              )}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span
                              className={`min-w-0 flex-1 truncate text-[13px] leading-[1.4] ${
                                preview.tone === "accent"
                                  ? `text-tui-accent ${typing ? "italic" : ""}`
                                  : preview.tone === "quiet"
                                    ? "text-tui-ink3 italic"
                                    : loud
                                      ? "font-medium text-tui-ink"
                                      : "text-tui-ink2"
                              }`}
                            >
                              {preview.text}
                            </span>
                            {convo.unreadCount > 0 && (
                              <span
                                className={`flex h-5 min-w-5 flex-none items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold tabular-nums ${
                                  convo.muted
                                    ? "border-tui-ink/16 bg-transparent text-tui-ink3"
                                    : "border-tui-accent bg-tui-accent text-tui-on-accent"
                                }`}
                              >
                                {convo.unreadCount > 99 ? "99+" : convo.unreadCount}
                              </span>
                            )}
                          </span>
                          {convo.projectTitle && (
                            <span className="mt-[5px] flex h-[22px] max-w-full items-center gap-1.5 self-start rounded-full border border-tui-ink/16 px-[9px] text-[11.5px] text-tui-ink2">
                              <FolderKanban size={11} className="flex-none text-tui-ink3" />
                              <span className="truncate">{convo.projectTitle}</span>
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
              <div className="mt-2 flex flex-col border-t border-tui-ink/8">
                <p className={`${CHAT_EYEBROW} px-3 pt-[18px] pb-2`}>{t("inMessages")}</p>
                <ul className="flex flex-col gap-0.5">
                  {searchHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => onSelectSearchHit(hit)}
                        className="flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left text-tui-ink transition-colors hover:bg-tui-accent/6"
                      >
                        <span className="flex gap-2 text-[12.5px]">
                          <span className="flex-1 truncate font-medium text-tui-ink2">
                            {hit.senderName ?? t("userFallback")}
                          </span>
                          <span className="text-tui-ink3 tabular-nums">
                            {formatRailTimestamp(new Date(hit.createdAt), locale, { yesterday: t("yesterday") })}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-[13px] leading-normal text-tui-ink2">{hit.body}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isSearching && (
              <p className="px-3 py-2 text-[12.5px] text-tui-ink3">{t("searching")}</p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/** The second line of a rail row, in priority order. */
function previewFor(
  convo: Conversation,
  userId: string,
  t: ReturnType<typeof useTranslations<"chat.direct">>,
  draft: string,
  typing: boolean,
): Preview {
  if (typing) return { text: t("typing"), tone: "accent" };
  if (draft) return { text: `${t("draftPreview")} · ${draft}`, tone: "accent" };
  const last = convo.lastMessage;
  if (!last) return { text: t("noMessagesYet"), tone: "quiet" };
  if (last.deleted) return { text: t("messageDeleted"), tone: "quiet" };

  const body = last.body.trim().length > 0 ? last.body : last.attachmentName ?? t("attachment");
  return { text: last.senderId === userId ? t("youPrefix", { body }) : body, tone: "plain" };
}

function EmptyRail({
  query,
  filter,
  isSearching,
}: {
  query: string;
  filter: RailFilter;
  isSearching: boolean;
}) {
  const t = useTranslations("chat.direct");

  const text = query.trim()
    ? isSearching
      ? t("searching")
      : t("noResultsFor", { query: query.trim() })
    : filter === "unread"
      ? t("noUnread")
      : filter === "projects"
        ? t("noProjectConversations")
        : filter === "archived"
          ? t("noArchived")
          : t("noConversationsYet");

  return (
    <p className="px-3.5 py-7 text-center text-[13.5px] leading-[1.55] text-tui-ink3">{text}</p>
  );
}
