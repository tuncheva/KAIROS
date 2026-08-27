"use client";

/**
 * The profile peek.
 *
 * Rendered once by `ProfilePeekProvider` and driven entirely by the `userId`
 * prop, so opening a different person is a prop change rather than a
 * mount — tRPC then serves the header from cache on the second visit while the
 * tabs refetch.
 *
 * Three things are deliberately absent:
 *
 * - No editing. Your own profile is edited in Settings and this drawer is the
 *   preview of it, so there is exactly one form in the app that writes a bio.
 * - No error state for a restricted profile. `getPublicProfile` answers
 *   `restricted: true` instead of throwing, and the drawer renders the name and
 *   avatar the viewer could already see. See `~/server/profile/visibility`.
 * - No follower list for a restricted profile — the server refuses that too,
 *   the empty array here is only the second line of defence.
 */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  Clock,
  Lock,
  MessageCircle,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Overlay } from "~/components/ui/Overlay";
import { useToast } from "~/components/providers/ToastProvider";
import { api } from "~/trpc/react";
import { useProfilePeek } from "./ProfilePeekProvider";

type TabId = "shared" | "activity" | "followers";

const STAMP = "kairos-stamp text-[10px] tracking-[0.14em] text-fg-tertiary";

function initialOf(name: string | null | undefined): string {
  return (name ?? "").trim().charAt(0).toUpperCase() || "?";
}

/**
 * The other person's wall-clock time.
 *
 * Rendered from their stored IANA zone rather than an offset, so it stays
 * correct across a DST boundary without anything having to be rewritten. An
 * unknown zone yields null rather than throwing — `timezone` is a free-text
 * column and old rows can hold anything.
 */
function localTimeIn(timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date());
  } catch {
    return null;
  }
}

/**
 * How long the drawer stays mounted after it has been asked to close.
 *
 * Must match `.projects-drawer-out` in `globals.css`, which mirrors the
 * entrance at 0.45s. This is the *panel's* duration, not the scrim's shorter
 * 0.35s: the panel is the last thing still moving, and unmounting on the scrim
 * would cut the slide off two thirds of the way through.
 *
 * A timer rather than an `animationend` listener on purpose: under
 * `prefers-reduced-motion` those rules resolve to `animation: none`, so no
 * `animationend` ever fires and a listener-based unmount would strand the
 * drawer on screen forever. A timer closes in both worlds.
 */
export const PROFILE_DRAWER_EXIT_MS = 450;

