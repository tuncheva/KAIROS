"use client";

import { useTransition } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { LOCALE_METADATA, locales, type Locale } from "~/i18n/locales";
import { guessTimeZone, supportedTimeZones } from "~/lib/timezone";

import {
  LedgerAction,
  LedgerGroup,
  LedgerSection,
  LedgerSelect,
  useSectionCrumb,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

type LanguageCode = Locale;
type DateFormatOption = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";

// Single source of truth in `~/i18n/locales`. Both this and `LanguageSwitcher` kept
// their own copy of the list, which is how three half-translated locales stayed on
// offer after the coverage gap was known.
const languages = locales.map((code) => ({ code, ...LOCALE_METADATA[code] }));

// Every zone the runtime knows, not a curated six.
//
// The short list was defensible while this preference was cosmetic. It stopped
// being cosmetic when the scheduler started reading it to decide when a user's
// morning is: a list of six places means the daily brief is only correct for
// people who happen to live in one of them, and everyone else silently keeps UTC.
//
// Computed once at module scope — `supportedValuesOf` returns ~420 strings and
// the answer cannot change while the page is open.
const timezones = supportedTimeZones();

const DATE_FORMATS: DateFormatOption[] = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"];

function isDateFormatOption(value: unknown): value is DateFormatOption {
  return value === "MM/DD/YYYY" || value === "DD/MM/YYYY" || value === "YYYY-MM-DD";
}

export function LanguageSettingsClient() {
  const useT = useTranslations as unknown as (namespace: string) => Translator;
  const t = useT("settings.language");
  const crumb = useSectionCrumb("language");
  const save = useSettingsSave();

  const useL = useLocale as unknown as () => LanguageCode;
  const locale = useL();
  const [isPending, startTransition] = useTransition();

  const { status } = useSession();
  const enabled = status === "authenticated";

  const { data, isLoading } = api.settings.get.useQuery(undefined, {
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const utils = api.useUtils();

  const updateLanguageRegion = api.settings.updateLanguageRegion.useMutation({
    onSuccess: async () => {
      await utils.settings.get.invalidate();
    },
  });

  const timezone = data?.timezone ?? "UTC";
  const dateFormat: DateFormatOption = isDateFormatOption(data?.dateFormat)
    ? data.dateFormat
    : "MM/DD/YYYY";

  const isBusy = isLoading || isPending || updateLanguageRegion.isPending;

  const onLanguageChange = (next: string) => {
    startTransition(async () => {
      await save.run(() =>
        updateLanguageRegion.mutateAsync({ language: next as LanguageCode }),
      );
      document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000; SameSite=Lax`;
      window.location.reload();
    });
  };

  const onTimezoneChange = (next: string) => {
    void save.run(() => updateLanguageRegion.mutateAsync({ timezone: next }));
  };

  // Every account is born "UTC" — the column default — so a stored UTC is
  // indistinguishable from a deliberate choice. Now that the scheduler reads this
  // to decide when someone's morning is, leaving it at the default silently gives
  // most users a brief at the wrong hour.
  //
  // The old screen handled that by pre-selecting the browser's guess and marking
  // the form dirty, which needed a Save button to finish the thought. With
  // save-on-change there is no such button, so the guess is offered as its own
  // row instead: a sentence and one control that writes it. Still not written for
  // them — an unprompted change to a preference nobody touched is worse than a
  // visible one-click offer.
  const guess = guessTimeZone();
  const suggestZone = timezone === "UTC" && guess !== "UTC" ? guess : null;

  const regionRows: LedgerRow[] = [
    {
      id: "timezone",
      title: t("timezone"),
      control: (
        <LedgerSelect
          value={timezone}
          disabled={isBusy}
          ariaLabel={t("timezone")}
          onChange={onTimezoneChange}
          options={timezones.map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }))}
        />
      ),
    },
    {
      id: "dateFormat",
      title: t("dateFormat"),
      control: (
        <LedgerSelect
          value={dateFormat}
          disabled={isBusy}
          ariaLabel={t("dateFormat")}
          onChange={(next) =>
            void save.run(() =>
              updateLanguageRegion.mutateAsync({ dateFormat: next as DateFormatOption }),
            )
          }
          options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
        />
      ),
    },
  ];

  if (suggestZone) {
    regionRows.splice(1, 0, {
      id: "timezoneSuggestion",
      title: t("timezoneSuggestTitle"),
      desc: t("timezoneSuggestDesc", { zone: suggestZone.replace(/_/g, " ") }),
      control: (
        <LedgerAction disabled={isBusy} onClick={() => onTimezoneChange(suggestZone)}>
          {t("timezoneSuggestAction", { zone: suggestZone.replace(/_/g, " ") })}
        </LedgerAction>
      ),
    });
  }

  return (
    <LedgerSection
      sectionId="language"
      crumb={crumb}
      title={t("title")}
      subtitle={t("subtitle")}
    >
      <LedgerGroup
        label={t("groupLanguage")}
        hint={t("groupLanguageHint")}
        rows={[
          {
            id: "displayLanguage",
            title: t("displayLanguage"),
            desc: isPending ? t("applying") : undefined,
            keywords: languages.map((l) => l.name).join(" "),
            control: (
              <LedgerSelect
                value={locale}
                disabled={isBusy}
                ariaLabel={t("displayLanguage")}
                onChange={onLanguageChange}
                options={languages.map((l) => ({
                  value: l.code,
                  label: `${l.flag}  ${l.name}`,
                }))}
              />
            ),
          },
        ]}
      />

      <LedgerGroup label={t("groupRegion")} hint={t("groupRegionHint")} rows={regionRows} />
    </LedgerSection>
  );
}
