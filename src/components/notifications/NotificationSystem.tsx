"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api } from "~/trpc/react";
import {
  Bell,
  X,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Heart,
  MessageCircle,
  MessageSquare,
  FolderKanban,
  Clock,
} from "~/components/ui/icons";
import { formatDistanceToNowStrict, isToday, isYesterday, format } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSocketEvent } from "~/hooks/useSocketEvent";

/**
 * Mirrors `notificationTypeEnum`.
 *
 * This used to be a four-value union, and both places that built a `Notification`
 * narrowed anything else down to `"system"`. Since a direct message, a like and a
 * comment are all stored with their own type, the effect was that most of the
 * bell rendered the same generic warning icon — a like on your post looked
 * identical to an account notice.
 */
type NotificationType =
  | "event"
  | "task"
  | "project"
  | "system"
  | "like"
  | "comment"
  | "reply"
  | "message"
  | "event_reminder";

const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "event", "task", "project", "system",
  "like", "comment", "reply", "message", "event_reminder",
];

function asNotificationType(value: unknown): NotificationType {
  return NOTIFICATION_TYPES.includes(value as NotificationType)
    ? (value as NotificationType)
    : "system";
}

/**
 * Types where another person is addressing you directly, as opposed to the app
 * reporting on itself. This is what the "Mentions" filter narrows to — the rows
 * people actually come to the bell looking for.
 */
const MENTION_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "message",
  "comment",
  "reply",
]);

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: Date;
  read: boolean;
  link?: string;
}

interface FloatingNotif {
  id: string;
  title: string;
  message: string;
  type: string;
  link?: string;
}

type Filter = "all" | "unread" | "mentions";

/**
 * Colour carries the category, so the row does not need a tinted 40px tile to
 * say what kind of thing it is. One 16px glyph, tinted, on the page background.
 */
const TONE: Record<NotificationType, string> = {
  event: "text-event-upcoming",
  event_reminder: "text-event-upcoming",
  task: "text-success",
  project: "text-warning",
  message: "text-accent-primary",
  comment: "text-accent-primary",
  reply: "text-accent-primary",
  like: "text-error",
  system: "text-fg-quaternary",
};

function GlyphFor({ type, size = 16 }: { type: NotificationType; size?: number }) {
  const className = TONE[type];
  switch (type) {
    case "event":
      return <Calendar className={className} size={size} strokeWidth={1.7} />;
    case "event_reminder":
      return <Clock className={className} size={size} strokeWidth={1.7} />;
    case "task":
      return <CheckCircle2 className={className} size={size} strokeWidth={1.7} />;
    case "project":
      return <FolderKanban className={className} size={size} strokeWidth={1.7} />;
    case "message":
      return <MessageSquare className={className} size={size} strokeWidth={1.7} />;
    case "like":
      return <Heart className={className} size={size} strokeWidth={1.7} />;
    case "comment":
    case "reply":
      return <MessageCircle className={className} size={size} strokeWidth={1.7} />;
    default:
      return <AlertCircle className={className} size={size} strokeWidth={1.7} />;
  }
}

/** `2m`, `26m`, `Wed`, `12 Aug` — short enough to sit at the end of the title row. */
function shortWhen(date: Date): string {
  if (isToday(date)) {
    return formatDistanceToNowStrict(date)
      .replace(/ seconds?/, "s")
      .replace(/ minutes?/, "m")
      .replace(/ hours?/, "h");
  }
  if (isYesterday(date)) return "Yest";
  const now = Date.now();
  const withinWeek = now - date.getTime() < 7 * 24 * 60 * 60 * 1000;
  return withinWeek ? format(date, "EEE") : format(date, "d MMM");
}

function dayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "d MMMM");
}

const COLLAPSED_VISIBLE = 20;

