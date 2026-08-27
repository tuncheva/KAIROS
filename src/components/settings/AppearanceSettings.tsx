"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { api } from "~/trpc/react";
import { useTranslations } from "next-intl";

import {
  LedgerCheck,
  LedgerGroup,
  LedgerSection,
  LedgerSwatches,
  useSectionCrumb,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

const ACCENTS = [
  { id: "purple", cssVar: "--brand-purple" },
  { id: "pink", cssVar: "--brand-pink" },
  { id: "caramel", cssVar: "--brand-caramel" },
  { id: "mint", cssVar: "--brand-mint" },
  { id: "sky", cssVar: "--brand-sky" },
  { id: "strawberry", cssVar: "--brand-strawberry" },
] as const;

type AccentId = (typeof ACCENTS)[number]["id"];

/** Older rows hold accents this build no longer offers; map them, don't drop them. */
function normalizeAccent(accent?: string | null): AccentId {
  switch (accent) {
    case "purple":
    case "pink":
    case "caramel":
    case "mint":
    case "sky":
    case "strawberry":
      return accent;
    case "indigo":
      return "purple";
    case "cyan":
    case "teal":
    case "green":
      return "mint";
    case "blue":
      return "sky";
    default:
      return "purple";
  }
}

export function AppearanceSettings() {
  const useT = useTranslations as unknown as (namespace: string) => Translator;
  const t = useT("settings");
  const crumb = useSectionCrumb("appearance");
  const save = useSettingsSave();

  const { theme, setTheme, systemTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const utils = api.useUtils();

  const { status } = useSession();
  const enabled = status === "authenticated";

  const { data } = api.settings.get.useQuery(undefined, {
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const updateAppearance = api.settings.updateAppearance.useMutation({
    onSuccess: async () => {
      await utils.settings.get.invalidate();
    },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = theme === "system" ? systemTheme : theme;
  const currentAccent = normalizeAccent(data?.accentColor);

  const onSelectTheme = (next: "light" | "dark" | "system") => {
    // Applied before the write, not after it: the point of this control is that
    // the app changes colour when you click it.
    setTheme(next);
    void save.run(() => updateAppearance.mutateAsync({ theme: next }));
  };

  const onSelectAccent = (accent: string) => {
    document.documentElement.dataset.accent = accent;
    void save.run(() =>
      updateAppearance.mutateAsync({ accentColor: accent as AccentId }),
    );
  };

  const themeRows: LedgerRow[] = (["light", "dark", "system"] as const).map((id) => ({
    id,
    title: t(`appearance.${id}`),
    // Only "System" needs saying which way it currently resolves; the other two
    // are their own explanation.
    desc:
      id === "system" && mounted
        ? t("appearance.systemWithTheme", {
            mode: currentTheme === "dark" ? t("appearance.dark") : t("appearance.light"),
          })
        : undefined,
    control: (
      <LedgerCheck
        checked={mounted && theme === id}
        label={t(`appearance.${id}`)}
        onClick={() => onSelectTheme(id)}
      />
    ),
  }));

  return (
    <LedgerSection
      sectionId="appearance"
      crumb={crumb}
      title={t("appearance.title")}
      subtitle={t("appearance.subtitle")}
    >
      <LedgerGroup
        label={t("appearance.theme")}
        hint={t("appearance.themeDesc")}
        rows={themeRows}
      />

      <LedgerGroup
        label={t("appearance.accent")}
        hint={t("appearance.accentDesc")}
        rows={[
          {
            id: "accent",
            title: t("appearance.accent"),
            keywords: ACCENTS.map((a) => t(`appearance.${a.id}`)).join(" "),
            control: (
              <LedgerSwatches
                current={currentAccent}
                onSelect={onSelectAccent}
                options={ACCENTS.map((a) => ({
                  id: a.id,
                  cssVar: a.cssVar,
                  name: t(`appearance.${a.id}`),
                }))}
              />
            ),
          },
        ]}
      />
    </LedgerSection>
  );
}
