"use client";

/**
 * The right column: what is asking for an answer, then what is coming.
 *
 * The proposal puts friend requests, suggested people and a follow button here.
 * None of those exist in this schema — there is no social graph yet — so the
 * slot keeps the shape and fills it with the real requests this app does have:
 * workspace invitations, which accept and decline for real. Below them sit your
 * agenda, your workspaces, and how the feed you are looking at is doing.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  Calendar,
  CheckSquare,
  ChevronRight,
  Heart,
  MessageCircle,
  TrendingUp,
} from "lucide-react";

import { api } from "~/trpc/react";
import {
  eventDateParts,
  regionLabel,
  summariseEngagement,
  type FeedEvent,
} from "./feedData";
import { Panel, PersonAvatar, Stamp, TitledPanel } from "./publishUi";

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

/** Workspaces you belong to — the closest thing this app has to groups. */
function Workspaces() {
  const t = useTranslations("publish");
  const { data: orgs } = api.organization.listMine.useQuery();

  if (!orgs || orgs.length === 0) return null;

  return (
    <TitledPanel title={t("yourWorkspaces")}>
      <ul className="flex flex-col gap-0.5 p-2">
        {orgs.slice(0, 4).map((org) => (
          <li key={org.id}>
            <Link
              href="/orgs"
              className="flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-slate-100 dark:hover:bg-white/[0.04]"
            >
              <PersonAvatar name={org.name} size="sm" square />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold text-fg-primary">
                  {org.name}
                </span>
                <Stamp className="text-[9.5px] tracking-[0.12em]">
                  {org.role}
                </Stamp>
              </span>
              <ChevronRight size={13} className="shrink-0 text-fg-quaternary" />
            </Link>
          </li>
        ))}
      </ul>
    </TitledPanel>
  );
}

const QUICK_LINKS = [
  { href: "/calendar", key: "calendar", Icon: Calendar },
  { href: "/progress", key: "progress", Icon: TrendingUp },
  { href: "/projects", key: "tasks", Icon: CheckSquare },
] as const;

function QuickLinks() {
  const t = useTranslations("publish");

  return (
    <TitledPanel title={t("quickLinks")}>
      <ul className="flex flex-col gap-0.5 p-2">
        {QUICK_LINKS.map(({ href, key, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="group flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-100 dark:hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-2.5">
                <span className="rounded-md bg-accent-primary/10 p-1.5 text-accent-primary transition-colors group-hover:bg-accent-primary group-hover:text-white">
                  <Icon size={14} />
                </span>
                <span className="text-xs font-semibold text-fg-secondary">
                  {t(key)}
                </span>
              </span>
              <ChevronRight size={12} className="text-fg-quaternary" />
            </Link>
          </li>
        ))}
      </ul>
    </TitledPanel>
  );
}

/** How the feed on screen is doing — likes, comments, RSVPs and the top three. */
function Engagement({ events }: { events: FeedEvent[] }) {
  const t = useTranslations("publish");
  const summary = useMemo(() => summariseEngagement(events), [events]);

  if (!summary) return null;

  const tiles = [
    { Icon: Heart, value: summary.totalLikes, label: t("likes") },
    { Icon: MessageCircle, value: summary.totalComments, label: t("comments") },
    { Icon: Activity, value: summary.totalRsvps, label: "RSVPs" },
  ];

  return (
    <Panel className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-fg-primary">
          {t("eventProgress")}
        </h2>
        <Stamp className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-accent-primary">
          {t("active")}
        </Stamp>
      </div>

      <dl className="grid grid-cols-3 gap-1.5">
        {tiles.map(({ Icon, value, label }) => (
          <div
            key={label}
            className="rounded-md bg-accent-primary/5 p-1.5 text-center dark:bg-white/5"
          >
            <Icon size={12} className="mx-auto mb-0.5 text-accent-primary" />
            <dd className="kairos-mono text-xs font-bold text-fg-primary">
              {value}
            </dd>
            <dt className="text-[9px] text-fg-tertiary">{label}</dt>
          </div>
        ))}
      </dl>

      <ul className="flex flex-col gap-3">
        {summary.topEvents.map((event, index) => {
          const percent = Math.round(
            ((event.likeCount + event.commentCount) / summary.peak) * 100,
          );
          const tone = [
            "bg-accent-primary",
            "bg-accent-primary/60",
            "bg-accent-primary/30",
          ][index] ?? "bg-accent-primary";

          return (
            <li key={event.id}>
              <div className="mb-1.5 flex items-end justify-between gap-2">
                <span className="truncate text-[10px] font-bold text-fg-secondary">
                  {event.title}
                </span>
                <span className="kairos-mono shrink-0 text-[10px] font-bold text-accent-primary">
                  {percent}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${tone}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function PublishAside({ events }: { events: FeedEvent[] }) {
  return (
    <aside
      className="dash-rise hidden flex-col gap-4 lg:flex lg:col-span-3"
      style={{ animationDelay: "120ms" }}
    >
      <InviteInbox />
      <Agenda />
      <QuickLinks />
      <Workspaces />
      <Engagement events={events} />
    </aside>
  );
}
