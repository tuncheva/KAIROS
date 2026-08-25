"use client";

/**
 * One event, as the feed shows it.
 *
 * The old card led with the author and buried the date in a grey strip below
 * the description, so the two questions people actually ask — *what is it* and
 * *when* — were the two hardest things to find. Here the cover carries the
 * card, a date block sits beside the title, and RSVP is a single segmented
 * control in the footer rather than a separate stacked section with its own
 * heading. Everything the old card could do it still does; edit, delete and the
 * host's response dashboard moved into the overflow menu.
 */

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  BarChart3,
  Bell,
  Globe2,
  Heart,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Send,
  Share2,
  Trash2,
  X,
} from "lucide-react";

import { api } from "~/trpc/react";
import { useDateFormat } from "~/hooks/useDateFormat";
import { EditEventForm } from "~/components/events/EditEventForm";
import {
  eventDateParts,
  regionLabel,
  type FeedEventForViewer,
} from "./feedData";
import {
  useOptimisticDelete,
  useOptimisticLike,
  useOptimisticRsvp,
} from "./eventMutations";
import { InfoToast, PersonAvatar, Stamp, type InfoMessage } from "./publishUi";
import { RsvpDashboard } from "./RsvpDashboard";

const ALLOWED_IMAGE_HOSTS = ["utfs.io", "lh3.googleusercontent.com"];

/** Only render covers we have told `next/image` about; anything else is text. */
function isValidImageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return ALLOWED_IMAGE_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

const REMINDER_CHOICES = [30, 60, 180, 1440, 4320] as const;

type RsvpStatus = "going" | "maybe" | "not_going";

const RSVP_OPTIONS: { status: RsvpStatus; key: "going" | "maybe" | "cantGo" }[] =
  [
    { status: "going", key: "going" },
    { status: "maybe", key: "maybe" },
    { status: "not_going", key: "cantGo" },
  ];

