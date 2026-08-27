"use client";

/**
 * Privacy — the switches that decide what the profile drawer shows about you.
 *
 * `settings.updatePrivacy` has existed for a long time and nothing in the app
 * ever called it: the four columns it writes had no UI at all, so a user could
 * not turn their own profile off even though the column said they could. This
 * screen is the first caller, and it arrives alongside the first feature that
 * reads those columns (`~/server/profile/visibility`).
 *
 * The master switch and the audience are two controls rather than one
 * four-value list on purpose. Collapsing them would mean that switching your
 * profile back on had to re-ask who should see it, and — worse — that a stored
 * "off" would have to be migrated into some audience, silently widening the
 * reach of exactly the people who had opted out.
 */

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { useProfilePeek } from "~/components/profile/ProfilePeekProvider";

import {
  LedgerAction,
  LedgerGroup,
  LedgerSection,
  LedgerSelect,
  LedgerToggle,
  useSectionCrumb,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

type Audience = "everyone" | "organization" | "shared";

const AUDIENCES: Audience[] = ["everyone", "organization", "shared"];

export function PrivacySettingsClient() {
  const useT = useTranslations as unknown as (namespace: string) => Translator;
  const t = useT("settings.privacy");
  const crumb = useSectionCrumb("privacy");
  const save = useSettingsSave();
  const router = useRouter();
  const { openProfile } = useProfilePeek();

  const { data: session, status } = useSession();
  const enabled = status === "authenticated";

  const { data, isLoading } = api.settings.get.useQuery(undefined, {
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const utils = api.useUtils();

  const updatePrivacy = api.settings.updatePrivacy.useMutation({
    // Optimistic for the same reason every other switch on this page is: there
    // is no Save button, and a control that waits for a round trip before it
    // moves reads as broken.
    onMutate: async (patch) => {
      await utils.settings.get.cancel();
      const previous = utils.settings.get.getData();
      utils.settings.get.setData(undefined, (old) =>
        old ? { ...old, ...patch } : old,
      );
      return { previous };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.previous) utils.settings.get.setData(undefined, ctx.previous);
    },
    onSettled: async () => {
      await utils.settings.get.invalidate();
      // The drawer reads the same columns through a different procedure, so a
      // change here has to reach it too — otherwise the preview keeps showing
      // the audience you just left.
      await utils.profile.getPublicProfile.invalidate();
    },
  });

  const values = useMemo(
    () => ({
      profileVisibility: data?.profileVisibility ?? true,
      profileAudience: (data?.profileAudience ?? "organization") as Audience,
      showOnlineStatus: data?.showOnlineStatus ?? true,
      allowFollowers: data?.allowFollowers ?? true,
      showActivityFeed: data?.showActivityFeed ?? true,
    }),
    [data],
  );

  const commit = (patch: Parameters<typeof updatePrivacy.mutateAsync>[0]) => {
    void save.run(() => updatePrivacy.mutateAsync(patch));
  };

  /** Everything below the master switch is inert while the profile is hidden. */
  const muted = !values.profileVisibility;

  const visibilityRows: LedgerRow[] = [
    {
      id: "profileVisibility",
      title: t("visible"),
      desc: t("visibleDesc"),
      keywords: "profile visibility hidden public",
      control: (
        <LedgerToggle
          checked={values.profileVisibility}
          disabled={isLoading}
          label={t("visible")}
          onChange={(next) => commit({ profileVisibility: next })}
        />
      ),
    },
    {
      id: "profileAudience",
      title: t("audience"),
      desc: t("audienceDesc"),
      keywords: "audience everyone organization shared who can see",
      muted,
      control: (
        <LedgerSelect<Audience>
          value={values.profileAudience}
          disabled={isLoading || muted}
          ariaLabel={t("audience")}
          options={AUDIENCES.map((key) => ({
            value: key,
            label: t(`audience_${key}`),
          }))}
          onChange={(next) =>
            commit({ profileAudience: next as Audience })
          }
        />
      ),
    },
  ];

  const detailRows: LedgerRow[] = [
    {
      id: "showOnlineStatus",
      title: t("onlineStatus"),
      desc: t("onlineStatusDesc"),
      keywords: "online status presence green dot",
      muted,
      control: (
        <LedgerToggle
          checked={values.showOnlineStatus}
          disabled={isLoading || muted}
          label={t("onlineStatus")}
          onChange={(next) => commit({ showOnlineStatus: next })}
        />
      ),
    },
    {
      id: "allowFollowers",
      title: t("followers"),
      desc: t("followersDesc"),
      keywords: "followers follow social",
      muted,
      control: (
        <LedgerToggle
          checked={values.allowFollowers}
          disabled={isLoading || muted}
          label={t("followers")}
          onChange={(next) => commit({ allowFollowers: next })}
        />
      ),
    },
    {
      id: "showActivityFeed",
      title: t("activityFeed"),
      desc: t("activityFeedDesc"),
      keywords: "activity feed events published rsvp",
      muted,
      control: (
        <LedgerToggle
          checked={values.showActivityFeed}
          disabled={isLoading || muted}
          label={t("activityFeed")}
          onChange={(next) => commit({ showActivityFeed: next })}
        />
      ),
    },
  ];

  const previewRows: LedgerRow[] = [
    {
      id: "preview",
      title: t("preview"),
      desc: t("previewDesc"),
      keywords: "preview profile how others see me",
      control: (
        <LedgerAction
          disabled={!session?.user?.id}
          onClick={() => {
            if (session?.user?.id) openProfile(session.user.id);
          }}
        >
          {t("previewAction")}
        </LedgerAction>
      ),
    },
    {
      id: "editProfile",
      title: t("edit"),
      desc: t("editDesc"),
      keywords: "edit profile name bio avatar",
      control: (
        <LedgerAction onClick={() => router.push("/settings?section=profile")}>
          {t("editAction")}
        </LedgerAction>
      ),
    },
  ];

  return (
    <LedgerSection
      sectionId="privacy"
      crumb={crumb}
      title={t("title")}
      subtitle={t("subtitle")}
    >
      <LedgerGroup
        label={t("groupVisibility")}
        hint={t("groupVisibilityHint")}
        rows={visibilityRows}
      />
      <LedgerGroup
        label={t("groupDetails")}
        hint={t("groupDetailsHint")}
        note={muted ? t("hiddenNote") : undefined}
        rows={detailRows}
      />
      <LedgerGroup
        label={t("groupProfile")}
        hint={t("groupProfileHint")}
        rows={previewRows}
      />
    </LedgerSection>
  );
}
