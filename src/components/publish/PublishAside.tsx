"use client";

/**
 * The right column: what is asking for an answer, then what is coming.
 *
 * The proposal puts friend requests, suggested people and a follow button here.
 * None of those exist in this schema — there is no social graph yet — so the
 * slot keeps the shape and fills it with the real requests this app does have:
 * workspace invitations, which accept and decline for real, and your agenda.
 *
 * Quick links and workspaces used to sit between them. Both were navigation the
 * side nav already carries, so they were spending the feed's width to repeat
 * it; engagement moved into a dialog off the feed toolbar. What is left is the
 * two things that are about *you* and exist nowhere else on this page.
 */

import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
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
                <span className="block text-[13px] leading-snug text-fg-secondary">
                  {item.title}
                </span>
                <Stamp className="text-[9.5px] tracking-[0.12em]">
                  {item.isHost ? t("youAreHosting") : t(`views.${item.rsvpStatus === "maybe" ? "maybe" : "going"}`)}
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
      className="dash-rise hidden flex-col gap-4 xl:sticky xl:top-6 xl:flex xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto xl:self-start scrollbar-hide"
      style={{ animationDelay: "120ms" }}
    >
      <InviteInbox />
      <Agenda />
    </aside>
  );
}
