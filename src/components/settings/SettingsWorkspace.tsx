"use client";

/**
 * The /settings shell: numbered rail on the left, ledger on the right.
 *
 * The rail's filter is the reason this component exists rather than the page
 * simply mounting one section. A query searches every section at once, so while
 * one is typed all eight are mounted inside the filter provider and each hides
 * the groups and rows that did not match; the rail then shows how many rows each
 * section contributed. With no query only the section named by `?section=` is
 * mounted, which is what keeps the page from firing every section's queries on a
 * normal visit.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  SectionMatchCollector,
  SettingsFilterProvider,
  SettingsSaveProvider,
  useSettingsSave,
} from "./ledger/Ledger";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";
import { ProfileSettingsClient } from "./ProfileSettingsClient";
import { WorkspaceSettingsClient } from "./WorkspaceSettingsClient";
import { NotificationSettingsClient } from "./NotificationSettingsClient";
import { SecuritySettingsClient } from "./SecuritySettingsClient";
import { LanguageSettingsClient } from "./LanguageSettingsClient";
import { AppearanceSettings } from "./AppearanceSettings";
import { AiSettingsClient } from "./AiSettingsClient";
import { DeveloperSettingsClient } from "./DeveloperSettingsClient";

type Translator = (key: string, values?: Record<string, unknown>) => string;

interface Props {
  activeSection: SettingsSectionId;
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    bio?: string | null;
  };
}

export function SettingsWorkspace({ activeSection, user }: Props) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings");

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Debounced, because applying it mounts all eight sections and with them every
  // query those sections make. One keystroke should not do that.
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery), 250);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const filtering = query.trim().length > 0;
  const totalMatches = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts],
  );

  const sections = filtering ? SETTINGS_SECTIONS : [activeSection];

  return (
    <SettingsSaveProvider>
      <SettingsFilterProvider query={query}>
        <div className="flex min-h-full flex-col lg:flex-row">
          <aside className="flex-none border-b border-border-light lg:w-[248px] lg:border-b-0 lg:border-r">
            <div className="px-6 pb-5 pt-6 lg:pt-8">
              <div className="flex items-center gap-2.5 border-b border-border-medium pb-2.5 focus-within:border-accent-primary">
                <Search size={14} className="flex-none text-fg-tertiary" />
                <input
                  value={rawQuery}
                  onChange={(e) => setRawQuery(e.target.value)}
                  placeholder={t("filterPlaceholder")}
                  aria-label={t("filterPlaceholder")}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13.5px] text-fg-primary outline-none placeholder:text-fg-quaternary"
                />
              </div>
            </div>

            <nav
              aria-label={t("title")}
              className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-10"
            >
              {SETTINGS_SECTIONS.map((id, index) => {
                const active = id === activeSection && !filtering;
                const count = counts[id] ?? 0;
                return (
                  <Link
                    key={id}
                    href={`/settings?section=${id}`}
                    onClick={() => {
                      setRawQuery("");
                      setQuery("");
                    }}
                    aria-current={active ? "page" : undefined}
                    className={`flex flex-none items-baseline gap-2.5 whitespace-nowrap rounded-lg px-4 py-2.5 transition-colors hover:bg-bg-tertiary/60 lg:rounded-none lg:px-6 ${
                      active ? "bg-bg-tertiary/60 lg:bg-transparent" : ""
                    }`}
                  >
                    <span
                      className={`font-mono text-[10px] ${
                        active ? "text-accent-primary" : "text-fg-quaternary"
                      }`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={`text-[14px] tracking-[-0.01em] ${
                        active
                          ? "font-semibold text-fg-primary"
                          : "font-normal text-fg-secondary"
                      }`}
                    >
                      {t(`nav.${id}`)}
                    </span>
                    <span className="hidden flex-1 lg:block" />
                    {filtering ? (
                      <span
                        className={`font-mono text-[10px] ${
                          count > 0 ? "text-accent-primary" : "text-fg-quaternary"
                        }`}
                      >
                        {count}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </aside>

          <main className="min-w-0 flex-1 px-6 pb-24 pt-8 sm:px-10 lg:pb-20 lg:pl-12 lg:pr-14 lg:pt-12">
            <SectionMatchCollector onChange={setCounts}>
              <div className="flex flex-col gap-10">
                {filtering ? (
                  <div className="flex flex-col gap-4 border-b border-border-light pb-5 sm:flex-row sm:items-end sm:gap-5">
                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-tertiary">
                        {t("filterCrumb")}
                      </span>
                      <h1 className="m-0 text-[29px] font-semibold leading-none tracking-[-0.025em] text-fg-primary">
                        {t("filterTitle")}
                      </h1>
                    </div>
                    <span className="flex-1" />
                    <span className="max-w-[360px] text-[13.5px] text-fg-secondary sm:text-right">
                      {t("filterSubtitle")}
                    </span>
                  </div>
                ) : (
                  <SaveIndicator />
                )}

                {sections.map((id) => (
                  <SectionBody key={id} id={id} user={user} />
                ))}

                {filtering && totalMatches === 0 ? (
                  <p className="py-10 text-[14px] text-fg-tertiary">{t("filterEmpty")}</p>
                ) : null}
              </div>
            </SectionMatchCollector>
          </main>
        </div>
      </SettingsFilterProvider>
    </SettingsSaveProvider>
  );
}

function SectionBody({ id, user }: { id: SettingsSectionId; user: Props["user"] }) {
  switch (id) {
    case "profile":
      return <ProfileSettingsClient user={user} />;
    case "workspace":
      return <WorkspaceSettingsClient />;
    case "notifications":
      return <NotificationSettingsClient />;
    case "security":
      return <SecuritySettingsClient />;
    case "language":
      return <LanguageSettingsClient />;
    case "appearance":
      return <AppearanceSettings />;
    case "ai":
      return <AiSettingsClient />;
    case "developer":
      return <DeveloperSettingsClient />;
  }
}

/**
 * "Saving" / "All changes saved".
 *
 * There is no Save button anywhere on this page any more, so this line is the
 * only account of whether a change reached the server. It sits above the section
 * heading rather than in the app's top bar, which belongs to every page and
 * would have to learn about settings to carry it.
 */
function SaveIndicator() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings");
  const { state } = useSettingsSave();

  const label =
    state === "saving"
      ? t("saveSaving")
      : state === "error"
        ? t("saveFailed")
        : t("saveSaved");

  return (
    <span className="-mb-6 flex items-center gap-2">
      <span
        className={`h-1.5 w-1.5 rounded-full transition-colors ${
          state === "saving"
            ? "bg-accent-primary"
            : state === "error"
              ? "bg-error"
              : "bg-border-strong"
        }`}
      />
      <span
        className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
          state === "error" ? "text-error" : "text-fg-tertiary"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