export function NotificationSystem() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [floatingNotifs, setFloatingNotifs] = useState<FloatingNotif[]>([]);
  const floatingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const utils = api.useUtils();

  // Delivery is push-based: the `notification:new` socket event below refetches
  // both queries. The interval is only a safety net for a dropped socket, so it
  // is long — at 15s it was effectively the primary transport, and doubled the
  // request rate for every signed-in user.
  const NOTIFICATION_FALLBACK_POLL_MS = 120_000;

  /*
   * `staleTime` is what keeps the bell from refetching on every navigation.
   * The bar this lives in is re-rendered by each page, so both queries mount
   * again on every page switch; with the list treated as stale they fired two
   * requests every time the user moved anywhere in the app. Since delivery is
   * push-based, a cached list is not a stale one — the socket event below
   * invalidates it the moment anything actually arrives.
   *
   * Window focus is still opted into by name, against the app-wide default, as
   * the cheap way to catch up on anything missed while the tab was hidden.
   */
  const { data: storedNotifications, refetch } = api.notification.getAll.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: NOTIFICATION_FALLBACK_POLL_MS,
    refetchInterval: NOTIFICATION_FALLBACK_POLL_MS,
  });

  // Separate unread count query for faster badge updates
  const { data: serverUnreadCount } = api.notification.getUnreadCount.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: NOTIFICATION_FALLBACK_POLL_MS,
    refetchInterval: NOTIFICATION_FALLBACK_POLL_MS,
  });

  // Real-time notification push via Socket.IO — show floating popup + refetch
  const handleNewNotification = useCallback(
    (data: { id?: number | string; title?: string; message?: string; type?: string; link?: string }) => {
      // Immediately refetch both queries for up-to-date data
      void refetch();
      void utils.notification.getUnreadCount.invalidate();

      // Show floating popup for the incoming notification
      if (data?.title) {
        const floatId = `float-${Date.now()}-${Math.random()}`;
        const notif: FloatingNotif = {
          id: floatId,
          title: data.title,
          message: data.message ?? "",
          type: data.type ?? "system",
          link: data.link ?? undefined,
        };
        setFloatingNotifs((prev) => [...prev, notif]);

        // Optimistically add to notifications list so badge updates immediately
        setNotifications((prev) => [
          {
            id: floatId,
            type: asNotificationType(data.type),
            title: data.title ?? "",
            message: data.message ?? "",
            createdAt: new Date(),
            read: false,
            link: data.link ?? undefined,
          },
          ...prev,
        ]);

        // Auto-dismiss after 5 seconds
        const timer = setTimeout(() => {
          setFloatingNotifs((prev) => prev.filter((n) => n.id !== floatId));
          floatingTimers.current.delete(floatId);
        }, 5000);
        floatingTimers.current.set(floatId, timer);
      }
    },
    [refetch, utils.notification.getUnreadCount],
  );
  useSocketEvent("notification:new", handleNewNotification);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = floatingTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const dismissFloating = (id: string) => {
    setFloatingNotifs((prev) => prev.filter((n) => n.id !== id));
    const timer = floatingTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      floatingTimers.current.delete(id);
    }
  };

  const invalidateBell = useCallback(() => {
    void utils.notification.getAll.invalidate();
    void utils.notification.getUnreadCount.invalidate();
  }, [utils]);

  const markAsReadMutation = api.notification.markAsRead.useMutation({
    onSuccess: invalidateBell,
  });

  /**
   * Replaces the old `Clear All`. Emptying the list was the only bulk action on
   * this panel, so the quickest way to silence the badge was to destroy the
   * history behind it — including anything not yet read.
   */
  const markAllAsReadMutation = api.notification.markAllAsRead.useMutation({
    onMutate: () => {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    },
    onSettled: invalidateBell,
  });

  const deleteMutation = api.notification.delete.useMutation({
    onSuccess: invalidateBell,
  });

  useEffect(() => {
    if (storedNotifications) {
      const formattedNotifications: Notification[] = storedNotifications.map((notif) => {
        return {
          id: notif.id.toString(),
          type: asNotificationType(notif.type),
          title: notif.title,
          message: notif.message,
          createdAt: new Date(notif.createdAt),
          read: notif.read,
          link: notif.link ?? undefined,
        };
      });
      setNotifications(formattedNotifications);
    }
  }, [storedNotifications]);

  useEffect(() => {
    if (isOpen) {
      void refetch();
    } else {
      // A filter or an expanded list is a reading position, not a preference —
      // the next open starts from the top again.
      setFilter("all");
      setExpanded(false);
    }
  }, [isOpen, refetch]);

  // Use server count if available, fall back to local state count
  const localUnread = notifications.filter((n) => !n.read).length;
  const unreadCount = Math.max(localUnread, serverUnreadCount ?? 0);
  const mentionCount = notifications.filter((n) => MENTION_TYPES.has(n.type)).length;

  const visible = useMemo(() => {
    const matches = notifications.filter((n) => {
      if (filter === "unread") return !n.read;
      if (filter === "mentions") return MENTION_TYPES.has(n.type);
      return true;
    });
    return expanded ? matches : matches.slice(0, COLLAPSED_VISIBLE);
  }, [notifications, filter, expanded]);

  /** Rows in order, with a day heading inserted whenever the date changes. */
  const grouped = useMemo(() => {
    const out: { label: string; items: Notification[] }[] = [];
    for (const item of visible) {
      const label = dayLabel(item.createdAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(item);
      else out.push({ label, items: [item] });
    }
    return out;
  }, [visible]);

  const hiddenCount = useMemo(() => {
    const total = notifications.filter((n) => {
      if (filter === "unread") return !n.read;
      if (filter === "mentions") return MENTION_TYPES.has(n.type);
      return true;
    }).length;
    return Math.max(0, total - visible.length);
  }, [notifications, filter, visible.length]);

  const handleMarkAsRead = (id: string) => {
    markAsReadMutation.mutate({ notificationId: id });
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    deleteMutation.mutate({ notificationId: id });
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      handleMarkAsRead(notification.id);
    }

    if (notification.link) {
      setIsOpen(false);
      router.push(notification.link);
    }
  };

  // The floating toast falls back to the bell rather than a warning triangle: an
  // unrecognised type popping up as an alert reads as an error.
  const floatingGlyph = (type: string) =>
    type === "system" ? (
      <Bell className="text-accent-primary" size={16} strokeWidth={1.7} />
    ) : (
      <GlyphFor type={asNotificationType(type)} />
    );

  const label = "font-mono text-[10px] uppercase tracking-[0.14em]";

  const segment = (value: Filter, text: string, count: number) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setFilter(value);
        setExpanded(false);
      }}
      className={`${label} rounded-[7px] px-2.5 py-1.5 transition-colors ${
        filter === value
          ? "bg-bg-secondary text-fg-primary"
          : "text-fg-tertiary hover:text-fg-primary"
      }`}
    >
      {text}
      <span className="ml-1.5 text-fg-quaternary">{count}</span>
    </button>
  );

  return (
    <>
      {/* Floating notification popups — visible without clicking bell */}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2">
        {floatingNotifs.map((notif) => (
          <div
            key={notif.id}
            className="animate-in slide-in-from-right-5 fade-in pointer-events-auto flex w-[340px] max-w-[calc(100vw-2rem)] cursor-pointer items-start gap-3 rounded-[13px] border border-border-light bg-bg-elevated p-3.5 shadow-2xl duration-300 hover:bg-bg-secondary/60"
            onClick={() => {
              dismissFloating(notif.id);
              if (notif.link) router.push(notif.link);
            }}
          >
            <span className="mt-px flex h-[22px] w-[22px] flex-none items-center justify-center">
              {floatingGlyph(notif.type)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <h4 className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-fg-primary">
                  {notif.title}
                </h4>
                <span className={`${label} ml-auto flex-none text-fg-quaternary`}>now</span>
              </div>
              {notif.message && (
                <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-fg-tertiary">
                  {notif.message}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dismissFloating(notif.id);
              }}
              className="flex h-5 w-5 flex-none items-center justify-center rounded-md text-fg-quaternary transition-colors hover:bg-error/10 hover:text-error"
              aria-label="Dismiss"
            >
              <X size={12} strokeWidth={2.2} />
            </button>
          </div>
        ))}
      </div>

      {/* Bell + panel */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`relative flex h-8 w-8 items-center justify-center rounded-[9px] transition-colors ${
            isOpen
              ? "bg-accent-primary/12 text-accent-primary"
              : "text-fg-secondary hover:bg-bg-secondary/60 hover:text-fg-primary"
          }`}
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
          }
          aria-expanded={isOpen}
        >
          <Bell size={19} strokeWidth={1.6} />
          {/*
            A dot, not a number. The count is one tap away in the panel header,
            and a two-digit badge on a 19px glyph was the loudest thing in the bar.
          */}
          {unreadCount > 0 && (
            <span className="absolute right-[5px] top-[5px] h-[7px] w-[7px] rounded-full bg-accent-primary ring-2 ring-bg-primary" />
          )}
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />
            {/*
              380px on a laptop and right-anchored under the bell: the panel does
              not widen with the viewport, because a 700px row is no easier to
              scan. Below `sm` it becomes a full-width sheet under the bar.
            */}
            <div className="animate-in slide-in-from-top-2 absolute right-0 z-50 mt-2 w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-border-light bg-bg-elevated shadow-2xl duration-200 sm:w-[380px]">
              <div className="flex items-baseline gap-2.5 px-[18px] pb-3 pt-4">
                <h3 className="text-[15px] font-bold tracking-[-0.012em] text-fg-primary">
                  Notifications
                </h3>
                {unreadCount > 0 && (
                  <span className={`${label} text-accent-primary`}>{unreadCount} new</span>
                )}
                <span className="flex-1" />
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllAsReadMutation.mutate()}
                    disabled={markAllAsReadMutation.isPending}
                    className="text-[12px] text-fg-tertiary transition-colors hover:text-fg-primary disabled:opacity-50"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {notifications.length > 0 && (
                <div className="flex gap-1 px-3.5 pb-3">
                  {segment("all", "All", notifications.length)}
                  {segment("unread", "Unread", localUnread)}
                  {segment("mentions", "Mentions", mentionCount)}
                </div>
              )}

              <div
                className={`overflow-y-auto ${expanded ? "max-h-[640px]" : "max-h-[400px]"}`}
              >
                {notifications.length === 0 ? (
                  <div className="px-6 pb-14 pt-[52px] text-center">
                    <span className="mx-auto mb-3.5 flex h-10 w-10 items-center justify-center rounded-full border border-border-light text-fg-quaternary">
                      <Bell size={17} strokeWidth={1.6} />
                    </span>
                    <strong className="block text-[13.5px] font-bold text-fg-primary">
                      Nothing waiting
                    </strong>
                    <span className="text-[12px] text-fg-tertiary">
                      New activity lands here first.
                    </span>
                  </div>
                ) : visible.length === 0 ? (
                  <div className="px-6 pb-12 pt-10 text-center">
                    <strong className="block text-[13.5px] font-bold text-fg-primary">
                      {filter === "unread" ? "All caught up" : "No mentions"}
                    </strong>
                    <span className="text-[12px] text-fg-tertiary">
                      {filter === "unread"
                        ? "Nothing unread right now."
                        : "Nobody has written to you lately."}
                    </span>
                  </div>
                ) : (
                  grouped.map((group) => (
                    <div key={group.label}>
                      <div
                        className={`${label} border-t border-border-light px-[18px] pb-1.5 pt-3 text-fg-quaternary`}
                      >
                        {group.label}
                      </div>
                      {group.items.map((notification) => (
                        <div
                          key={notification.id}
                          onClick={() => handleNotificationClick(notification)}
                          className={`group relative flex cursor-pointer gap-3 border-t border-border-light/60 px-[18px] py-3.5 transition-colors hover:bg-bg-secondary/60 ${
                            notification.read ? "opacity-[0.62]" : ""
                          }`}
                        >
                          {!notification.read && (
                            <span
                              aria-hidden="true"
                              className="absolute left-2 top-[21px] h-1 w-1 rounded-full bg-accent-primary"
                            />
                          )}
                          <span className="mt-px flex h-[22px] w-[22px] flex-none items-center justify-center">
                            <GlyphFor type={notification.type} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <h4 className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-fg-primary">
                                {notification.title}
                              </h4>
                              <span
                                className={`${label} ml-auto flex-none text-fg-quaternary`}
                              >
                                {shortWhen(notification.createdAt)}
                              </span>
                            </div>
                            {notification.message && (
                              <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-fg-tertiary">
                                {notification.message}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(notification.id, e)}
                            className="flex h-5 w-5 flex-none items-center justify-center self-start rounded-md text-fg-quaternary opacity-0 transition-colors hover:bg-error/10 hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
                            aria-label="Delete notification"
                          >
                            <X size={12} strokeWidth={2.2} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border-light px-[18px] py-2.5">
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="text-[12px] text-fg-tertiary transition-colors hover:text-fg-primary"
                  >
                    See all ({hiddenCount} more)
                  </button>
                ) : expanded ? (
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="text-[12px] text-fg-tertiary transition-colors hover:text-fg-primary"
                  >
                    Show less
                  </button>
                ) : (
                  <span />
                )}
                <Link
                  href="/settings?section=notifications"
                  onClick={() => setIsOpen(false)}
                  className="text-[12px] text-fg-quaternary transition-colors hover:text-fg-primary"
                >
                  Notification settings
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
