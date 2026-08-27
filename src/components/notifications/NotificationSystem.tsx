"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "~/trpc/react";
import { Bell, X, Calendar, CheckCircle2, AlertCircle, Trash2, Heart, MessageCircle, MessageSquare, FolderKanban, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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

export function NotificationSystem() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
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

  const markAsReadMutation = api.notification.markAsRead.useMutation({
    onSuccess: () => {
      void utils.notification.getAll.invalidate();
      void utils.notification.getUnreadCount.invalidate();
    },
  });

  const deleteMutation = api.notification.delete.useMutation({
    onSuccess: () => {
      void utils.notification.getAll.invalidate();
      void utils.notification.getUnreadCount.invalidate();
    },
  });

  const deleteAllMutation = api.notification.deleteAll.useMutation({
    onSuccess: () => {
      setNotifications([]);
      void utils.notification.getAll.invalidate();
      void utils.notification.getUnreadCount.invalidate();
    },
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
    }
  }, [isOpen, refetch]);

  // Use server count if available, fall back to local state count
  const localUnread = notifications.filter((n) => !n.read).length;
  const unreadCount = Math.max(localUnread, serverUnreadCount ?? 0);

  const handleMarkAsRead = (id: string) => {
    markAsReadMutation.mutate({ notificationId: id });
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteMutation.mutate({ notificationId: id });
  };

  const handleClearAll = () => {
    deleteAllMutation.mutate();
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

  const iconFor = (type: string, size: number) => {
    switch (type) {
      case "event":
        return <Calendar className="text-event-upcoming" size={size} />;
      case "event_reminder":
        return <Clock className="text-event-upcoming" size={size} />;
      case "task":
        return <CheckCircle2 className="text-success" size={size} />;
      case "project":
        return <FolderKanban className="text-warning" size={size} />;
      case "message":
        return <MessageSquare className="text-accent-primary" size={size} />;
      case "like":
        return <Heart className="text-error" size={size} />;
      case "comment":
      case "reply":
        return <MessageCircle className="text-accent-primary" size={size} />;
      default:
        return <AlertCircle className="text-fg-tertiary" size={size} />;
    }
  };

  const getIcon = (type: string) => iconFor(type, 20);

  // The floating toast falls back to the bell rather than a warning triangle: an
  // unrecognised type popping up as an alert reads as an error.
  const getFloatingIcon = (type: string) =>
    type === "system" ? <Bell className="text-accent-primary" size={18} /> : iconFor(type, 18);

  return (
    <>
      {/* Floating notification popups — visible without clicking bell */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {floatingNotifs.map((notif) => (
          <div
            key={notif.id}
            className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] bg-bg-elevated dark:bg-[#1e1d24] border dark:border-white/10 border-slate-200 rounded-xl shadow-2xl p-4 animate-in slide-in-from-right-5 fade-in duration-300 cursor-pointer hover:bg-bg-secondary/80 transition-colors"
            onClick={() => {
              dismissFloating(notif.id);
              if (notif.link) router.push(notif.link);
            }}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 bg-accent-primary/10 rounded-lg flex items-center justify-center">
                {getFloatingIcon(notif.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold text-sm text-fg-primary truncate">{notif.title}</h4>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissFloating(notif.id);
                    }}
                    className="flex-shrink-0 p-0.5 hover:bg-bg-surface rounded transition-colors"
                  >
                    <X size={14} className="text-fg-tertiary" />
                  </button>
                </div>
                <p className="text-xs text-fg-secondary mt-0.5 line-clamp-2">{notif.message}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bell icon + dropdown */}
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="relative p-2 text-fg-secondary hover:text-fg-primary hover:bg-bg-secondary/60 rounded-lg transition-colors"
          aria-label="Notifications"
        >
          <Bell size={22} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent-primary text-white text-xs font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-96 backdrop-blur-xl rounded-2xl dark:bg-[#16151A] bg-white dark:border-white/[0.06] border border-slate-200 shadow-2xl z-50 max-h-[600px] overflow-hidden animate-in slide-in-from-top-2 duration-200">
              <div className="p-4 border-b dark:border-white/[0.06] border-slate-200 flex items-center justify-between sticky top-0 dark:bg-[#16151A]/95 bg-white/95 backdrop-blur-sm z-10">
                <div>
                  <h3 className="text-lg font-bold text-fg-primary">Notifications</h3>
                  {unreadCount > 0 && (
                    <p className="text-xs text-fg-tertiary">{unreadCount} unread</p>
                  )}
                </div>
                {notifications.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    disabled={deleteAllMutation.isPending}
                    className="text-xs text-error/90 hover:text-error transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    <Trash2 size={14} />
                    {deleteAllMutation.isPending ? "Clearing..." : "Clear All"}
                  </button>
                )}
              </div>

              <div className="overflow-y-auto max-h-[500px]">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center">
                    <Bell className="mx-auto text-fg-quaternary/60 mb-3" size={48} />
                    <p className="text-fg-secondary">No notifications</p>
                    <p className="text-xs text-fg-tertiary mt-2">You are all caught up!</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border-light/30">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={`p-4 hover:bg-bg-secondary/50 transition-all cursor-pointer group ${
                          !notification.read ? "bg-accent-primary/5 border-l-2 border-accent-primary" : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-10 h-10 bg-accent-primary/10 shadow-sm rounded-lg flex items-center justify-center">
                            {getIcon(notification.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <h4
                                className={`font-semibold text-sm ${
                                  !notification.read ? "text-fg-primary" : "text-fg-secondary"
                                }`}
                              >
                                {notification.title}
                                {!notification.read && (
                                  <span className="ml-2 inline-block w-2 h-2 bg-accent-primary rounded-full"></span>
                                )}
                              </h4>
                              <button
                                onClick={(e) => handleDelete(notification.id, e)}
                                className="flex-shrink-0 p-1 hover:bg-error/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                                aria-label="Delete notification"
                              >
                                <X size={16} className="text-error/90" />
                              </button>
                            </div>
                            <p className="text-sm text-fg-secondary mt-1">{notification.message}</p>
                            <div className="flex items-center justify-between mt-2">
                              <p className="text-xs text-fg-tertiary">
                                {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                              </p>
                              {notification.link && (
                                <span className="text-xs text-accent-primary font-medium">Click to view &rarr;</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}