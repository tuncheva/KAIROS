"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useDateFormat } from "~/hooks/useDateFormat";
import {
  Heart,
  MessageCircle,
  X,
  Calendar,
  User,
  Check,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  MapPin,
  BarChart3,
  Users,
  TrendingUp,
  Trash2,
  Bell,
  Share2,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { api } from "~/trpc/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { CreateEventForm } from "~/components/events/CreateEventForm";
import { EditEventForm } from "~/components/events/EditEventForm";
import { useSocketEvent } from "~/hooks/useSocketEvent";

export const REGIONS = [
  { value: '', label: 'All Regions' },
  { value: 'sofia', label: 'Sofia' },
  { value: 'plovdiv', label: 'Plovdiv' },
  { value: 'varna', label: 'Varna' },
  { value: 'burgas', label: 'Burgas' },
  { value: 'ruse', label: 'Ruse' },
  { value: 'stara_zagora', label: 'Stara Zagora' },
  { value: 'pleven', label: 'Pleven' },
  { value: 'sliven', label: 'Sliven' },
  { value: 'dobrich', label: 'Dobrich' },
  { value: 'shumen', label: 'Shumen' },
] as const;

// Allowed image hostnames for Next.js Image component
const ALLOWED_IMAGE_HOSTS = ['utfs.io', 'lh3.googleusercontent.com'];

function isValidImageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ALLOWED_IMAGE_HOSTS.some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host));
  } catch {
    return false;
  }
}

interface Author {
  id?: string | null; 
  name: string | null;
  image: string | null;
}

interface Comment {
  id: number;
  text: string;
  imageUrl: string | null;
  createdAt: Date;
  author: Author;
}

interface RsvpCounts {
  going: number;
  maybe: number;
  notGoing: number;
}

interface EventWithDetails {
  id: number;
  title: string;
  description: string;
  eventDate: Date;
  createdAt?: Date;
  imageUrl: string | null;
  region: string;
  enableRsvp: boolean;
  likeCount: number;
  commentCount: number;
  hasLiked: boolean;
  userRsvpStatus: "going" | "maybe" | "not_going" | null;
  rsvpCounts: RsvpCounts;
  author: Author;
  comments: Comment[];
  createdById: string;
  isOwner: boolean;
}

// Optimistic update hooks
function useOptimisticLike(eventId: number) {
  const utils = api.useUtils();
  const toggleLike = api.event.toggleLike.useMutation({
    onMutate: async () => {
      await utils.event.getPublicEvents.cancel();
      const previous = utils.event.getPublicEvents.getInfiniteData({ limit: 10 });

      utils.event.getPublicEvents.setInfiniteData({ limit: 10 }, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((event) => {
              if (event.id !== eventId) return event;
              const wasLiked = event.hasLiked;
              return {
                ...event,
                hasLiked: !wasLiked,
                likeCount: wasLiked ? event.likeCount - 1 : event.likeCount + 1,
              };
            }),
          })),
        };
      });

      return { previous };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous) {
        utils.event.getPublicEvents.setInfiniteData({ limit: 10 }, context.previous);
      }
    },

    onSettled: () => {
      void utils.event.getPublicEvents.invalidate();
    },
  });

  return toggleLike;
}

function useOptimisticRsvp(eventId: number) {
  const utils = api.useUtils();
  const updateRsvp = api.event.updateRsvp.useMutation({
    onMutate: async ({ status }) => {
      await utils.event.getPublicEvents.cancel();
      const previous = utils.event.getPublicEvents.getInfiniteData({ limit: 10 });

      utils.event.getPublicEvents.setInfiniteData({ limit: 10 }, (old) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((event) => {
              if (event.id !== eventId) return event;

              const oldStatus = event.userRsvpStatus;
              const newCounts = { ...event.rsvpCounts };

              if (oldStatus === "going") newCounts.going--;
              else if (oldStatus === "maybe") newCounts.maybe--;
              else if (oldStatus === "not_going") newCounts.notGoing--;

              if (status === "going") newCounts.going++;
              else if (status === "maybe") newCounts.maybe++;
              else if (status === "not_going") newCounts.notGoing++;

              return {
                ...event,
                userRsvpStatus: status,
                rsvpCounts: newCounts,
              };
            }),
          })),
        };
      });

      return { previous };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous) {
        utils.event.getPublicEvents.setInfiniteData({ limit: 10 }, context.previous);
      }
    },

    onSettled: () => {
      void utils.event.getPublicEvents.invalidate();
    },
  });

  return updateRsvp;
}