export function EventCard({
  event,
  delayMs = 0,
}: {
  event: FeedEventForViewer;
  /** Stagger for the entrance, in feed order. */
  delayMs?: number;
}) {
  const t = useTranslations("publish");
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  const { formatDate } = useDateFormat();
  const utils = api.useUtils();

  const [info, setInfo] = useState<InfoMessage | null>(null);
  const [commentText, setCommentText] = useState("");
  const [showAllComments, setShowAllComments] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [lastRsvp, setLastRsvp] = useState<RsvpStatus | null>(null);

  const toggleLike = useOptimisticLike(event.id);
  const updateRsvp = useOptimisticRsvp(event.id);
  const deleteEvent = useOptimisticDelete(event.id, {
    onError: (message) => setInfo({ message, type: "error" }),
    onSuccess: () => {
      setShowDashboard(false);
      setDeleteArmed(false);
      setInfo({ message: t("eventDeleted"), type: "info" });
    },
  });

  const addComment = api.event.addComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      void utils.event.getPublicEvents.invalidate();
    },
    onError: (error) => setInfo({ message: error.message, type: "error" }),
  });

  const startDirectChat = api.chat.getOrCreateDirectConversation.useMutation({
    onError: (error) => setInfo({ message: error.message, type: "error" }),
    onSuccess: (data) => router.push(`/chat?conversationId=${data.conversationId}`),
  });

  /** A half-pressed delete disarms itself so it cannot be confirmed by accident later. */
  useEffect(() => {
    if (!deleteArmed) return;
    const timer = setTimeout(() => setDeleteArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [deleteArmed]);

  const date = useMemo(
    () => eventDateParts(event.eventDate, locale),
    [event.eventDate, locale],
  );

  const comments = useMemo(
    () =>
      [...(event.comments ?? [])].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [event.comments],
  );
  const shownComments = showAllComments ? comments : comments.slice(0, 3);

  const requireSession = (message: string) => {
    if (session) return true;
    setInfo({ message, type: "error" });
    return false;
  };

  const handleRsvp = (status: RsvpStatus) => {
    if (!requireSession(t("signInToRsvp"))) return;
    updateRsvp.mutate({ eventId: event.id, status });
    setLastRsvp(status);
    setShowReminderPicker(status !== "not_going");
  };

  const handleReminder = (minutes: number | null) => {
    updateRsvp.mutate({
      eventId: event.id,
      status: lastRsvp ?? event.userRsvpStatus ?? "going",
      reminderMinutesBefore: minutes,
    });
    setShowReminderPicker(false);
    if (minutes === null) return;

    const time =
      minutes >= 1440
        ? t("reminderDays", { count: minutes / 1440 })
        : minutes >= 60
          ? t("reminderHours", { count: minutes / 60 })
          : t("reminderMinutes", { count: minutes });
    setInfo({ message: t("reminderSet", { time }), type: "info" });
  };

  const handleBell = () => {
    if (!requireSession(t("signInToManageNotifications"))) return;
    if (!event.enableRsvp) {
      setInfo({ message: t("likeCommentNotificationsAuto"), type: "info" });
      return;
    }
    setShowReminderPicker((open) => !open);
  };

  const handleComment = () => {
    if (!requireSession(t("signInToComment"))) return;
    if (!commentText.trim()) return;
    addComment.mutate({ eventId: event.id, text: commentText.trim() });
  };

  const handleDelete = () => {
    if (!requireSession(t("signInToDelete"))) return;
    if (!event.isOwner) return;

    if (!deleteArmed) {
      setDeleteArmed(true);
      setInfo({ message: t("deleteConfirm"), type: "info" });
      return;
    }
    deleteEvent.mutate({ eventId: event.id });
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/publish?event=${event.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setInfo({ message: t("linkCopied"), type: "info" });
    } catch {
      setInfo({ message: t("failedToCopyLink"), type: "error" });
    }
  };

  const isPast = new Date(event.eventDate).getTime() < Date.now();
  const attending = event.rsvpCounts.going;
  const maybes = event.rsvpCounts.maybe;

  return (
    <>
      <article
        id={`event-${event.id}`}
        data-testid="event-card"
        className="dash-rise overflow-hidden rounded-2xl border border-slate-200 bg-white target:ring-2 target:ring-accent-primary/50 dark:border-white/10 dark:bg-[#0e0e14]"
        style={{ animationDelay: `${delayMs}ms` }}
      >
        {/* Who posted it, and how far it reaches. */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <PersonAvatar name={event.author.name} image={event.author.image} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg-primary">
              {event.author.name ?? t("someone")}
            </p>
            <Stamp className="normal-case tracking-normal">
              {event.isOwner ? t("youAreHosting") : t("hosting")}
              {event.createdAt
                ? ` · ${formatDate(new Date(event.createdAt), "withYear")}`
                : ""}
            </Stamp>
          </div>

          <span className="hidden items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 sm:flex dark:bg-white/5">
            <Globe2 size={11} className="text-fg-tertiary" />
            <Stamp className="text-[9.5px] tracking-[0.12em]">
              {regionLabel(event.region)}
            </Stamp>
          </span>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowMenu((open) => !open)}
              aria-label={t("moreActions")}
              aria-expanded={showMenu}
              className="rounded-lg p-1.5 text-fg-quaternary transition-colors hover:bg-slate-100 hover:text-accent-primary dark:hover:bg-white/5"
            >
              <MoreHorizontal size={18} />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[184px] rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-white/[0.06] dark:bg-[#16151A]">
                  <button
                    type="button"
                    onClick={() => {
                      void handleShare();
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    <Share2 size={15} />
                    {t("share")}
                  </button>

                  {!event.isOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        if (!requireSession(t("signInToMessageCreators"))) return;
                        startDirectChat.mutate({ otherUserId: event.createdById });
                      }}
                      disabled={startDirectChat.isPending}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                    >
                      <MessageCircle size={15} />
                      {startDirectChat.isPending
                        ? t("opening")
                        : t("messageCreator")}
                    </button>
                  )}

                  {event.isOwner && (
                    <>
                      {event.enableRsvp && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowDashboard(true);
                            setShowMenu(false);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                        >
                          <BarChart3 size={15} />
                          {t("responsesDashboard")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setShowEditForm(true);
                          setShowMenu(false);
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                      >
                        <Pencil size={15} />
                        {t("edit.title")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleDelete();
                          if (deleteArmed) setShowMenu(false);
                        }}
                        disabled={deleteEvent.isPending}
                        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors ${
                          deleteArmed
                            ? "bg-red-500/5 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                            : "text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                        }`}
                      >
                        <Trash2 size={15} />
                        {deleteArmed
                          ? t("confirmDeleteEvent")
                          : t("deleteEvent")}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* The cover carries the card. */}
        {isValidImageUrl(event.imageUrl) && (
          <div className="relative aspect-[1200/630] border-y border-slate-100 bg-bg-tertiary dark:border-white/[0.07]">
            <Image
              src={event.imageUrl}
              alt={event.title}
              fill
              sizes="(max-width: 1024px) 100vw, 700px"
              className="object-cover"
            />
          </div>
        )}

        {/* When, then what. */}
        <div className="flex items-start gap-4 p-4">
          <div
            className={`flex w-[58px] shrink-0 flex-col items-center gap-px rounded-xl border py-2 ${
              isPast
                ? "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.04]"
                : "border-accent-primary/30 bg-accent-primary/[0.09]"
            }`}
          >
            <Stamp
              className={`text-[9.5px] tracking-[0.14em] ${
                isPast ? "" : "text-accent-primary"
              }`}
            >
              {date.month}
            </Stamp>
            <span className="text-[22px] font-semibold leading-tight text-fg-primary">
              {date.day}
            </span>
            <span className="kairos-mono text-[10px] text-fg-tertiary">
              {date.time}
            </span>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h3 className="text-[19px] font-semibold leading-snug tracking-tight text-fg-primary">
              {event.title}
            </h3>
            <p className="whitespace-pre-line text-sm leading-relaxed text-fg-secondary">
              {event.description}
            </p>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="kairos-mono text-[11px] text-fg-tertiary">
                {regionLabel(event.region)}
              </span>
              {event.enableRsvp && (
                <>
                  <span aria-hidden="true" className="text-fg-quaternary">
                    ·
                  </span>
                  <span className="kairos-mono text-[11px] text-fg-tertiary">
                    {t("attendanceLine", { going: attending, maybe: maybes })}
                  </span>
                </>
              )}
              {isPast && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-fg-tertiary dark:bg-white/5">
                  {t("past")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* One row of actions: your answer on the left, everyone else's on the right. */}
        <div className="flex flex-wrap items-center gap-2.5 px-4 pb-4">
          {event.enableRsvp && (
            <div
              role="group"
              aria-label={t("rsvp")}
              className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-white/10"
            >
              {RSVP_OPTIONS.map((option) => {
                const active = event.userRsvpStatus === option.status;
                return (
                  <button
                    key={option.status}
                    type="button"
                    onClick={() => handleRsvp(option.status)}
                    disabled={updateRsvp.isPending}
                    aria-pressed={active}
                    className={`h-9 px-3.5 text-[13px] transition-colors sm:px-4 ${
                      active
                        ? "bg-accent-primary font-semibold text-white"
                        : "text-fg-secondary hover:bg-slate-100 dark:hover:bg-white/5"
                    }`}
                  >
                    {t(option.key)}
                  </button>
                );
              })}
            </div>
          )}

          <span className="flex-1" />

          <button
            type="button"
            onClick={() => {
              if (!requireSession(t("signInToLike"))) return;
              toggleLike.mutate({ eventId: event.id });
            }}
            disabled={toggleLike.isPending}
            aria-pressed={event.hasLiked}
            aria-label={t("likes")}
            className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors ${
              event.hasLiked
                ? "border-accent-primary/50 bg-accent-primary/20 font-medium text-accent-primary"
                : "border-slate-200 text-fg-secondary hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
            }`}
          >
            <Heart size={15} className={event.hasLiked ? "fill-current" : ""} />
            {event.likeCount}
          </button>

          <button
            type="button"
            onClick={() => setShowComments((open) => !open)}
            aria-expanded={showComments}
            className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[13px] text-fg-secondary transition-colors hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
          >
            <MessageCircle size={15} />
            {event.commentCount}
          </button>

          <button
            type="button"
            onClick={handleBell}
            aria-label={t("eventNotifications")}
            title={t("eventNotifications")}
            className={`grid h-9 w-9 place-items-center rounded-lg border transition-colors ${
              showReminderPicker
                ? "border-accent-primary/50 bg-accent-primary/20 text-accent-primary"
                : "border-slate-200 text-fg-secondary hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
            }`}
          >
            <Bell size={15} className={showReminderPicker ? "fill-current" : ""} />
          </button>
        </div>

        {/* Reminder choice, offered right after you say you are coming. */}
        {showReminderPicker &&
          (lastRsvp === "going" ||
            lastRsvp === "maybe" ||
            event.userRsvpStatus === "going" ||
            event.userRsvpStatus === "maybe") && (
            <div className="mx-4 mb-4 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-accent-primary">
                  <Bell size={12} />
                  {t("getNotified")}
                </span>
                <button
                  type="button"
                  onClick={() => setShowReminderPicker(false)}
                  aria-label={t("noThanks")}
                  className="p-0.5 text-fg-tertiary hover:text-fg-primary"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_CHOICES.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => handleReminder(minutes)}
                    className="rounded-md bg-accent-primary/10 px-2.5 py-1 text-xs font-medium text-accent-primary transition-colors hover:bg-accent-primary/20"
                  >
                    {minutes >= 1440
                      ? t("reminderDays", { count: minutes / 1440 })
                      : minutes >= 60
                        ? t("reminderHours", { count: minutes / 60 })
                        : t("reminderMinutes", { count: minutes })}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handleReminder(null)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-tertiary transition-colors hover:bg-slate-100 dark:hover:bg-white/5"
                >
                  {t("noThanks")}
                </button>
              </div>
            </div>
          )}

        {/* Comments stay folded until asked for — the feed is for scanning. */}
        {showComments && (
          <div className="border-t border-slate-100 px-4 py-3 dark:border-white/[0.06]">
            {comments.length > 3 && !showAllComments && (
              <button
                type="button"
                onClick={() => setShowAllComments(true)}
                className="mb-2 block text-xs text-accent-primary"
              >
                {t("viewAllComments", { count: comments.length })}
              </button>
            )}

            {shownComments.length > 0 ? (
              <ul className="space-y-1.5">
                {shownComments.map((comment) => (
                  <li key={comment.id} className="text-sm">
                    <span className="mr-1.5 font-semibold text-fg-primary">
                      {comment.author.name}
                    </span>
                    <span className="text-fg-secondary">{comment.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-tertiary">{t("noCommentsYet")}</p>
            )}

            {showAllComments && comments.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllComments(false)}
                className="mt-1.5 text-xs text-accent-primary"
              >
                {t("showLess")}
              </button>
            )}

            {session && (
              <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2 dark:border-white/[0.06]">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleComment();
                    }
                  }}
                  placeholder={t("addComment")}
                  disabled={addComment.isPending}
                  className="flex-1 bg-transparent py-1 text-sm text-fg-primary placeholder:text-fg-tertiary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleComment}
                  disabled={addComment.isPending || !commentText.trim()}
                  aria-label={t("post")}
                  className="text-accent-primary transition-opacity disabled:opacity-30"
                >
                  {addComment.isPending ? (
                    <Loader2 className="animate-spin" size={15} />
                  ) : (
                    <Send size={15} />
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </article>

      {showDashboard &&
        event.isOwner &&
        typeof document !== "undefined" &&
        createPortal(
          <RsvpDashboard event={event} onClose={() => setShowDashboard(false)} />,
          document.body,
        )}

      {showEditForm &&
        event.isOwner &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl dark:border-white/5 dark:bg-[#1A191E]">
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
          document.body,
        )}

      <InfoToast info={info} onClose={() => setInfo(null)} />
    </>
  );
}
