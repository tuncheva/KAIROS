"use client";

/**
 * The event, in full.
 *
 * Everything a card cannot hold: the whole description, where it actually is,
 * who is coming, who is hosting, and the thread. The RSVP decision is pinned —
 * on a phone as a bar at the bottom of the screen, on a desktop as the first
 * card in the side column — because scrolling back up to answer is the one
 * thing this page must never ask for.
 *
 * Renders for signed-out visitors down to the RSVP buttons, which become a
 * prompt to sign in rather than disappearing. A stranger who followed a link
 * should be able to read everything and see exactly what they are missing.
 */

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellOff,
  Bookmark,
  Clock,
  Heart,
  Loader2,
  MapPin,
  Pencil,
  Share2,
  UserPlus,
  Users,
} from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { ProfileLink } from "~/components/profile/ProfileLink";
import { useDateFormat } from "~/hooks/useDateFormat";
import {
  canRemind,
  coverClass,
  formatTimeRange,
  isPast as isEventPast,
  placeLine,
  regionLabel,
} from "~/components/publish/feedData";
import {
  InfoToast,
  PersonAvatar,
  Stamp,
  type InfoMessage,
} from "~/components/publish/publishUi";
import { EditEventForm } from "./EditEventForm";
import { EventDiscussion } from "./EventDiscussion";

const ALLOWED_IMAGE_HOSTS = ["utfs.io", "lh3.googleusercontent.com"];

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