const InfoMessageToast: React.FC<{
  message: string | null;
  type: "error" | "info" | null;
  onClose: () => void;
}> = ({ message, type, onClose }) => {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  const color =
    type === "error"
      ? "dark:bg-red-500/10 bg-red-50 dark:border-red-500/30 border-red-200 dark:text-red-300 text-red-700"
      : "dark:bg-blue-500/10 bg-blue-50 dark:border-blue-500/30 border-blue-200 dark:text-blue-300 text-blue-700";

  const Icon = type === "error" ? AlertCircle : Check;

  return (
    <div
      className={`fixed bottom-4 right-4 p-4 rounded-xl border shadow-lg z-50 transition-opacity duration-300 ${color}`}
    >
      <div className="flex items-center gap-3">
        <Icon size={20} className="flex-shrink-0" />
        <p className="text-sm font-medium">{message}</p>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

const RsvpDashboard: React.FC<{ event: EventWithDetails; onClose: () => void }> = ({ event, onClose }) => {
  const t = useTranslations("publish");
  const { formatDate: formatDatePref } = useDateFormat();
  const totalRsvps = event.rsvpCounts.going + event.rsvpCounts.maybe + event.rsvpCounts.notGoing;
  const goingPercentage = totalRsvps > 0 ? (event.rsvpCounts.going / totalRsvps) * 100 : 0;
  const maybePercentage = totalRsvps > 0 ? (event.rsvpCounts.maybe / totalRsvps) * 100 : 0;
  const notGoingPercentage = totalRsvps > 0 ? (event.rsvpCounts.notGoing / totalRsvps) * 100 : 0;

  const formatEventDateTime = (date: Date) => {
    return formatDatePref(date, "long");
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="dark:bg-[#16151A] bg-white rounded-2xl dark:border-white/5 border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-4 sm:p-6 flex items-center justify-between sticky top-0 dark:bg-[#16151A]/95 bg-white/95 backdrop-blur-sm z-10 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-accent-primary/20 rounded-lg flex items-center justify-center">
              <BarChart3 size={18} className="sm:w-5 sm:h-5 text-accent-primary" />
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-fg-primary">{t("responsesDashboard")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-accent-primary/60 hover:text-accent-primary hover:bg-accent-primary/5 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          <div className="dark:bg-bg-secondary bg-slate-50 rounded-xl p-4 sm:p-5 border dark:border-white/[0.06] border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <Users className="text-accent-primary" size={20} />
              <h3 className="text-base sm:text-lg font-semibold text-fg-primary">{t("totalResponses")}</h3>
            </div>
            <p className="text-3xl sm:text-4xl font-bold text-accent-primary mt-2">{totalRsvps}</p>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-accent-primary flex items-center gap-2">
              <TrendingUp size={16} className="text-accent-primary" />
              {t("responseBreakdown")}
            </h3>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-accent-primary" />
                  <span className="text-fg-secondary font-medium">{t("going")}</span>
                </div>
                <span className="text-fg-primary font-semibold">{event.rsvpCounts.going}</span>
              </div>
              <div className="h-2 dark:bg-white/5 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-accent-primary transition-all duration-500"
                  style={{ width: `${goingPercentage}%` }}
                />
              </div>
              <p className="text-xs text-accent-primary text-right">{goingPercentage.toFixed(1)}%</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <HelpCircle size={16} className="text-accent-primary/70" />
                  <span className="text-fg-secondary font-medium">{t("maybe")}</span>
                </div>
                <span className="text-fg-primary font-semibold">{event.rsvpCounts.maybe}</span>
              </div>
              <div className="h-2 dark:bg-white/5 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-accent-primary/70 transition-all duration-500"
                  style={{ width: `${maybePercentage}%` }}
                />
              </div>
              <p className="text-xs text-accent-primary/70 text-right">{maybePercentage.toFixed(1)}%</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <XCircle size={16} className="text-accent-primary/50" />
                  <span className="text-fg-secondary font-medium">{t("cantGo")}</span>
                </div>
                <span className="text-fg-primary font-semibold">{event.rsvpCounts.notGoing}</span>
              </div>
              <div className="h-2 dark:bg-white/5 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-accent-primary/50 transition-all duration-500"
                  style={{ width: `${notGoingPercentage}%` }}
                />
              </div>
              <p className="text-xs text-accent-primary/50 text-right">{notGoingPercentage.toFixed(1)}%</p>
            </div>
          </div>

          <div className="dark:bg-bg-secondary bg-slate-50 rounded-xl p-4 border dark:border-white/[0.06] border-slate-200">
            <h4 className="text-sm font-semibold text-accent-primary mb-2">{t("eventDetails")}</h4>
            <p className="text-fg-primary font-medium mb-1">{event.title}</p>
            <div className="flex items-center gap-2 text-xs text-accent-primary/60">
              <Calendar size={14} className="text-accent-primary" />
              <span>{formatEventDateTime(event.eventDate)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const EventCard: React.FC<{ event: EventWithDetails }> = ({ event }) => {
  const t = useTranslations("publish");
  const router = useRouter();
  const { data: session } = useSession();
  const { formatDate: formatDatePref } = useDateFormat();
  const utils = api.useUtils();
  const [showAllComments, setShowAllComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [showDashboard, setShowDashboard] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [deleteEventArmed, setDeleteEventArmed] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [lastRsvpStatus, setLastRsvpStatus] = useState<"going" | "maybe" | "not_going" | null>(null);
  const [infoMessage, setInfoMessage] = useState<{
    message: string;
    type: "error" | "info";
  } | null>(null);

  // Use optimistic hooks instead of regular mutations
  const toggleLike = useOptimisticLike(event.id);
  const updateRsvp = useOptimisticRsvp(event.id);

  const addComment = api.event.addComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      void utils.event.getPublicEvents.invalidate();
    },
    onError: (error) => {
      setInfoMessage({ message: error.message, type: "error" });
    },
  });

  const startDirectChat = api.chat.getOrCreateDirectConversation.useMutation({
    onError: (error) => {
      setInfoMessage({ message: error.message, type: "error" });
    },
    onSuccess: (data) => {
      router.push(`/chat?conversationId=${data.conversationId}`);
    },
  });

  const deleteEvent = api.event.deleteEvent.useMutation({
    onMutate: async () => {
      await utils.event.getPublicEvents.cancel();
      const previous = utils.event.getPublicEvents.getInfiniteData({ limit: 10 });

      utils.event.getPublicEvents.setInfiniteData({ limit: 10 }, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((e) => e.id !== event.id),
          })),
        };
      });

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        utils.event.getPublicEvents.setInfiniteData({ limit: 10 }, context.previous);
      }
      setInfoMessage({ message: error.message, type: "error" });
    },
    onSuccess: () => {
      setShowDashboard(false);
      setDeleteEventArmed(false);
      setInfoMessage({ message: t("eventDeleted"), type: "info" });
    },
    onSettled: () => {
      void utils.event.getPublicEvents.invalidate();
    },
  });

  useEffect(() => {
    if (!deleteEventArmed) return;
    const tId = setTimeout(() => setDeleteEventArmed(false), 4000);
    return () => clearTimeout(tId);
  }, [deleteEventArmed]);

  const handleLike = () => {
    if (!session) {
      setInfoMessage({ message: t("signInToLike"), type: "error" });
      return;
    }
    toggleLike.mutate({ eventId: event.id });
  };

  const handleBellClick = () => {
    if (!session) {
      setInfoMessage({ message: t("signInToManageNotifications"), type: "error" });
      return;
    }

    if (!event.enableRsvp) {
      setInfoMessage({
        message: t("likeCommentNotificationsAuto"),
        type: "info",
      });
      return;
    }

    setShowReminderPicker((prev) => !prev);
  };

  const handleRsvpClick = (status: "going" | "maybe" | "not_going") => {
    if (!session) {
      setInfoMessage({ message: t("signInToRsvp"), type: "error" });
      return;
    }
    updateRsvp.mutate({ eventId: event.id, status });
    // Show reminder picker for going/maybe, hide for not_going
    setLastRsvpStatus(status);
    if (status === "going" || status === "maybe") {
      // Use a short delay so the optimistic update settles first
      setTimeout(() => setShowReminderPicker(true), 50);
    } else {
      setShowReminderPicker(false);
    }
  };

  const handleSetReminder = (minutes: number | null) => {
    updateRsvp.mutate({
      eventId: event.id,
      status: lastRsvpStatus ?? event.userRsvpStatus ?? "going",
      reminderMinutesBefore: minutes,
    });
    setShowReminderPicker(false);
    if (minutes !== null) {
      const timeLabel =
        minutes >= 1440
          ? t("reminderDays", { count: minutes / 1440 })
          : minutes >= 60
            ? t("reminderHours", { count: minutes / 60 })
            : t("reminderMinutes", { count: minutes });
      setInfoMessage({ message: t("reminderSet", { time: timeLabel }), type: "info" });
    }
  };

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      setInfoMessage({ message: t("signInToComment"), type: "error" });
      return;
    }
    if (!commentText.trim()) return;

    addComment.mutate({
      eventId: event.id,
      text: commentText.trim(),
    });
  };

  const handleDeleteEvent = () => {
    if (!session) {
      setInfoMessage({ message: t("signInToDelete"), type: "error" });
      return;
    }

    if (!event.isOwner) return;

    if (!deleteEventArmed) {
      setDeleteEventArmed(true);
      setInfoMessage({ message: t("deleteConfirm"), type: "info" });
      return;
    }

    deleteEvent.mutate({ eventId: event.id });
  };

  const handleShare = async () => {
    const eventUrl = `${window.location.origin}/publish?event=${event.id}`;
    try {
      await navigator.clipboard.writeText(eventUrl);
      setInfoMessage({ message: t("linkCopied"), type: "info" });
    } catch {
      setInfoMessage({ message: t("failedToCopyLink"), type: "error" });
    }
  };

  const formatDate = (date: Date) => {
    return formatDatePref(date, "long");
  };

  const getRegionLabel = (value: string) => {
    return REGIONS.find(r => r.value === value)?.label ?? value;
  };

  const isPastEvent = new Date(event.eventDate) < new Date();
  const sortedComments = (event.comments ?? []).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const displayedComments = showAllComments
    ? sortedComments
    : sortedComments.slice(0, 3);

  return (
    <>
      <article className="dark:bg-[#16151A] bg-white rounded-2xl dark:border-white/5 border border-slate-200 overflow-hidden card-shadow" data-testid="event-card">

        {/* Header — event icon + title + author/time + actions */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center shrink-0 overflow-hidden">
              {event.author.image ? (
                <Image
                  src={event.author.image}
                  alt={event.author.name ?? "User"}
                  width={40}
                  height={40}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User size={18} className="text-accent-primary" />
              )}
            </div>
            <div>
              <h3 className="font-bold text-sm dark:text-white text-slate-900">{event.title}</h3>
              <p className="text-xs text-fg-tertiary">
                {event.author.name}{event.createdAt ? ` · ${formatDatePref(new Date(event.createdAt), "withYear")}` : ""}
              </p>
            </div>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-1.5 rounded-lg text-accent-primary/40 hover:text-accent-primary hover:bg-accent-primary/5 transition-all"
            >
              <MoreHorizontal size={20} />
            </button>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 dark:bg-[#16151A] bg-white rounded-xl dark:border-white/[0.06] border border-slate-200 shadow-xl min-w-[160px] py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                  {event.isOwner && (
                    <>
                      <button
                        onClick={() => {
                          setShowEditForm(true);
                          setShowMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium dark:text-gray-300 text-slate-600 dark:hover:bg-white/5 hover:bg-slate-50 transition-colors"
                      >
                        <Pencil size={15} />
                        {t("edit.title")}
                      </button>
                      <button
                        onClick={() => {
                          handleDeleteEvent();
                          // Only close menu after confirming (second click), not when arming (first click)
                          if (deleteEventArmed) setShowMoreMenu(false);
                        }}
                        disabled={deleteEvent.isPending}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors ${
                          deleteEventArmed
                            ? "text-error bg-error/5 hover:bg-error/10"
                            : "dark:text-red-400 text-red-500 dark:hover:bg-red-500/10 hover:bg-red-50"
                        }`}
                      >
                        <Trash2 size={15} />
                        {deleteEventArmed ? t("confirmDeleteEvent") : t("deleteEvent")}
                      </button>
                    </>
                  )}
                  {!event.isOwner && (
                    <p className="px-3 py-2.5 text-xs text-fg-tertiary">{t("noActionsAvailable")}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Body — description + image */}
        <div className="px-4 pb-3">
          <p className="text-sm leading-relaxed dark:text-gray-300 text-slate-700">{event.description}</p>
          {isValidImageUrl(event.imageUrl) && (
            <div className="mt-4 rounded-xl overflow-hidden aspect-video bg-bg-tertiary relative">
              <Image
                src={event.imageUrl}
                alt={event.title}
                fill
                className="object-cover"
              />
            </div>
          )}
        </div>

        {/* Date + Region bar */}
        <div className="px-4 pb-2 flex items-center gap-3 text-xs text-fg-tertiary">
          <div className="flex items-center gap-1.5">
            <Calendar size={12} className="text-accent-primary" />
            <span>{formatDate(event.eventDate)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="text-accent-primary" />
            <span>{getRegionLabel(event.region)}</span>
          </div>
          {isPastEvent && (
            <span className="px-1.5 py-0.5 bg-fg-tertiary/10 rounded text-[10px] text-fg-tertiary">{t("past")}</span>
          )}
        </div>

        {/* Action footer — like / comment / share */}
        <div className="px-4 py-3 border-t dark:border-white/5 border-slate-100 flex items-center gap-5 sm:gap-6 flex-wrap">
          <button
            onClick={handleLike}
            disabled={toggleLike.isPending}
            className={`flex items-center gap-1.5 transition-colors ${
              event.hasLiked
                ? "text-accent-primary"
                : "text-accent-primary/50 hover:text-accent-primary"
            }`}
          >
            <Heart
              size={20}
              className={event.hasLiked ? "fill-current" : ""}
            />
            <span className="text-xs font-semibold">{event.likeCount}</span>
          </button>

          <button className="flex items-center gap-1.5 text-accent-primary/50 hover:text-accent-primary transition-colors">
            <MessageCircle size={20} />
            <span className="text-xs font-semibold">{event.commentCount}</span>
          </button>

          {!event.isOwner && (
            <button
              onClick={() => {
                if (!session) {
                  setInfoMessage({ message: t("signInToMessageCreators"), type: "error" });
                  return;
                }
                startDirectChat.mutate({ otherUserId: event.createdById });
              }}
              disabled={startDirectChat.isPending}
              className="flex items-center gap-1.5 text-accent-primary/50 hover:text-accent-primary transition-colors"
              aria-label={t("messageCreator")}
              title={t("messageCreator")}
            >
              <MessageCircle size={20} />
              <span className="text-xs font-semibold">
                {startDirectChat.isPending ? t("opening") : t("message")}
              </span>
            </button>
          )}

          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 text-accent-primary/50 hover:text-accent-primary transition-colors"
          >
            <Share2 size={20} />
          </button>

          <button
            onClick={handleBellClick}
            className={`flex items-center gap-1.5 transition-colors ${
              showReminderPicker
                ? "text-accent-primary"
                : "text-accent-primary/50 hover:text-accent-primary"
            }`}
            aria-label={t("eventNotifications")}
            title={t("eventNotifications")}
          >
            <Bell size={20} className={showReminderPicker ? "fill-current" : ""} />
          </button>
        </div>

        {/* RSVP section */}
        {event.enableRsvp && (
          <div className="px-4 pb-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-accent-primary uppercase tracking-wider">{t("rsvp")}</span>
              {event.isOwner && (
                <button
                  onClick={() => setShowDashboard(true)}
                  className="flex items-center gap-1 text-xs text-accent-primary font-medium">
                  <BarChart3 size={12} />
                  {t("stats")}
                </button>
              )}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => handleRsvpClick("going")}
                disabled={updateRsvp.isPending}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  event.userRsvpStatus === "going"
                    ? "bg-accent-primary/20 text-accent-primary"
                    : "dark:bg-white/5 bg-slate-100 text-accent-primary/60 hover:bg-accent-primary/10 hover:text-accent-primary"
                }`}
              >
                <CheckCircle2 size={12} />
                {t("going")} ({event.rsvpCounts.going})
              </button>
              <button
                onClick={() => handleRsvpClick("maybe")}
                disabled={updateRsvp.isPending}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  event.userRsvpStatus === "maybe"
                    ? "bg-accent-primary/20 text-accent-primary"
                    : "dark:bg-white/5 bg-slate-100 text-accent-primary/60 hover:bg-accent-primary/10 hover:text-accent-primary"
                }`}
              >
                <HelpCircle size={12} />
                {t("maybe")} ({event.rsvpCounts.maybe})
              </button>
              <button
                onClick={() => handleRsvpClick("not_going")}
                disabled={updateRsvp.isPending}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  event.userRsvpStatus === "not_going"
                    ? "bg-accent-primary/20 text-accent-primary"
                    : "dark:bg-white/5 bg-slate-100 text-accent-primary/60 hover:bg-accent-primary/10 hover:text-accent-primary"
                }`}
              >
                <XCircle size={12} />
                {t("cantGo")} ({event.rsvpCounts.notGoing})
              </button>
            </div>

            {/* Reminder preference picker */}
            {showReminderPicker && (lastRsvpStatus === "going" || lastRsvpStatus === "maybe" || event.userRsvpStatus === "going" || event.userRsvpStatus === "maybe") && (
              <div className="mt-2 p-2.5 rounded-lg bg-bg-secondary dark:border-white/5 border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-accent-primary flex items-center gap-1">
                    <Bell size={12} className="text-accent-primary" />
                    {t("getNotified")}
                  </span>
                  <button
                    onClick={() => setShowReminderPicker(false)}
                    className="text-fg-tertiary hover:text-fg-primary p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "30 min", value: 30 },
                    { label: "1 hour", value: 60 },
                    { label: "3 hours", value: 180 },
                    { label: "1 day", value: 1440 },
                    { label: "3 days", value: 4320 },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleSetReminder(opt.value)}
                      className="px-2.5 py-1 rounded-md text-xs font-medium bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    onClick={() => handleSetReminder(null)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-accent-primary/5 text-accent-primary/60 hover:bg-accent-primary/10 hover:text-accent-primary transition-colors"
                  >
                    {t("noThanks")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Comments */}
        <div className="px-4 pb-3">
          {sortedComments.length > 3 && !showAllComments && (
            <button
              onClick={() => setShowAllComments(true)}
              className="text-xs text-accent-primary mb-2 block">
              {t("viewAllComments", { count: sortedComments.length })}
            </button>
          )}

          {displayedComments.length > 0 && (
            <div className="space-y-1.5">
              {displayedComments.map((comment) => (
                <div key={comment.id} className="text-sm">
                  <span className="font-semibold text-fg-primary mr-1.5">{comment.author.name}</span>
                  <span className="text-fg-secondary">{comment.text}</span>
                </div>
              ))}
              {showAllComments && sortedComments.length > 3 && (
                <button
                  onClick={() => setShowAllComments(false)}
                  className="text-xs text-accent-primary">
                  {t("showLess")}
                </button>
              )}
            </div>
          )}

          {/* Comment input */}
          {session && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t dark:border-white/5 border-slate-100">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAddComment(e);
                  }
                }}
                placeholder={t("addComment")}
                className="flex-1 bg-transparent text-sm dark:text-white text-slate-800 dark:placeholder:text-fg-tertiary placeholder:text-slate-400 focus:outline-none py-1"
                disabled={addComment.isPending}
              />
              <button
                onClick={handleAddComment}
                disabled={addComment.isPending || !commentText.trim()}
                className="text-accent-primary text-sm font-semibold disabled:opacity-30 transition-opacity">
                {addComment.isPending ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  t("post")
                )}
              </button>
            </div>
          )}
        </div>
      </article>

      {showDashboard && event.isOwner && typeof document !== 'undefined' && createPortal(
        <RsvpDashboard event={event} onClose={() => setShowDashboard(false)} />,
        document.body
      )}

      {showEditForm && event.isOwner && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="dark:bg-[#1A191E] bg-white rounded-[32px] w-full max-w-2xl dark:border-white/5 border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col shadow-2xl">
            <EditEventForm
              event={{
                id: event.id,
                title: event.title,
                description: event.description,
                eventDate: event.eventDate,
                region: event.region,
                imageUrl: event.imageUrl,
                enableRsvp: event.enableRsvp,
              }}
              onSuccess={() => setShowEditForm(false)}
              onClose={() => setShowEditForm(false)}
            />
          </div>
        </div>,
        document.body
      )}

      <InfoMessageToast
        message={infoMessage?.message ?? null}
        type={infoMessage?.type ?? null}
        onClose={() => setInfoMessage(null)}
      />
    </>
  );
};

