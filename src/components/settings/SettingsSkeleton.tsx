"use client";

/**
 * The settings space before its data lands, in the loaded geometry.
 *
 * Everything the app already knows renders for real: the back link, the
 * section index with its group headings and icons, the title and intro, the
 * Profile section's heading, group labels and row labels. Only what comes from
 * the account hatches — the avatar, name and e-mail, the account check, and
 * the values in the rows. Controls are drawn but inert.
 *
 * Client-side because the section icons are (see `sectionIcons.ts`); the route
 * `loading.tsx` renders it as is.
 */

import { useTranslations } from "next-intl";
import { ArrowLeft, History, LightIcons, Search, X } from "~/components/ui/icons";
import { Skeleton, SkeletonStatus } from "~/components/ui/Skeleton";
import { SkeletonSlow } from "~/components/ui/SkeletonSlow";

import { SECTION_ICON } from "./sectionIcons";
import {
  SECTION_GROUP,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  sectionNumber,
} from "./sections";

type Translator = (key: string, values?: Record<string, unknown>) => string;

/** The account check while `settings.get` is in flight: the outline, hatched. */
export function HealthSkeleton({ row = 0 }: { row?: number }) {
  return (
    <div
      aria-hidden
      className="mt-[22px] flex h-[70px] items-center gap-4 rounded-[10px] border border-border-light px-[18px]"
    >
      <Skeleton shape="title" className="h-[22px] w-11" row={row} />
      <span className="flex flex-1 flex-col gap-2.5">
        <Skeleton className="h-[10px] w-[46%] max-w-[260px]" row={row} />
        <Skeleton className="h-[3px] w-full max-w-[220px]" row={row} />
      </span>
    </div>
  );
}

