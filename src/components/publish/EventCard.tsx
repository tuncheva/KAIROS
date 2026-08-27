"use client";

/**
 * One event, as the feed shows it.
 *
 * ## What the card answers
 *
 * In order, and before it asks for anything: *why is this in front of me*, *what
 * is it*, *when*, *where*, and *is there still room*. The old card led with the
 * author and buried the date in a grey strip below the description, so the two
 * questions people actually ask were the two hardest things to find.
 *
 * ## What left
 *
 * Comments. Every comment on every event on the page used to ship with the feed
 * and render two at a time behind a toggle — the single heaviest thing about
 * the surface, in exchange for a preview nobody could read. The count is still
 * here and it is a link; the thread lives on the event page.
 *
 * ## What arrived
 *
 * The reason line, the follow button, the facts row and Save. The first two are
 * only possible because the follow graph exists; the third is only possible now
 * an event can say where it is; the fourth is what people were using *Maybe*
 * for, at the cost of the host's headcount.
 */

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  BarChart3,
  Bell,
  Bookmark,
  Clock,
  Heart,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { api } from "~/trpc/react";
import { ProfileLink } from "~/components/profile/ProfileLink";
import { useDateFormat } from "~/hooks/useDateFormat";
import { EditEventForm } from "~/components/events/EditEventForm";
import {
  countdownFor,
  coverClass,
  eventDateParts,
  formatTimeRange,
  isPast as isEventPast,
  placeLine,
  placesLeft,
  regionLabel,
  type FeedEventForViewer,
} from "./feedData";
import {
  useOptimisticDelete,
  useOptimisticLike,
  useOptimisticRsvp,
  useOptimisticSave,
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

/** Places left below this many turns the chip into a warning. */
const NEARLY_FULL = 10;

export function EventCard({ event }: { event: FeedEventForViewer }) {
  const t = useTranslations("publish");
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  const { formatDate } = useDateFormat();
  const utils = api.useUtils();

  const [info, setInfo] = useState<InfoMessage | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [lastRsvp, setLastRsvp] = useState<RsvpStatus | null>(null);

  const toggleLike = useOptimisticLike(event.id);
  const toggleSave = useOptimisticSave(event.id);
  const updateRsvp = useOptimisticRsvp(event.id);
  const deleteEvent = useOptimisticDelete(event.id, {
    onError: (message) => setInfo({ message, type: "error" }),
    onSuccess: () => {
      setShowDashboard(false);
      setDeleteArmed(false);
      setInfo({ message: t("eventDeleted"), type: "info" });
    },
  });

  const refreshFollows = {
    onSettled: () => {
      void utils.event.getFeed.invalidate();
    },
  };
  const follow = api.profile.follow.useMutation(refreshFollows);
  const unfollow = api.profile.unfollow.useMutation(refreshFollows);

  const startDirectChat = api.chat.getOrCreateDirectConversation.useMutation({
    onSuccess: (conversation) => router.push(`/chat/${conversation.conversationId}`),
    onError: (error) => setInfo({ message: error.message, type: "error" }),
  });

  /** An armed delete disarms itself, so a menu left open is not a loaded gun. */
  useEffect(() => {
    if (!deleteArmed) return;
    const timer = setTimeout(() => setDeleteArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [deleteArmed]);

  const date = useMemo(
    () => eventDateParts(event.eventDate, locale),
    [event.eventDate, locale],
  );

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
    /* The event has its own address now, so a shared link opens the page —
       including for people without an account. */
    const url = `${window.location.origin}/events/${event.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setInfo({ message: t("linkCopied"), type: "info" });
    } catch {
      setInfo({ message: t("failedToCopyLink"), type: "error" });
    }
  };

  const handleFollow = () => {
    if (!requireSession(t("signInToFollow"))) return;
    if (!event.author.id) return;

    if (event.viewerFollowsAuthor) {
      unfollow.mutate({ userId: event.author.id });
    } else {
      follow.mutate(
        { userId: event.author.id },
        { onError: (error) => setInfo({ message: error.message, type: "error" }) },
      );
    }
  };

  const past = isEventPast(event);
  const left = placesLeft(event);
  const full = left === 0;

  /** Why this row is in front of you, in one line. */
  const reasonLine = (() => {
    if (event.isOwner) return t("youAreHosting");
    if (!event.reason) return t("hosting");

    switch (event.reason.kind) {
      case "hosting":
        return t("youAreHosting");
      case "followedHost":
        return t("reasonFollowedHost");
      case "followedGoing":
        return event.reason.name
          ? event.reason.count > 1
            ? t("reasonFollowedGoingNamed", {
                name: event.reason.name,
                count: event.reason.count - 1,
              })
            : t("reasonFollowedGoingOne", { name: event.reason.name })
          : t("reasonFollowedGoing", { count: event.reason.count });
      default:
        return t("hosting");
    }
  })();

  /**
   * The three chips that ride on the cover.
   *
   * On a card with an image they sit on a scrim; on one without they sit in a
   * plain row where the image would have been, so the card keeps the same
   * reading order either way.
   */
  const countdown = countdownFor(event);
  /* On a photograph the chips need a scrim; on a wash they sit on a frosted
     panel that reads in both themes without hiding the colour underneath. */
  const chipBase = isValidImageUrl(event.imageUrl)
    ? "bg-black/55 text-white backdrop-blur-sm"
    : "bg-bg-elevated/75 text-fg-secondary backdrop-blur-sm";

  const coverChips = (
    <>
      {countdown && (
        <span
          className={`kairos-stamp flex items-center gap-1 rounded-md px-2 py-1 text-[9.5px] tracking-[0.12em] ${
            countdown.kind === "now" || countdown.kind === "soon"
              ? "bg-red-500/85 text-white"
              : "bg-accent-primary/85 text-white"
          }`}
        >
          <Clock size={10} />
          {countdown.kind === "now"
            ? t("countdown.now")
            : countdown.kind === "soon"
              ? t("countdown.soon", { count: countdown.count })
              : countdown.kind === "hours"
                ? t("countdown.hours", { count: countdown.count })
                : t("countdown.days", { count: countdown.count })}
        </span>
      )}
      {event.topic && (
        <span
          className={`kairos-stamp rounded-md px-2 py-1 text-[9.5px] tracking-[0.12em] ${chipBase}`}
        >
          {t(`topics.${event.topic}`)}
        </span>
      )}
      <span className="flex-1" />
      <span
        className={`kairos-stamp flex items-center gap-1 rounded-md px-2 py-1 text-[9.5px] tracking-[0.12em] ${chipBase}`}
      >
        <MapPin size={10} />
        {regionLabel(event.region)}
      </span>
    </>
  );

  /**
   * "Pavel, Гери and 34 others are going".
   *
   * Names first because a name you recognise decides this faster than any
   * count; the bare count is the fallback when no faces came back with the row.
   */
  const attendanceLine = (() => {
    const names = event.attendees
      .map((person) => person.name)
      .filter((name): name is string => !!name);
    const others = event.rsvpCounts.going - names.length;

    if (names.length === 0) {
      return t("attendanceLine", {
        going: event.rsvpCounts.going,
        maybe: event.rsvpCounts.maybe,
      });
    }
    if (others <= 0) {
      return t("attendanceNames", { names: names.join(", ") });
    }
    return t("attendanceNamesAndMore", {
      names: names.join(", "),
      count: others,
    });
  })();

  return (
    <>
      <article
        id={`event-${event.id}`}
        data-testid="event-card"
        className="dash-rise overflow-hidden rounded-2xl bg-bg-elevated shadow-[0_0_0_0.5px_rgba(200,200,200,0.55),0_2px_8px_-2px_rgba(0,0,0,0.08),0_4px_16px_-4px_rgba(0,0,0,0.06)] target:ring-2 target:ring-accent-primary/50 dark:shadow-[0_0_0_0.5px_rgba(60,60,60,0.9),0_2px_12px_-2px_rgba(0,0,0,0.4),0_6px_24px_-6px_rgba(0,0,0,0.3)]"
      >
        {/* Who posted it, and why you are seeing it. */}
        <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
          <ProfileLink userId={event.author.id} name={event.author.name}>
            <PersonAvatar name={event.author.name} image={event.author.image} />
          </ProfileLink>
          <div className="min-w-0 flex-1">
            <ProfileLink
              userId={event.author.id}
              name={event.author.name}
              className="block max-w-full rounded-md text-left"
            >
              <p className="truncate text-sm font-semibold text-fg-primary">
                {event.author.name ?? t("someone")}
              </p>
            </ProfileLink>
            <Stamp className="flex items-center gap-1.5 text-[9.5px] tracking-[0.12em]">
              {event.isOwner || event.reason ? (
                <span className="text-accent-primary">{reasonLine}</span>
              ) : (
                reasonLine
              )}
              {/* Said out loud, to everyone, not just the host: somebody who
                  already said yes needs to know the plan moved under them. */}
              {event.updatedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    title={t("editedOn", {
                      date: formatDate(new Date(event.updatedAt), "withYear"),
                    })}
                  >
                    {t("edited")}
                  </span>
                </>
              )}
            </Stamp>
          </div>

          {/* Follow lives on the card because this is where you meet people —
              sending someone to a profile to press it loses the event. */}
          {!event.isOwner && event.author.id && (
            <button
              type="button"
              onClick={handleFollow}
              disabled={follow.isPending || unfollow.isPending}
              aria-pressed={event.viewerFollowsAuthor}
              className={`kairos-stamp hidden h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[9.5px] tracking-[0.12em] transition-colors sm:flex ${
                event.viewerFollowsAuthor
                  ? "bg-slate-100 text-fg-tertiary hover:text-fg-secondary dark:bg-white/5"
                  : "bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20"
              }`}
            >
              {!event.viewerFollowsAuthor && <UserPlus size={11} />}
              {event.viewerFollowsAuthor ? t("following") : t("follow")}
            </button>
          )}

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

                  {!event.isOwner && event.author.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        handleFollow();
                      }}
                      disabled={follow.isPending || unfollow.isPending}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-slate-50 sm:hidden dark:hover:bg-white/5"
                    >
                      <UserPlus size={15} />
                      {event.viewerFollowsAuthor ? t("following") : t("follow")}
                    </button>
                  )}

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

                  {event.viewerCanEdit && (
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
                      {/* Editing is shared with co-hosts; deleting is not.
                          Being added as a co-host must never cost somebody
                          their event. */}
                      {event.isOwner && (
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
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* The cover carries the card, and opens the page.

            The chips ride on top of it rather than sitting in a row underneath:
            how soon, what kind, and which town are the three things a person
            reads before anything else, and they should not cost a line each. */}
        {isValidImageUrl(event.imageUrl) ? (
          <Link
            href={`/events/${event.id}`}
            className="relative block aspect-[1200/630] bg-bg-tertiary"
          >
            <Image
              src={event.imageUrl}
              alt={event.title}
              fill
              sizes="(max-width: 1024px) 100vw, 820px"
              className="object-cover"
            />
            <span className="absolute inset-x-3 top-3 flex items-center gap-1.5">
              {coverChips}
            </span>
          </Link>
        ) : (
          /* No photograph — which is most events. A wash rather than nothing:
             a feed of grey rectangles is a feed nobody scans. */
          <Link
            href={`/events/${event.id}`}
            className={`relative flex h-[104px] items-start px-3.5 pt-3 ${coverClass(event)}`}
          >
            <span className="flex w-full items-center gap-1.5">{coverChips}</span>
          </Link>
        )}

        {/* When, then what, then where. */}
        <div className="flex items-start gap-3.5 px-3.5 pt-3">
          <div
            className={`flex w-[58px] shrink-0 flex-col items-center gap-px rounded-xl border py-2 ${
              past
                ? "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.04]"
                : "border-accent-primary/30 bg-accent-primary/[0.09]"
            }`}
          >
            <Stamp
              className={`text-[9.5px] tracking-[0.14em] ${
                past ? "" : "text-accent-primary"
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
            <Link
              href={`/events/${event.id}`}
              className="rounded-md transition-colors hover:text-accent-primary"
            >
              <h3 className="font-display text-[20px] font-semibold leading-tight tracking-tight text-fg-primary">
                {event.title}
              </h3>
            </Link>
            <p className="line-clamp-2 whitespace-pre-line text-[13px] leading-relaxed text-fg-tertiary">
              {event.description}
            </p>

            {/* The facts a person needs before they can decide. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] text-fg-secondary dark:border-white/10 dark:bg-white/5">
                <MapPin size={11} className="text-accent-primary" />
                <span className="max-w-[220px] truncate">{placeLine(event)}</span>
              </span>
              <span className="flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] text-fg-secondary dark:border-white/10 dark:bg-white/5">
                <Clock size={11} className="text-accent-primary" />
                {formatTimeRange(event, locale)}
              </span>
              {!past && left !== null && (
                <span
                  className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] ${
                    full
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : left <= NEARLY_FULL
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "border border-slate-200 bg-slate-50 text-fg-secondary dark:border-white/10 dark:bg-white/5"
                  }`}
                >
                  <Users size={11} />
                  {full ? t("soldOut") : t("placesLeft", { count: left })}
                </span>
              )}
              {past && (
                <span className="flex h-7 items-center rounded-lg bg-slate-100 px-2 text-[11px] text-fg-tertiary dark:bg-white/5">
                  {t("past")}
                </span>
              )}
            </div>

          </div>
        </div>

        {/* Who else is coming — faces first, because a name you recognise is
            worth more than the number beside it. */}
        {event.enableRsvp && event.rsvpCounts.going > 0 && (
          <div className="flex items-center gap-2.5 px-3.5 pt-2.5">
            {event.attendees.length > 0 && (
              <span className="flex shrink-0">
                {event.attendees.map((person, index) => (
                  <span
                    key={person.id}
                    className={`rounded-full ring-2 ring-bg-elevated ${index > 0 ? "-ml-1.5" : ""}`}
                  >
                    <PersonAvatar
                      name={person.name}
                      image={person.image}
                      size="sm"
                    />
                  </span>
                ))}
              </span>
            )}
            <span className="min-w-0 truncate text-[11.5px] text-fg-tertiary">
              {attendanceLine}
            </span>
          </div>
        )}

        {/* The answer, given its own full-width row. It is the one thing the
            card is asking for, and it used to share a line with five icons. */}
        {event.enableRsvp && !past && (
          <div
            role="group"
            aria-label={t("rsvp")}
            className="flex gap-1.5 px-3.5 pt-3"
          >
            {RSVP_OPTIONS.map((option) => {
              const active = event.userRsvpStatus === option.status;
              /* A full event still takes Maybe and Cannot go — it is only the
                 seat that has run out. */
              const blocked = full && option.status === "going" && !active;
              return (
                <button
                  key={option.status}
                  type="button"
                  onClick={() => handleRsvp(option.status)}
                  disabled={updateRsvp.isPending || blocked}
                  aria-pressed={active}
                  title={blocked ? t("soldOut") : undefined}
                  className={`h-9 flex-1 rounded-lg text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? "bg-accent-primary text-white shadow-[0_5px_14px_-6px_rgb(var(--accent-primary)/0.85)]"
                      : "bg-slate-100 text-fg-secondary hover:text-fg-primary dark:bg-white/5"
                  }`}
                >
                  {t(option.key)}
                </button>
              );
            })}
          </div>
        )}

        {/* Everyone else's reaction, on a hairline of its own. */}
        <div className="mt-3 flex items-center gap-0.5 border-t border-slate-100 px-2.5 py-2 dark:border-white/[0.06]">

          <button
            type="button"
            onClick={() => {
              if (!requireSession(t("signInToLike"))) return;
              toggleLike.mutate({ eventId: event.id });
            }}
            disabled={toggleLike.isPending}
            aria-pressed={event.hasLiked}
            aria-label={t("likes")}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition-colors ${
              event.hasLiked
                ? "text-red-500 dark:text-red-400"
                : "text-fg-tertiary hover:bg-slate-100 hover:text-fg-secondary dark:hover:bg-white/5"
            }`}
          >
            <Heart size={15} className={event.hasLiked ? "fill-current" : ""} />
            <span className="kairos-mono">{event.likeCount}</span>
          </button>

          {/* The count is a link, not a toggle: the thread is on the page. */}
          <Link
            href={`/events/${event.id}#discussion`}
            aria-label={t("comments")}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-fg-tertiary transition-colors hover:bg-slate-100 hover:text-fg-secondary dark:hover:bg-white/5"
          >
            <MessageCircle size={15} />
            <span className="kairos-mono">{event.commentCount}</span>
          </Link>

          <button
            type="button"
            onClick={() => {
              if (!requireSession(t("signInToSave"))) return;
              toggleSave.mutate({ eventId: event.id });
            }}
            disabled={toggleSave.isPending}
            aria-pressed={event.hasSaved}
            aria-label={t("save")}
            title={event.hasSaved ? t("saved") : t("save")}
            className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${
              event.hasSaved
                ? "text-accent-primary"
                : "text-fg-tertiary hover:bg-slate-100 hover:text-fg-secondary dark:hover:bg-white/5"
            }`}
          >
            <Bookmark size={15} className={event.hasSaved ? "fill-current" : ""} />
          </button>

          <span className="flex-1" />

          <button
            type="button"
            onClick={handleBell}
            aria-label={t("eventNotifications")}
            title={t("eventNotifications")}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition-colors ${
              showReminderPicker
                ? "text-accent-primary"
                : "text-fg-tertiary hover:bg-slate-100 hover:text-fg-secondary dark:hover:bg-white/5"
            }`}
          >
            <Bell size={15} className={showReminderPicker ? "fill-current" : ""} />
            <span className="hidden sm:inline">{t("remindMe")}</span>
          </button>
        </div>

        {/* Reminder choice, offered right after you say you are coming. */}
        {showReminderPicker &&
          (lastRsvp === "going" ||
            lastRsvp === "maybe" ||
            event.userRsvpStatus === "going" ||
            event.userRsvpStatus === "maybe") && (
            <div className="mx-3.5 mb-3.5 rounded-lg bg-slate-50 p-2.5 dark:bg-white/[0.03]">
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
      </article>

      {showDashboard &&
        event.viewerCanEdit &&
        typeof document !== "undefined" &&
        createPortal(
          <RsvpDashboard event={event} onClose={() => setShowDashboard(false)} />,
          document.body,
        )}

      {showEditForm &&
        event.viewerCanEdit &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl dark:border-white/5 dark:bg-[#1A191E]">
              <EditEventForm
                event={{
                  id: event.id,
                  title: event.title,
                  description: event.description,
                  eventDate: event.eventDate,
                  endsAt: event.endsAt,
                  region: event.region,
                  venue: event.venue,
                  address: event.address,
                  capacity: event.capacity,
                  topic: event.topic,
                  coverTheme: event.coverTheme,
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