export function EventPage({ eventId }: { eventId: number }) {
  const t = useTranslations("publish");
  const locale = useLocale();
  const utils = api.useUtils();
  const { data: session } = useSession();
  const { formatDate } = useDateFormat();

  const [info, setInfo] = useState<InfoMessage | null>(null);
  const [showReminders, setShowReminders] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);

  const { data, isLoading, error } = api.event.getById.useQuery({ eventId });

  const refresh = {
    onSettled: () => {
      void utils.event.getById.invalidate({ eventId });
      void utils.event.getFeed.invalidate();
    },
  };
  const toggleLike = api.event.toggleLike.useMutation(refresh);
  const toggleSave = api.event.toggleSave.useMutation(refresh);
  const updateRsvp = api.event.updateRsvp.useMutation(refresh);
  const follow = api.profile.follow.useMutation(refresh);
  const unfollow = api.profile.unfollow.useMutation(refresh);

  const { data: attendees } = api.event.getAttendees.useQuery(
    { eventId, status: "going" },
    { enabled: !!data?.event.enableRsvp },
  );

  if (isLoading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg-primary">
        <Loader2 className="h-10 w-10 animate-spin text-accent-primary" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg-primary px-6 text-center">
        <div>
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent-primary/10">
            <AlertCircle size={30} className="text-accent-primary" />
          </div>
          <h1 className="mb-2 text-xl font-semibold text-fg-primary">
            {t("eventNotFound")}
          </h1>
          <p className="mb-6 text-sm text-fg-secondary">
            {t("eventNotFoundBody")}
          </p>
          <Link
            href="/publish"
            className="inline-flex h-10 items-center rounded-lg bg-accent-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            {t("backToEvents")}
          </Link>
        </div>
      </main>
    );
  }

  const { event, comments } = data;
  const past = isEventPast(event);
  const left =
    event.capacity === null
      ? null
      : Math.max(0, event.capacity - event.rsvpCounts.going);
  const full = left === 0;

  const requireSession = (message: string) => {
    if (session) return true;
    setInfo({ message, type: "error" });
    return false;
  };

  const handleRsvp = (status: RsvpStatus) => {
    if (!requireSession(t("signInToRsvp"))) return;
    updateRsvp.mutate({ eventId, status });
    setShowReminders(status !== "not_going");
  };

  const handleReminder = (minutes: number | null) => {
    /* A reminder for an event that is over can never be sent — the server
       refuses it too, so this is the same answer given without a round trip. */
    if (minutes !== null && !canRemind(event)) {
      setInfo({ message: t("reminderPastEvent"), type: "error" });
      setShowReminders(false);
      return;
    }
    updateRsvp.mutate(
      {
        eventId,
        status: event.userRsvpStatus ?? "going",
        reminderMinutesBefore: minutes,
      },
      { onError: (err) => setInfo({ message: err.message, type: "error" }) },
    );
    setShowReminders(false);
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
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
        { onError: (err) => setInfo({ message: err.message, type: "error" }) },
      );
    }
  };

  const rsvpButtons = (
    <div className="flex gap-1.5">
      {(["going", "maybe"] as const).map((status) => {
        const active = event.userRsvpStatus === status;
        const blocked = full && status === "going" && !active;
        return (
          <button
            key={status}
            type="button"
            onClick={() => handleRsvp(status)}
            disabled={updateRsvp.isPending || blocked || past}
            aria-pressed={active}
            className={`h-10 flex-1 rounded-lg text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? "bg-accent-primary text-white"
                : "border border-slate-200 text-fg-secondary hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
            }`}
          >
            {t(status)}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => handleRsvp("not_going")}
        disabled={updateRsvp.isPending || past}
        aria-pressed={event.userRsvpStatus === "not_going"}
        className={`h-10 rounded-lg px-3 text-[13px] transition-colors disabled:opacity-40 ${
          event.userRsvpStatus === "not_going"
            ? "bg-slate-200 font-semibold text-fg-primary dark:bg-white/10"
            : "border border-slate-200 text-fg-tertiary hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
        }`}
      >
        {t("cantGo")}
      </button>
    </div>
  );

  return (
    <main className="min-h-dvh bg-bg-primary pb-28 lg:pb-10">
      {/* A slim bar rather than the app rail: most people who open this link
          do not have an account, and a sidebar of links they cannot use is a
          worse greeting than the event itself. */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-bg-primary/85 backdrop-blur-md dark:border-white/10">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/publish"
            className="flex items-center gap-2 text-[13px] font-semibold text-fg-secondary transition-colors hover:text-accent-primary"
          >
            <ArrowLeft size={16} />
            {t("backToEvents")}
          </Link>
          <span className="flex-1" />
          <button
            type="button"
            onClick={handleShare}
            className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[13px] text-fg-secondary transition-colors hover:border-accent-primary/40 hover:text-accent-primary dark:border-white/10"
          >
            <Share2 size={14} />
            <span className="hidden sm:inline">{t("share")}</span>
          </button>
          {!session && (
            <Link
              href={`/?callbackUrl=/events/${eventId}`}
              className="flex h-9 items-center rounded-lg bg-accent-primary px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              {t("signIn")}
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6">
        {/* The cover, and the three things that decide whether to read on. */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-bg-elevated dark:border-white/10">
          {isValidImageUrl(event.imageUrl) && (
            <div className="relative aspect-[1200/500] bg-bg-tertiary">
              <Image
                src={event.imageUrl}
                alt={event.title}
                fill
                sizes="(max-width: 1024px) 100vw, 960px"
                priority
                className="object-cover"
              />
            </div>
          )}

          {/* Without a photograph the header block carries the wash itself, so
              the page opens on colour rather than on a bordered grey box. */}
          <div
            className={`flex flex-col gap-3 p-5 sm:p-6 ${
              isValidImageUrl(event.imageUrl) ? "" : coverClass(event)
            }`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {event.topic && (
                <Stamp className="rounded-md bg-accent-primary/10 px-2 py-1 text-[9.5px] tracking-[0.14em] text-accent-primary">
                  {t(`topics.${event.topic}`)}
                </Stamp>
              )}
              <Stamp className="flex items-center gap-1 rounded-md bg-bg-elevated/75 px-2 py-1 text-[9.5px] tracking-[0.14em] backdrop-blur-sm">
                <MapPin size={10} />
                {regionLabel(event.region)}
              </Stamp>
              {past && (
                <Stamp className="rounded-md bg-bg-elevated/75 px-2 py-1 text-[9.5px] tracking-[0.14em] backdrop-blur-sm">
                  {t("past")}
                </Stamp>
              )}
            </div>

            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-fg-primary sm:text-[32px]">
              {event.title}
            </h1>

            {/* Everyone sees this, not only the host. Somebody who already said
                yes is exactly the person who needs to know the plan moved. */}
            {event.updatedAt && (
              <Stamp className="tracking-[0.14em] text-accent-primary">
                {t("editedOn", {
                  date: formatDate(new Date(event.updatedAt), "withYear"),
                })}
              </Stamp>
            )}

            <div className="flex flex-wrap gap-2">
              <span className="flex h-9 items-center gap-2 rounded-lg bg-bg-elevated/75 px-3 text-[13px] text-fg-secondary backdrop-blur-sm">
                <Clock size={13} className="text-accent-primary" />
                {/* `withYear` rather than `long`: the long format already ends
                    in a time, which read as "4 July 2026 13:00 · 13:00". */}
                {formatDate(new Date(event.eventDate), "withYear")} ·{" "}
                {formatTimeRange(event, locale)}
              </span>
              <span className="flex h-9 items-center gap-2 rounded-lg bg-bg-elevated/75 px-3 text-[13px] text-fg-secondary backdrop-blur-sm">
                <MapPin size={13} className="text-accent-primary" />
                {placeLine(event)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* What it is, and what people are saying about it. */}
          <div className="flex min-w-0 flex-col gap-6">
            <section>
              <Stamp className="mb-2 block tracking-[0.14em]">
                {t("aboutThisEvent")}
              </Stamp>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg-secondary">
                {event.description}
              </p>
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!requireSession(t("signInToLike"))) return;
                  toggleLike.mutate({ eventId });
                }}
                disabled={toggleLike.isPending}
                aria-pressed={event.hasLiked}
                className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors ${
                  event.hasLiked
                    ? "border-accent-primary/50 bg-accent-primary/20 font-medium text-accent-primary"
                    : "border-slate-200 text-fg-secondary hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
                }`}
              >
                <Heart
                  size={15}
                  className={event.hasLiked ? "fill-current" : ""}
                />
                {event.likeCount}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!requireSession(t("signInToSave"))) return;
                  toggleSave.mutate({ eventId });
                }}
                disabled={toggleSave.isPending}
                aria-pressed={event.hasSaved}
                className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors ${
                  event.hasSaved
                    ? "border-accent-primary/50 bg-accent-primary/20 font-medium text-accent-primary"
                    : "border-slate-200 text-fg-secondary hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
                }`}
              >
                <Bookmark
                  size={15}
                  className={event.hasSaved ? "fill-current" : ""}
                />
                {event.hasSaved ? t("saved") : t("save")}
              </button>

              {/* Editing happens here rather than back on a filtered feed —
                  this is the page that shows what you are changing. */}
              {event.canEdit && (
                <button
                  type="button"
                  onClick={() => setShowEditForm(true)}
                  className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[13px] text-fg-secondary transition-colors hover:border-accent-primary/40 hover:text-accent-primary dark:border-white/10"
                >
                  <Pencil size={14} />
                  {t("edit.title")}
                </button>
              )}
            </div>

            <EventDiscussion
              eventId={eventId}
              hostId={event.author.id}
              commentCount={event.commentCount}
              initial={comments}
            />
          </div>

          {/* The decision, the host, and where to go. */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
            {event.enableRsvp && (
              <div className="hidden flex-col gap-3 rounded-2xl border border-slate-200 bg-bg-elevated p-4 lg:flex dark:border-white/10">
                <div className="flex items-baseline justify-between">
                  <Stamp className="tracking-[0.14em]">{t("going")}</Stamp>
                  <span className="kairos-mono text-xl font-semibold text-fg-primary">
                    {event.rsvpCounts.going}
                  </span>
                </div>

                {event.capacity !== null && (
                  <>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                      <div
                        className={`h-full rounded-full ${full ? "bg-red-500" : "bg-accent-primary"}`}
                        style={{
                          width: `${Math.min(100, Math.round((event.rsvpCounts.going / event.capacity) * 100))}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between">
                      <Stamp className="text-[9.5px] tracking-[0.12em]">
                        {t("capacity", { count: event.capacity })}
                      </Stamp>
                      <Stamp
                        className={`text-[9.5px] tracking-[0.12em] ${full ? "text-red-500" : "text-accent-primary"}`}
                      >
                        {full ? t("soldOut") : t("placesLeft", { count: left ?? 0 })}
                      </Stamp>
                    </div>
                  </>
                )}

                {attendees && attendees.length > 0 && (
                  <div className="flex items-center -space-x-2">
                    {attendees.slice(0, 6).map((person) => (
                      <ProfileLink
                        key={person.id}
                        userId={person.id}
                        name={person.name}
                        className="rounded-full ring-2 ring-bg-elevated"
                      >
                        <PersonAvatar
                          name={person.name}
                          image={person.image}
                          size="sm"
                        />
                      </ProfileLink>
                    ))}
                    {attendees.length > 6 && (
                      <span className="kairos-mono grid h-[30px] w-[30px] place-items-center rounded-full bg-slate-100 text-[10px] text-fg-tertiary ring-2 ring-bg-elevated dark:bg-white/10">
                        +{attendees.length - 6}
                      </span>
                    )}
                  </div>
                )}

                {rsvpButtons}

                {showReminders && !past && (
                  <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5 dark:border-white/[0.06]">
                    <Stamp className="w-full tracking-[0.12em]">
                      {t("getNotified")}
                    </Stamp>
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
                  </div>
                )}

                {event.reminderMinutesBefore !== null && !showReminders && !past && (
                  <button
                    type="button"
                    onClick={() => setShowReminders(true)}
                    className="flex items-center gap-2 text-xs text-fg-tertiary transition-colors hover:text-accent-primary"
                  >
                    <Bell size={12} className="text-accent-primary" />
                    {t("reminderArmed")}
                  </button>
                )}

                {/* Said plainly, next to the answer buttons it explains: the
                    RSVP row is disabled here and a reminder is not on offer
                    because there is nothing left to be reminded about. */}
                {past && (
                  <p className="flex items-start gap-2 border-t border-slate-100 pt-2.5 text-xs text-fg-tertiary dark:border-white/[0.06]">
                    <BellOff size={13} className="mt-px shrink-0" />
                    {t("reminderPastEvent")}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-bg-elevated p-4 dark:border-white/10">
              <Stamp className="tracking-[0.14em]">{t("hostedBy")}</Stamp>
              <div className="flex items-center gap-3">
                <ProfileLink userId={event.author.id} name={event.author.name}>
                  <PersonAvatar
                    name={event.author.name}
                    image={event.author.image}
                    size="lg"
                  />
                </ProfileLink>
                <div className="min-w-0 flex-1">
                  <ProfileLink
                    userId={event.author.id}
                    name={event.author.name}
                    className="block rounded-md"
                  >
                    <p className="truncate text-sm font-semibold text-fg-primary">
                      {event.author.name ?? t("someone")}
                    </p>
                  </ProfileLink>
                  <Stamp className="text-[9.5px] tracking-[0.12em]">
                    {t("hostSummary", {
                      events: event.author.eventCount,
                      followers: event.author.followerCount,
                    })}
                  </Stamp>
                </div>
              </div>

              {!event.isOwner && event.author.id && (
                <button
                  type="button"
                  onClick={handleFollow}
                  disabled={follow.isPending || unfollow.isPending}
                  aria-pressed={event.viewerFollowsAuthor}
                  className={`flex h-9 items-center justify-center gap-2 rounded-lg text-[13px] font-semibold transition-colors ${
                    event.viewerFollowsAuthor
                      ? "bg-slate-100 text-fg-secondary hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10"
                      : "bg-accent-primary text-white hover:bg-accent-hover"
                  }`}
                >
                  {!event.viewerFollowsAuthor && <UserPlus size={14} />}
                  {event.viewerFollowsAuthor ? t("following") : t("follow")}
                </button>
              )}

              {event.coHosts.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <Stamp className="tracking-[0.14em]">{t("coHosts")}</Stamp>
                  {event.coHosts.map((host) => (
                    <ProfileLink
                      key={host.id}
                      userId={host.id}
                      name={host.name}
                      className="flex items-center gap-2.5 rounded-lg"
                    >
                      <PersonAvatar
                        name={host.name}
                        image={host.image}
                        size="sm"
                      />
                      <span className="truncate text-[13px] text-fg-secondary">
                        {host.name}
                      </span>
                    </ProfileLink>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-bg-elevated p-4 dark:border-white/10">
              <Stamp className="tracking-[0.14em]">{t("where")}</Stamp>
              <p className="text-sm text-fg-primary">
                {event.venue ?? regionLabel(event.region)}
              </p>
              {event.address && (
                <p className="text-xs text-fg-tertiary">{event.address}</p>
              )}
              <a
                href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(
                  [event.venue, event.address, regionLabel(event.region)]
                    .filter(Boolean)
                    .join(", "),
                )}`}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 text-xs font-semibold text-accent-primary hover:text-accent-hover"
              >
                {t("openInMaps")} →
              </a>
            </div>
          </aside>
        </div>
      </div>

      {/* On a phone the decision is pinned, because scrolling back up to answer
          is the one thing this page must not ask for. */}
      {event.enableRsvp && !past && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-bg-primary/95 p-3 backdrop-blur-md lg:hidden dark:border-white/10">
          <div className="mb-2 flex items-center gap-2">
            <Users size={13} className="text-accent-primary" />
            <Stamp className="tracking-[0.12em]">
              {full
                ? t("soldOut")
                : t("attendanceLine", {
                    going: event.rsvpCounts.going,
                    maybe: event.rsvpCounts.maybe,
                  })}
            </Stamp>
            {/* Capacity is a decision input on a phone as much as on a desktop,
                and the desktop card that carries it is hidden here. */}
            {!full && left !== null && (
              <Stamp
                className={`tracking-[0.12em] ${left <= 10 ? "text-amber-500" : "text-accent-primary"}`}
              >
                · {t("placesLeft", { count: left })}
              </Stamp>
            )}
          </div>
          {rsvpButtons}
        </div>
      )}

      {showEditForm &&
        event.canEdit &&
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
    </main>
  );
}
