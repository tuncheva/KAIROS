"use client";

/**
 * The message list.
 *
 * Three things it owns that the old flat list did not:
 *
 *  - **Grouping.** Messages are broken into runs by sender and by calendar day,
 *    so a burst reads as one block under one avatar with one date separator.
 *  - **The unread divider.** Anchored to where the read pointer was *when the
 *    thread opened*, held in a ref. Following the live pointer instead would
 *    make the divider climb the screen as messages are marked read, which is
 *    exactly when the user is trying to read from it.
 *  - **Scroll intent.** New messages only pull the view down if the reader was
 *    already at the bottom; someone scrolled up reading history is left alone.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, Loader2, MessageSquare } from "lucide-react";

import { formatDayLabel, isSameDay, type ChatUser } from "./chatUi";
import { MessageBubble, type SendStatus, type ThreadMessage } from "./MessageBubble";

/** Distance from the bottom, in px, still treated as "at the bottom". */
const AT_BOTTOM_SLOP = 80;
/** Distance from the top that triggers loading the previous page. */
const LOAD_MORE_SLOP = 120;

export function MessageThread({
  messages,
  userId,
  locale,
  peerLastReadId,
  unreadAfterId,
  statusOf,
  participants,
  peerTyping,
  peerName,
  hasPreviousPage,
  isFetchingPreviousPage,
  onLoadPrevious,
  onVisibleNewest,
  onReply,
  onToggleReaction,
  onEdit,
  onDelete,
  onTogglePin,
  onRetry,
  onDiscard,
  highlightedId,
  onJumpToMessage,
  isLoading,
}: {
  messages: ThreadMessage[];
  userId: string;
  locale: string;
  /** How far the other participant has read — drives the "Seen" receipt. */
  peerLastReadId: number;
  /**
   * How far *this* user had read when the thread was opened, frozen by the
   * shell. The divider is drawn after it. Following the live pointer instead
   * would walk the divider up the screen as messages are marked read — which is
   * precisely when the reader is using it to find their place.
   */
  unreadAfterId: number | null;
  statusOf: (message: ThreadMessage) => SendStatus;
  participants: Map<string, ChatUser>;
  peerTyping: boolean;
  peerName: string;
  hasPreviousPage: boolean;
  isFetchingPreviousPage: boolean;
  onLoadPrevious: () => void;
  onVisibleNewest: (messageId: number) => void;
  onReply: (message: ThreadMessage) => void;
  onToggleReaction: (messageId: number, emoji: string) => void;
  onEdit: (messageId: number, body: string) => void;
  onDelete: (messageId: number) => void;
  onTogglePin: (messageId: number) => void;
  onRetry: (messageId: number) => void;
  onDiscard: (messageId: number) => void;
  highlightedId: number | null;
  onJumpToMessage: (messageId: number) => void;
  isLoading: boolean;
}) {
  const t = useTranslations("chat.direct");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const previousCountRef = useRef(0);
  const scrollAnchorRef = useRef<number | null>(null);

  const newestId = messages.length > 0 ? messages[messages.length - 1]!.id : null;

  const isAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_SLOP;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = isAtBottom();

    if (el.scrollTop < LOAD_MORE_SLOP && hasPreviousPage && !isFetchingPreviousPage) {
      /* Remember the height before the prepend so the view can be pinned to the
         same message afterwards instead of jumping to the top. */
      scrollAnchorRef.current = el.scrollHeight;
      onLoadPrevious();
    }

    /* Reaching the bottom is what marks the thread read. */
    if (atBottomRef.current && newestId !== null) onVisibleNewest(newestId);
  }, [hasPreviousPage, isFetchingPreviousPage, isAtBottom, newestId, onLoadPrevious, onVisibleNewest]);

  /* Restore the scroll position after a page of history is prepended. Layout
     effect, not effect: this has to happen before the browser paints, or the
     jump to the top is visible. */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || scrollAnchorRef.current === null) return;
    if (el.scrollHeight === scrollAnchorRef.current) return;
    el.scrollTop = el.scrollHeight - scrollAnchorRef.current;
    scrollAnchorRef.current = null;
  }, [messages.length]);

  useEffect(() => {
    const grew = messages.length > previousCountRef.current;
    const first = previousCountRef.current === 0 && messages.length > 0;
    previousCountRef.current = messages.length;

    if (first) {
      scrollToBottom();
      if (newestId !== null) onVisibleNewest(newestId);
      return;
    }
    /* Appended (not prepended) and the reader was at the bottom. */
    if (grew && atBottomRef.current && scrollAnchorRef.current === null) {
      scrollToBottom("smooth");
      if (newestId !== null) onVisibleNewest(newestId);
    }
  }, [messages.length, newestId, onVisibleNewest, scrollToBottom]);

  if (isLoading) {
    return (
      <div className="flex-1 grid place-items-center" aria-busy="true">
        <Loader2 className="animate-spin text-accent-primary" size={22} />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 grid place-items-center px-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-accent-primary/10 grid place-items-center mx-auto mb-3">
            <MessageSquare size={22} className="text-accent-primary" />
          </div>
          <p className="text-sm font-semibold text-fg-secondary">{t("noMessagesYet")}</p>
          <p className="text-xs text-fg-tertiary mt-1">{t("startConversation")}</p>
        </div>
      </div>
    );
  }

  const lastOwnIndex = findLastIndex(messages, (m) => m.senderId === userId && m.deletedAt === null);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t("messagesWith", { name: peerName })}
        className="h-full overflow-y-auto px-3 sm:px-6 py-4 flex flex-col gap-2"
      >
        {isFetchingPreviousPage && (
          <div className="flex justify-center py-2" aria-hidden="true">
            <Loader2 className="animate-spin text-fg-tertiary" size={16} />
          </div>
        )}
        {!hasPreviousPage && messages.length > 12 && (
          <p className="text-center text-[10px] uppercase tracking-widest text-fg-quaternary py-2">
            {t("startOfConversation")}
          </p>
        )}

        {messages.map((message, idx) => {
          const previous = idx > 0 ? messages[idx - 1] : undefined;
          const createdAt = new Date(message.createdAt);
          const newDay = !previous || !isSameDay(new Date(previous.createdAt), createdAt);
          /* A new run starts on a new day, on a sender change, or after a gap
             long enough that the messages are not really one thought. */
          const startsRun =
            newDay ||
            !previous ||
            previous.senderId !== message.senderId ||
            createdAt.getTime() - new Date(previous.createdAt).getTime() > 5 * 60 * 1000;

          const isOwn = message.senderId === userId;
          /* Drawn on the first message past the frozen pointer. The `previous`
             guard keeps it from rendering above the very first loaded message,
             where there is no "already read" side for it to divide from. */
          const showUnreadDivider =
            !isOwn &&
            unreadAfterId !== null &&
            previous !== undefined &&
            previous.id <= unreadAfterId &&
            message.id > unreadAfterId;

          return (
            <div key={message.id} className="flex flex-col gap-2">
              {newDay && (
                <div className="flex items-center gap-3 my-1">
                  <span className="h-px flex-1 bg-border-light/50" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-quaternary">
                    {formatDayLabel(createdAt, locale, {
                      today: t("today"),
                      yesterday: t("yesterday"),
                    })}
                  </span>
                  <span className="h-px flex-1 bg-border-light/50" />
                </div>
              )}
              {showUnreadDivider && (
                <div className="flex items-center gap-3 my-1">
                  <span className="h-px flex-1 bg-accent-primary/45" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-primary">
                    {t("newMessages")}
                  </span>
                  <span className="h-px flex-1 bg-accent-primary/45" />
                </div>
              )}
              <MessageBubble
                message={message}
                isOwn={isOwn}
                showAvatar={startsRun}
                isLastOwn={idx === lastOwnIndex}
                seen={peerLastReadId >= message.id}
                status={statusOf(message)}
                locale={locale}
                sender={participants.get(message.senderId) ?? null}
                onReply={onReply}
                onToggleReaction={onToggleReaction}
                onEdit={onEdit}
                onDelete={onDelete}
                onTogglePin={onTogglePin}
                onRetry={onRetry}
                onDiscard={onDiscard}
                onJumpToMessage={onJumpToMessage}
                highlighted={highlightedId === message.id}
              />
            </div>
          );
        })}

        {peerTyping && (
          <div className="flex items-end gap-2" aria-live="polite">
            <div className="w-[26px]" />
            <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-bg-elevated kairos-system-card flex items-center gap-1">
              <span className="sr-only">{t("isTyping", { name: peerName })}</span>
              <Dot delay="0ms" />
              <Dot delay="150ms" />
              <Dot delay="300ms" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <JumpToLatest onClick={() => scrollToBottom("smooth")} scrollRef={scrollRef} />
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-fg-quaternary animate-bounce"
      style={{ animationDelay: delay, animationDuration: "1s" }}
    />
  );
}

/**
 * "Jump to latest", shown only when the reader has scrolled away from the
 * bottom. Reads scroll position directly rather than holding it in state — this
 * fires on every scroll frame, and a setState per frame is a rerender per frame.
 */
function JumpToLatest({
  onClick,
  scrollRef,
}: {
  onClick: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("chat.direct");
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const button = buttonRef.current;
    if (!el || !button) return;

    const update = () => {
      const away = el.scrollHeight - el.scrollTop - el.clientHeight > 240;
      button.style.opacity = away ? "1" : "0";
      button.style.pointerEvents = away ? "auto" : "none";
      button.style.transform = away ? "translateY(0)" : "translateY(8px)";
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [scrollRef]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={t("jumpToLatest")}
      style={{ opacity: 0, pointerEvents: "none" }}
      className="absolute bottom-4 right-5 p-2.5 rounded-full bg-bg-elevated kairos-system-card-elevated text-accent-primary hover:brightness-105 transition-all"
    >
      <ArrowDown size={16} />
    </button>
  );
}

/** `Array.prototype.findLastIndex` needs a newer lib target than this build sets. */
function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i]!)) return i;
  }
  return -1;
}