/** One ledger row: the label real, the value hatched. */
function RowSkeleton({
  title,
  desc,
  first,
  stack,
  children,
}: {
  title: string;
  desc?: React.ReactNode;
  first?: boolean;
  stack?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`-mx-4 flex flex-col gap-3 rounded-sm px-4 py-[18px] ${
        stack ? "" : "sm:flex-row sm:items-center sm:gap-6"
      } ${first ? "" : "border-t border-border-light"}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-col gap-[5px]">
          <span className="text-settings-row font-medium text-fg-primary">{title}</span>
          {desc ? (
            <span className="max-w-[380px] text-settings-desc text-fg-tertiary">{desc}</span>
          ) : null}
        </div>
      </div>
      <div
        className={`flex min-w-0 max-w-full flex-wrap items-center gap-2.5 ${
          stack ? "" : "sm:max-w-[60%] sm:flex-none sm:justify-end"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function GroupSkeleton({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col pt-10">
      <div className="flex flex-col gap-1.5 pb-3">
        <h3 className="m-0 flex items-center gap-2.5 text-settings-group font-semibold text-fg-primary">
          <span aria-hidden className="h-[5px] w-[5px] flex-none rounded-full bg-accent-primary" />
          {label}
        </h3>
        {hint ? (
          <span className="max-w-[520px] pl-[15px] text-settings-desc text-fg-tertiary">{hint}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  );
}

export function SettingsSkeleton() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings");
  const ts = useT("skeleton");
  const ProfileIcon = SECTION_ICON.profile;

  const search = (
    <div
      aria-hidden
      className="flex h-[34px] items-center gap-2.5 rounded-[7px] bg-fg-primary/5 pl-3 pr-2"
    >
      <Search size={13} className="flex-none text-fg-tertiary" />
      <span className="min-w-0 flex-1 truncate text-settings-desc text-fg-tertiary">
        {t("filterPlaceholder")}
      </span>
    </div>
  );

  return (
    <LightIcons>
      <div className="settings-elegant fixed inset-0 z-[55] flex bg-bg-primary text-fg-primary">
        <SkeletonStatus label={ts("status")} />

        {/* ---------------------------------------------------------- index */}
        <aside
          aria-hidden
          className="hidden w-[300px] flex-none flex-col border-r border-border-light bg-settings-side lg:flex"
        >
          <div className="px-7 pt-[26px]">
            <span className="-ml-1.5 flex h-[30px] items-center gap-2.5 rounded-[6px] pl-1.5 pr-2.5 text-settings-desc text-fg-secondary">
              <ArrowLeft size={14} />
              {t("elegant.back")}
            </span>
          </div>

          <div className="flex items-center gap-3.5 px-7 pb-[26px] pt-[34px]">
            <Skeleton shape="circle" className="h-11 w-11" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-[10px] w-[55%]" />
              <Skeleton className="h-[8px] w-[78%]" />
            </div>
          </div>

          <div className="px-5 pb-3.5">{search}</div>

          <nav className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-hidden px-3 pb-3 pt-1.5">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group} className="flex flex-col gap-px">
                <span className="px-4 pb-2 text-settings-eyebrow font-medium uppercase tracking-[0.14em] text-fg-tertiary">
                  {t(`elegant.group.${group}`)}
                </span>
                {SETTINGS_SECTIONS.filter((id) => SECTION_GROUP[id] === group).map((id) => {
                  const Icon = SECTION_ICON[id];
                  return (
                    <span
                      key={id}
                      className="flex h-9 items-center gap-[7px] rounded-[7px] pl-3 pr-3.5 text-fg-secondary"
                    >
                      <span className="flex h-6 w-6 flex-none items-center justify-center text-fg-tertiary">
                        <Icon size={15} />
                      </span>
                      <span className="flex-1 text-settings-body font-medium">{t(`nav.${id}`)}</span>
                    </span>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="flex items-center gap-2 border-t border-border-light px-7 pb-[22px] pt-4 text-settings-meta text-fg-tertiary">
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-border-strong" />
            <span>{t("elegant.saveIdle")}</span>
          </div>
        </aside>

        {/* --------------------------------------------------------- column */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 z-[4] flex h-16 items-center gap-3 border-b border-transparent tui-screen pl-4 pr-4 sm:pr-7 lg:pl-14"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-[7px] text-fg-secondary lg:hidden">
              <ArrowLeft size={15} />
            </span>
            <span className="flex-1" />
            <span className="flex h-8 items-center gap-2 rounded-[7px] px-3 text-settings-small font-medium text-fg-secondary">
              <History size={14} />
              {t("elegant.activity")}
            </span>
            <span className="hidden h-8 items-center gap-2 rounded-[7px] pl-2.5 pr-2 text-settings-meta text-fg-tertiary sm:flex">
              <kbd className="rounded-[4px] border border-border-medium px-[5px] py-px font-mono text-settings-eyebrow leading-[14px]">
                esc
              </kbd>
              <X size={14} />
            </span>
          </div>

          <div className="tui-screen relative min-h-0 flex-1 overflow-hidden">
            <div className="flex min-h-full w-full flex-col px-5 pb-10 pt-24 sm:px-10 lg:px-14 lg:pt-28">
              <div aria-hidden className="mb-8 flex flex-col gap-3 lg:hidden">
                {search}
                <div className="scrollbar-hide -mx-5 flex gap-1 overflow-hidden px-5 sm:-mx-10 sm:px-10">
                  {SETTINGS_SECTIONS.map((id) => (
                    <span
                      key={id}
                      className="flex h-8 flex-none items-center whitespace-nowrap rounded-[7px] px-3 text-settings-small font-medium text-fg-secondary"
                    >
                      {t(`nav.${id}`)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2.5 pb-9">
                <h1 className="settings-serif m-0 text-settings-display font-light">{t("title")}</h1>
                <p className="m-0 text-settings-lead text-fg-secondary">{t("elegant.intro")}</p>
                <HealthSkeleton row={1} />
              </div>

              <section aria-hidden className="border-t border-border-light pb-2 pt-[52px]">
                <div className="mb-2 flex flex-col gap-3">
                  <span className="text-settings-eyebrow font-medium uppercase tracking-[0.14em] text-fg-tertiary">
                    {`${sectionNumber("profile")} · ${t(`elegant.group.${SECTION_GROUP.profile}`)}`}
                  </span>
                  <h2 className="settings-serif m-0 flex items-center gap-4 text-settings-title font-light text-fg-primary">
                    <span className="settings-medallion h-[46px] w-[46px]">
                      <ProfileIcon size={21} />
                    </span>
                    {t("nav.profile")}
                  </h2>
                  <p className="m-0 max-w-[560px] text-settings-subtitle text-fg-secondary">
                    {t("profile.subtitle")}
                  </p>
                </div>

                <GroupSkeleton
                  label={t("profile.groupIdentity")}
                  hint={t("profile.groupIdentityHint")}
                >
                  <RowSkeleton
                    first
                    title={t("profile.profilePicture")}
                    desc={`${t("profile.imageFormats")} ${t("profile.imageMaxSize", { size: "4MB" })}`}
                  >
                    <span className="flex items-center gap-3">
                      <Skeleton shape="circle" className="h-10 w-10" row={2} />
                      <span className="rounded-sm border border-border-medium px-[13px] py-1.5 text-settings-small font-medium text-fg-tertiary">
                        {t("profile.uploadImage")}
                      </span>
                    </span>
                  </RowSkeleton>
                  <RowSkeleton title={t("profile.fullName")}>
                    <span className="flex h-9 w-[280px] max-w-full items-center rounded-[6px] bg-fg-primary/5 px-3">
                      <Skeleton className="h-[9px] w-[52%]" row={3} />
                    </span>
                  </RowSkeleton>
                  <RowSkeleton title={t("profile.emailAddress")} desc={t("profile.emailNote")}>
                    <Skeleton className="h-[9px] w-[190px] max-w-full" row={4} />
                  </RowSkeleton>
                  <RowSkeleton
                    stack
                    title={t("profile.bio")}
                    desc={<Skeleton className="mt-1 h-[8px] w-24" row={5} />}
                  >
                    <span className="flex h-[87px] w-full flex-col gap-[11px] rounded-[6px] bg-fg-primary/5 px-3 py-[15px]">
                      <Skeleton className="h-[9px] w-[88%]" row={5} />
                      <Skeleton className="h-[9px] w-[54%]" row={6} />
                    </span>
                  </RowSkeleton>
                </GroupSkeleton>

                <GroupSkeleton
                  label={t("profile.groupAccount")}
                  hint={t("profile.groupAccountHint")}
                >
                  <RowSkeleton first title={t("profile.memberSince")}>
                    <Skeleton className="h-[9px] w-28" row={7} />
                  </RowSkeleton>
                </GroupSkeleton>
              </section>

              <SkeletonSlow what="settings" />
            </div>
          </div>
        </div>
      </div>
    </LightIcons>
  );
}

/**
 * The quiet stand-in for a list inside a section (keys, webhooks, memory,
 * schedules) while its query is in flight: a few hatched rows in the list's
 * own rhythm, in place of a "Loading…" line.
 */
export function SettingsListSkeleton({
  rows = 2,
  meta = true,
}: {
  rows?: number;
  meta?: boolean;
}) {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={`flex flex-col gap-2 py-3 ${i > 0 ? "border-t border-border-light" : ""}`}
        >
          <Skeleton className="h-[9px]" row={i} style={{ width: i % 2 ? "46%" : "62%" }} />
          {meta ? (
            <Skeleton className="h-[7px]" row={i} style={{ width: i % 2 ? "28%" : "36%" }} />
          ) : null}
        </div>
      ))}
    </div>
  );
}