/** Reduced-motion users skip the hold entirely — there is no motion to wait for. */
function exitDurationMs(): number {
  if (typeof window === "undefined" || !window.matchMedia) {
    return PROFILE_DRAWER_EXIT_MS;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : PROFILE_DRAWER_EXIT_MS;
}

export function ProfileDrawer({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("profile");
  const router = useRouter();
  const toast = useToast();
  const titleId = useId();
  const { openProfile } = useProfilePeek();

  const [tab, setTab] = useState<TabId>("shared");

  /**
   * The person the drawer is *showing*, which is not the same as the person the
   * app has open.
   *
   * When `userId` goes null the drawer still has an exit to play, and blanking
   * the content for those 300ms would mean watching an empty panel slide away.
   * So the id is latched here and only released once the exit is over — the
   * queries below key off this, not the prop.
   */
  const [shownUserId, setShownUserId] = useState<string | null>(userId);
  const [closing, setClosing] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }

    if (userId) {
      // Reopening during an exit — including on a *different* person — cancels
      // it. Without the cancel the pending timer would fire mid-life and blank
      // the drawer that had just been reopened.
      setShownUserId(userId);
      setClosing(false);
      return;
    }

    if (shownUserId === null) return;

    setClosing(true);
    exitTimer.current = setTimeout(() => {
      setShownUserId(null);
      setClosing(false);
    }, exitDurationMs());

    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
    // `shownUserId` is read but must not re-trigger this: it is set *by* this
    // effect, and depending on it would restart the exit timer on every tick of
    // its own progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const open = Boolean(shownUserId);

  // A fresh person starts on the first tab. Without this, opening someone from
  // the followers list would land you on *their* followers list. Keyed on the
  // shown id so the exit does not reset the tab you are watching slide away.
  useEffect(() => {
    if (shownUserId) setTab("shared");
  }, [shownUserId]);

  useEffect(() => {
    // Escape is ignored once the drawer is already leaving; a second press
    // would otherwise ask a closed drawer to close again.
    if (!open || closing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closing, onClose]);

  const utils = api.useUtils();

  const profileQuery = api.profile.getPublicProfile.useQuery(
    { userId: shownUserId ?? "" },
    { enabled: open },
  );
  const profile = profileQuery.data;
  const full = profile && !profile.restricted ? profile : null;

  const sharedQuery = api.profile.getSharedContext.useQuery(
    { userId: shownUserId ?? "" },
    { enabled: open && Boolean(full) && tab === "shared" },
  );

  const activityQuery = api.profile.getActivity.useQuery(
    { userId: shownUserId ?? "", limit: 12 },
    { enabled: open && Boolean(full?.showsActivity) && tab === "activity" },
  );

  const followersQuery = api.profile.listFollows.useQuery(
    { userId: shownUserId ?? "", direction: "followers" },
    { enabled: open && Boolean(full) && tab === "followers" },
  );

  const invalidate = () => {
    if (!shownUserId) return;
    void utils.profile.getPublicProfile.invalidate({ userId: shownUserId });
    void utils.profile.listFollows.invalidate({ userId: shownUserId });
  };

  const follow = api.profile.follow.useMutation({
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  const unfollow = api.profile.unfollow.useMutation({
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });

  const startChat = api.chat.getOrCreateDirectConversation.useMutation({
    onSuccess: (data) => {
      onClose();
      router.push(`/chat?conversationId=${data.conversationId}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const localTime = useMemo(
    () => localTimeIn(full?.timezone),
    // Recomputed per person rather than per minute: a drawer is open for
    // seconds, and a ticking clock in a peek card is noise.
    [full?.timezone],
  );

  if (!open) return null;

  const displayName = profile?.name ?? t("someone");
  const followBusy = follow.isPending || unfollow.isPending;

  return (
    <Overlay>
      <div
        className={`fixed inset-0 z-[70] flex justify-end ${
          // A leaving drawer must not keep swallowing clicks for 300ms. Aimed
          // at the wrapper rather than the panel so the whole overlay lets go
          // at once.
          closing ? "pointer-events-none" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          disabled={closing}
          className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] ${
            closing ? "projects-drawer-scrim-out" : "projects-drawer-scrim"
          }`}
        />

        <aside
          className={`relative flex h-full w-full max-w-[440px] flex-col border-l border-border-light/60 bg-bg-secondary shadow-[-28px_0_60px_rgba(0,0,0,0.5)] ${
            closing ? "projects-drawer-out" : "projects-drawer"
          }`}
        >
          <div className="flex items-center justify-between gap-4 border-b border-border-light/50 px-[26px] py-5">
            <span className={STAMP}>{t("title")}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-border-light/70 text-fg-tertiary transition-colors duration-300 hover:bg-bg-tertiary hover:text-fg-primary"
            >
              <X size={15} aria-hidden />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            {profileQuery.isLoading ? (
              <div className="p-[26px] text-[13px] text-fg-tertiary">
                {t("loading")}
              </div>
            ) : profileQuery.isError ? (
              // A failed query is not the same fact as a missing person.
              // Reporting one as the other told the viewer that a colleague
              // had been deleted every time the request merely fell over.
              <div className="p-[26px] text-[13px] text-fg-tertiary">
                {t("loadFailed")}
              </div>
            ) : !profile ? (
              <div className="p-[26px] text-[13px] text-fg-tertiary">
                {t("notFound")}
              </div>
            ) : (
              <>
                {/* Header — the part that renders identically for a restricted
                    profile, because it is only what the viewer already saw. */}
                <div className="flex flex-col items-center gap-3 px-[26px] pb-6 pt-7 text-center">
                  <div className="relative">
                    {profile.image ? (
                      <Image
                        src={profile.image}
                        alt=""
                        width={76}
                        height={76}
                        unoptimized
                        className="h-[76px] w-[76px] rounded-full object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="grid h-[76px] w-[76px] place-items-center rounded-full bg-accent-primary text-[28px] font-bold text-white"
                      >
                        {initialOf(profile.name)}
                      </span>
                    )}
                    {full?.online ? (
                      <span
                        title={t("online")}
                        className="absolute bottom-1 right-1 h-[14px] w-[14px] rounded-full border-[3px] border-bg-secondary bg-success"
                      />
                    ) : null}
                  </div>

                  <div>
                    <h2
                      id={titleId}
                      className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-fg-primary"
                    >
                      {displayName}
                    </h2>
                    {full?.role && full.organization ? (
                      <p className="mt-1 text-[13px] text-fg-secondary">
                        {t("roleAt", {
                          role: full.role,
                          org: full.organization.name,
                        })}
                      </p>
                    ) : null}
                  </div>

                  {full?.bio ? (
                    <p className="max-w-[320px] text-[14px] leading-[1.5] text-fg-secondary">
                      {full.bio}
                    </p>
                  ) : null}

                  {profile.restricted ? (
                    <p className="mt-1 flex items-center gap-2 text-[13px] text-fg-tertiary">
                      <Lock size={13} aria-hidden />
                      {t("restricted")}
                    </p>
                  ) : null}
                </div>

                {full ? (
                  <>
                    {/* Counts. Buttons, not labels — the follower count is the
                        way into the follower list. */}
                    <div className="mx-[26px] flex items-center justify-center gap-6 rounded-[11px] border border-border-light/50 bg-bg-tertiary/40 py-3">
                      <button
                        type="button"
                        onClick={() => setTab("followers")}
                        className="flex flex-col items-center px-2 text-fg-primary transition-opacity hover:opacity-70"
                      >
                        <span className="text-[17px] font-semibold">
                          {full.followerCount}
                        </span>
                        <span className={STAMP}>{t("followers")}</span>
                      </button>
                      <span className="h-7 w-px bg-border-light/60" />
                      <div className="flex flex-col items-center px-2 text-fg-primary">
                        <span className="text-[17px] font-semibold">
                          {full.followingCount}
                        </span>
                        <span className={STAMP}>{t("following")}</span>
                      </div>
                    </div>

                    {/* Actions. Absent entirely when you are looking at
                        yourself: there is nobody to message and nobody to
                        follow, and a disabled pair of buttons says less than
                        no buttons. */}
                    {full.isSelf ? (
                      <div className="px-[26px] pt-5">
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            router.push("/settings?section=profile");
                          }}
                          className="w-full rounded-[9px] border border-border-light/70 py-2.5 text-[14px] font-medium text-fg-primary transition-colors hover:bg-bg-tertiary"
                        >
                          {t("editProfile")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2.5 px-[26px] pt-5">
                        <button
                          type="button"
                          disabled={startChat.isPending}
                          onClick={() =>
                            startChat.mutate({ otherUserId: full.id })
                          }
                          className="flex flex-1 items-center justify-center gap-2 rounded-[9px] border border-border-light/70 py-2.5 text-[14px] font-medium text-fg-primary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
                        >
                          <MessageCircle size={15} aria-hidden />
                          {t("message")}
                        </button>

                        {full.canFollow ? (
                          <button
                            type="button"
                            disabled={followBusy}
                            onClick={() =>
                              full.isFollowing
                                ? unfollow.mutate({ userId: full.id })
                                : follow.mutate({ userId: full.id })
                            }
                            className={`flex flex-1 items-center justify-center gap-2 rounded-[9px] py-2.5 text-[14px] font-medium transition-colors disabled:opacity-50 ${
                              full.isFollowing
                                ? "border border-border-light/70 text-fg-primary hover:bg-bg-tertiary"
                                : "bg-accent-primary text-white hover:opacity-90"
                            }`}
                          >
                            {full.isFollowing ? (
                              <>
                                <UserMinus size={15} aria-hidden />
                                {t("unfollow")}
                              </>
                            ) : (
                              <>
                                <UserPlus size={15} aria-hidden />
                                {t("follow")}
                              </>
                            )}
                          </button>
                        ) : null}
                      </div>
                    )}

                    {full.followsYou && !full.isSelf ? (
                      <p className="px-[26px] pt-2.5 text-[12px] text-fg-tertiary">
                        {t("followsYou")}
                      </p>
                    ) : null}

                    {/* Meta strip */}
                    <dl className="mt-6 grid gap-2.5 px-[26px] text-[13px]">
                      {localTime ? (
                        <MetaRow
                          icon={<Clock size={13} aria-hidden />}
                          label={t("localTime")}
                          value={localTime}
                        />
                      ) : null}
                      {full.organization ? (
                        <MetaRow
                          icon={<Building2 size={13} aria-hidden />}
                          label={t("organization")}
                          value={full.organization.name}
                        />
                      ) : null}
                      <MetaRow
                        icon={<CalendarDays size={13} aria-hidden />}
                        label={t("memberSince")}
                        value={new Intl.DateTimeFormat(undefined, {
                          month: "long",
                          year: "numeric",
                        }).format(new Date(full.createdAt))}
                      />
                    </dl>

                    {/* Tabs */}
                    <div
                      role="tablist"
                      aria-label={t("title")}
                      className="mt-6 flex gap-1 border-b border-border-light/50 px-[26px]"
                    >
                      {(
                        [
                          ["shared", t("tabShared")],
                          ["activity", t("tabActivity")],
                          ["followers", t("tabFollowers")],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={tab === id}
                          onClick={() => setTab(id)}
                          className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
                            tab === id
                              ? "border-accent-primary text-fg-primary"
                              : "border-transparent text-fg-tertiary hover:text-fg-secondary"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-col gap-2 p-[26px]">
                      {tab === "shared" ? (
                        <SharedTab
                          data={sharedQuery.data}
                          loading={sharedQuery.isLoading}
                          isSelf={full.isSelf}
                          onOpenProject={(id) => {
                            onClose();
                            router.push(`/projects?projectId=${id}`);
                          }}
                          onOpenEvent={() => {
                            onClose();
                            router.push("/publish");
                          }}
                          t={t}
                        />
                      ) : null}

                      {tab === "activity" ? (
                        !full.showsActivity ? (
                          <Empty text={t("activityHidden")} />
                        ) : activityQuery.isLoading ? (
                          <Empty text={t("loading")} />
                        ) : (activityQuery.data ?? []).length === 0 ? (
                          <Empty text={t("noActivity")} />
                        ) : (
                          (activityQuery.data ?? []).map((item) => (
                            <div
                              key={`${item.kind}-${item.eventId}`}
                              className="rounded-[10px] border border-border-light/50 px-3.5 py-3"
                            >
                              <span className={STAMP}>
                                {item.kind === "published_event"
                                  ? t("activityPublished")
                                  : t("activityGoing")}
                              </span>
                              <p className="mt-1 text-[14px] text-fg-primary">
                                {item.title}
                              </p>
                              <p className="mt-0.5 text-[12px] text-fg-tertiary">
                                {new Intl.DateTimeFormat(undefined, {
                                  dateStyle: "medium",
                                }).format(new Date(item.eventDate))}
                              </p>
                            </div>
                          ))
                        )
                      ) : null}

                      {tab === "followers" ? (
                        followersQuery.isLoading ? (
                          <Empty text={t("loading")} />
                        ) : (followersQuery.data ?? []).length === 0 ? (
                          <Empty text={t("noFollowers")} />
                        ) : (
                          (followersQuery.data ?? []).map((person) => (
                            <button
                              key={person.id}
                              type="button"
                              onClick={() => openProfile(person.id)}
                              className="flex items-center gap-3 rounded-[10px] border border-border-light/50 px-3.5 py-2.5 text-left transition-colors hover:bg-bg-tertiary"
                            >
                              {person.image ? (
                                <Image
                                  src={person.image}
                                  alt=""
                                  width={30}
                                  height={30}
                                  unoptimized
                                  className="h-[30px] w-[30px] rounded-full object-cover"
                                />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className="grid h-[30px] w-[30px] place-items-center rounded-full bg-accent-primary text-[12px] font-bold text-white"
                                >
                                  {initialOf(person.name)}
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] text-fg-primary">
                                  {person.name ?? t("someone")}
                                </span>
                                {person.bio ? (
                                  <span className="block truncate text-[12px] text-fg-tertiary">
                                    {person.bio}
                                  </span>
                                ) : null}
                              </span>
                              <Check
                                size={14}
                                aria-hidden
                                className="shrink-0 text-transparent"
                              />
                            </button>
                          ))
                        )
                      ) : null}
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </aside>
      </div>
    </Overlay>
  );
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-fg-quaternary">{icon}</span>
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className="ml-auto m-0 text-fg-primary">{value}</dd>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-2 text-[13px] text-fg-tertiary">{text}</p>;
}

function SharedTab({
  data,
  loading,
  isSelf,
  onOpenProject,
  onOpenEvent,
  t,
}: {
  data:
    | {
        projects: { id: number; title: string }[];
        events: { id: number; title: string; eventDate: Date }[];
        organizations: { id: number; name: string }[];
      }
    | undefined;
  loading: boolean;
  isSelf: boolean;
  onOpenProject: (id: number) => void;
  onOpenEvent: (id: number) => void;
  t: (key: string) => string;
}) {
  // Shared context with yourself is a category error, not an empty result.
  if (isSelf) return <Empty text={t("sharedSelf")} />;
  if (loading) return <Empty text={t("loading")} />;

  const empty =
    !data ||
    (data.projects.length === 0 &&
      data.events.length === 0 &&
      data.organizations.length === 0);

  if (empty) return <Empty text={t("noShared")} />;

  return (
    <>
      {data.organizations.length > 0 ? (
        <>
          <span className={STAMP}>{t("sharedOrgs")}</span>
          {data.organizations.map((org) => (
            <div
              key={org.id}
              className="rounded-[10px] border border-border-light/50 px-3.5 py-2.5 text-[14px] text-fg-primary"
            >
              {org.name}
            </div>
          ))}
        </>
      ) : null}

      {data.projects.length > 0 ? (
        <>
          <span className={`${STAMP} mt-2`}>{t("sharedProjects")}</span>
          {data.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onOpenProject(project.id)}
              className="rounded-[10px] border border-border-light/50 px-3.5 py-2.5 text-left text-[14px] text-fg-primary transition-colors hover:bg-bg-tertiary"
            >
              {project.title}
            </button>
          ))}
        </>
      ) : null}

      {data.events.length > 0 ? (
        <>
          <span className={`${STAMP} mt-2`}>{t("sharedEvents")}</span>
          {data.events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => onOpenEvent(event.id)}
              className="rounded-[10px] border border-border-light/50 px-3.5 py-2.5 text-left transition-colors hover:bg-bg-tertiary"
            >
              <span className="block text-[14px] text-fg-primary">
                {event.title}
              </span>
              <span className="block text-[12px] text-fg-tertiary">
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                }).format(new Date(event.eventDate))}
              </span>
            </button>
          ))}
        </>
      ) : null}
    </>
  );
}
