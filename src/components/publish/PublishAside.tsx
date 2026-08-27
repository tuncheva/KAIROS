"use client";

/**
 * The right column: what is asking for an answer, who is worth following, and
 * what you have said yes to.
 *
 * Quick links and a workspace list used to sit here. Both were navigation the
 * side nav already carries, so they were spending the feed's width to repeat
 * it. What replaced them is the one thing this column can do that no other
 * surface can: introduce you to people, which is what makes the Following lane
 * worth switching to in the first place.
 */

import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { UserPlus } from "lucide-react";

import { api } from "~/trpc/react";
import { ProfileLink } from "~/components/profile/ProfileLink";
import { eventDateParts, regionLabel } from "./feedData";
import { PersonAvatar, Stamp, TitledPanel } from "./publishUi";

/** Workspace invitations — the one inbound request this app actually models. */
function InviteInbox() {
  const t = useTranslations("publish");
  const utils = api.useUtils();
  const { data: invites } = api.organization.getMyInvites.useQuery();

  const settle = {
    onSettled: () => {
      void utils.organization.getMyInvites.invalidate();
      void utils.organization.listMine.invalidate();
    },
  };
  const accept = api.organization.acceptInvite.useMutation(settle);
  const decline = api.organization.declineInvite.useMutation(settle);

  if (!invites || invites.length === 0) return null;

  return (
    <TitledPanel
      title={t("invitations")}
      aside={
        <span className="kairos-mono text-[11px] text-accent-primary">
          {invites.length}
        </span>
      }
    >
      <ul className="flex flex-col gap-1 p-2">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-col gap-2.5 rounded-lg p-2">
            <div className="flex items-center gap-2.5">
              <PersonAvatar name={invite.orgName} size="sm" square />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13.5px] font-semibold text-fg-primary">
                  {invite.orgName}
                </span>
                <Stamp className="normal-case tracking-normal">
                  {invite.displayRole ?? invite.role}
                </Stamp>
              </span>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => accept.mutate({ inviteId: invite.id })}
                disabled={accept.isPending || decline.isPending}
                className="h-8 flex-1 rounded-lg bg-accent-primary text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {t("acceptInvite")}
              </button>
              <button
                type="button"
                onClick={() => decline.mutate({ inviteId: invite.id })}
                disabled={accept.isPending || decline.isPending}
                className="h-8 rounded-lg border border-slate-200 px-3 text-xs text-fg-secondary transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
              >
                {t("declineInvite")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </TitledPanel>
  );
}

/**
 * People worth following, with the reason spelled out.
 *
 * Every suggestion here is one the system can justify from a row that exists —
 * they hosted something you went to, you were at the same events, you share a
 * workspace. A suggestion without a reason is a stranger with a button on them.
 */
function WhoToFollow() {
  const t = useTranslations("publish");
  const utils = api.useUtils();
  const { data: session } = useSession();

  const { data: suggestions } = api.profile.getSuggestions.useQuery(
    { limit: 4 },
    { enabled: !!session },
  );

  const follow = api.profile.follow.useMutation({
    onSettled: () => {
      void utils.profile.getSuggestions.invalidate();
      void utils.event.getFeed.invalidate();
    },
  });

  if (!suggestions || suggestions.length === 0) return null;

  const reasonFor = (reason: (typeof suggestions)[number]["reason"]) => {
    switch (reason.kind) {
      case "hostedForYou":
        return t("suggestHosted", { count: reason.count });
      case "sharedEvents":
        return t("suggestSharedEvents", { count: reason.count });
      default:
        return t("suggestSharedOrgs", { count: reason.count });
    }
  };

  return (
    <TitledPanel title={t("whoToFollow")}>
      <ul className="flex flex-col gap-1 p-2">
        {suggestions.map((person) => (
          <li key={person.id} className="flex items-center gap-2.5 rounded-lg p-2">
            <ProfileLink userId={person.id} name={person.name}>
              <PersonAvatar name={person.name} image={person.image} size="sm" />
            </ProfileLink>
            <span className="flex min-w-0 flex-1 flex-col">
              <ProfileLink
                userId={person.id}
                name={person.name}
                className="max-w-full rounded-md text-left"
              >
                <span className="block truncate text-[13px] font-semibold text-fg-primary">
                  {person.name ?? t("someone")}
                </span>
              </ProfileLink>
              <Stamp className="truncate text-[9.5px] tracking-[0.12em]">
                {reasonFor(person.reason)}
              </Stamp>
            </span>
            <button
              type="button"
              onClick={() => follow.mutate({ userId: person.id })}
              disabled={follow.isPending}
              className="kairos-stamp flex h-7 shrink-0 items-center gap-1 rounded-lg bg-accent-primary/10 px-2.5 text-[9.5px] tracking-[0.12em] text-accent-primary transition-colors hover:bg-accent-primary/20 disabled:opacity-50"
            >
              <UserPlus size={11} />
              {t("follow")}
            </button>
          </li>
        ))}
      </ul>
    </TitledPanel>
  );
}

/** The next few things you said yes to — host or guest. */
function Agenda() {
  const t = useTranslations("publish");
  const locale = useLocale();
  const { data: summary } = api.event.getMySummary.useQuery();

  const agenda = summary?.agenda ?? [];
  if (agenda.length === 0) return null;

  return (
    <TitledPanel title={t("yourAgenda")}>
      <ul className="flex flex-col gap-3 px-3.5 py-3">
        {agenda.map((item) => {
          const date = eventDateParts(item.eventDate, locale);
          return (
            <li key={item.id} className="flex items-baseline gap-2.5">
              <span
                className={`kairos-stamp w-[52px] shrink-0 text-[10.5px] ${
                  item.rsvpStatus === "going" || item.isHost
                    ? "text-accent-primary"
                    : "text-fg-quaternary"
                }`}
              >
                {date.day} {date.month}
              </span>
              <span className="min-w-0 flex-1">
                <a
                  href={`/events/${item.id}`}
                  className="block text-[13px] leading-snug text-fg-secondary transition-colors hover:text-accent-primary"
                >
                  {item.title}
                </a>
                <Stamp className="text-[9.5px] tracking-[0.12em]">
                  {item.isHost
                    ? t("youAreHosting")
                    : t(`views.${item.rsvpStatus === "maybe" ? "maybe" : "going"}`)}
                  {` · ${regionLabel(item.region)}`}
                </Stamp>
              </span>
            </li>
          );
        })}
      </ul>
    </TitledPanel>
  );
}

export function PublishAside() {
  return (
    <aside
      className="dash-rise hidden flex-col gap-4 scrollbar-hide xl:sticky xl:top-6 xl:flex xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto"
      style={{ animationDelay: "120ms" }}
    >
      <InviteInbox />
      <WhoToFollow />
      <Agenda />
    </aside>
  );
}