interface EventFeedProps {
  showCreateForm?: boolean;
  externalRegion?: string;
  hideRegionFilter?: boolean;
}

export const EventFeed: React.FC<EventFeedProps> = ({ showCreateForm = false, externalRegion, hideRegionFilter = false }) => {
  const t = useTranslations("publish");
  const { data: session } = useSession();
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  
  const activeRegion = externalRegion ?? selectedRegion;

  const utils = api.useUtils();

  const {
    data: eventsPages,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = api.event.getPublicEvents.useInfiniteQuery(
    { limit: 10 },
    {
      enabled: true,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  );

  const eventsData = useMemo(
    () => eventsPages?.pages.flatMap((p) => p.items) ?? [],
    [eventsPages?.pages]
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [sentinelVisible, setSentinelVisible] = useState(false);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setSentinelVisible(entries.some((e) => e.isIntersecting));
      },
      { root: null, rootMargin: "600px 0px", threshold: 0 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!sentinelVisible) return;
    if (!hasNextPage) return;
    if (isFetchingNextPage) return;
    void fetchNextPage();
  }, [sentinelVisible, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Real-time: remove deleted events instantly
  const handleEventDeleted = useCallback(
    (data: { eventId: number }) => {
      utils.event.getPublicEvents.setInfiniteData({ limit: 10 }, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((e) => e.id !== data.eventId),
          })),
        };
      });
    },
    [utils.event.getPublicEvents]
  );
  useSocketEvent("event:deleted", handleEventDeleted);

  // Real-time: refresh when events are updated (comments, likes, RSVPs)
  const handleEventUpdated = useCallback(() => {
    void utils.event.getPublicEvents.invalidate();
  }, [utils.event.getPublicEvents]);
  useSocketEvent("event:updated", handleEventUpdated);

  if (isLoading) {
    return (
      <div className="text-center py-20">
        <Loader2 className="animate-spin w-12 h-12 text-accent-primary mx-auto mb-4" />
        <p className="text-fg-secondary">{t("loadingEvents")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 bg-accent-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={32} className="text-accent-primary" />
        </div>
        <h3 className="text-xl font-semibold text-fg-primary mb-2">
          {t("errorLoadingEvents")}
        </h3>
        <p className="text-fg-secondary">{error.message}</p>
      </div>
    );
  }
  
  const filteredEvents = eventsData.filter((event) => activeRegion === "" || event.region === activeRegion);

  return (
    <div className="space-y-6">
      {showCreateForm && session && (
        <>
          {/* Post Composer — matches events.html design */}
          <div className="dark:bg-[#16151A] bg-white rounded-2xl dark:border-white/5 border border-slate-200 p-5">
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-primary/10 shrink-0 overflow-hidden">
                {session.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt="Profile"
                    width={40}
                    height={40}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-accent-primary/20">
                    <span className="text-accent-primary font-bold text-xs">
                      {session.user?.name?.charAt(0)?.toUpperCase() ?? "U"}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <textarea
                  className="w-full bg-transparent border-none focus:ring-0 text-base resize-none placeholder:text-fg-tertiary text-fg-primary"
                  placeholder={t("composerPlaceholder")}
                  rows={2}
                  onFocus={() => setShowForm(true)}
                />
              </div>
            </div>
            <div className="mt-3 pt-3 border-t dark:border-white/5 border-slate-100 flex items-center justify-end">
              <button
                onClick={() => setShowForm(true)}
                type="button"
                className="text-accent-primary font-semibold text-sm hover:text-accent-hover transition-colors underline underline-offset-2 decoration-accent-primary/40 hover:decoration-accent-primary"
              >
                {t("postEvent")}
              </button>
            </div>
          </div>

          {/* Full create form — modal overlay matching create-event.html */}
          {showForm && typeof document !== 'undefined' && createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="dark:bg-[#1A191E] bg-white rounded-[32px] w-full max-w-2xl dark:border-white/5 border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col shadow-2xl">
                <CreateEventForm onSuccess={() => setShowForm(false)} onClose={() => setShowForm(false)} />
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      {/* Region filter — horizontal scroll */}
      {!hideRegionFilter && (
      <div className="overflow-x-auto scrollbar-hide border-b sm:border-none dark:border-white/5 border-slate-200">
        <div className="flex items-center gap-2 px-3 py-2 sm:py-3 min-w-max">
          <button
            type="button"
            onClick={() => setSelectedRegion('')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              selectedRegion === ''
                ? 'bg-accent-primary text-white'
                : 'bg-bg-secondary text-fg-secondary hover:bg-accent-primary/10 hover:text-accent-primary dark:border-white/5 border border-slate-200'
            }`}
          >
            {t("allRegions")}
          </button>
          {REGIONS.filter(r => r.value !== '').map((region) => (
            <button
              key={region.value}
              type="button"
              onClick={() => setSelectedRegion(region.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                selectedRegion === region.value
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-secondary text-fg-secondary hover:bg-accent-primary/10 hover:text-accent-primary dark:border-white/5 border border-slate-200'
              }`}
            >
              {region.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {!filteredEvents || filteredEvents.length === 0 ? (
        <div className="text-center py-20 px-4">
          <div className="w-16 h-16 bg-accent-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Calendar size={32} className="text-accent-primary" />
          </div>
          <h3 className="text-xl font-semibold text-fg-primary mb-2">{t("noEventsTitle")}</h3>
          <p className="text-fg-secondary text-sm">
            {selectedRegion
              ? t("noEventsRegion", { region: REGIONS.find((r) => r.value === selectedRegion)?.label ?? selectedRegion })
              : t("noEventsDefault")}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredEvents.map((event) => (
            <EventCard
              key={event.id}
              event={{
                ...event,
                createdById: event.createdById,
                isOwner: session?.user?.id === event.createdById,
              }}
            />
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-6" />

          {isFetchingNextPage && (
            <div className="text-center py-8">
              <Loader2 className="animate-spin w-8 h-8 text-accent-primary mx-auto mb-2" />
              <p className="text-fg-secondary text-sm">{t("loadingMoreEvents")}</p>
            </div>
          )}

          {!hasNextPage && filteredEvents.length > 0 && (
            <div className="text-center py-6">
              <p className="text-fg-tertiary text-sm">{t("allCaughtUp")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
