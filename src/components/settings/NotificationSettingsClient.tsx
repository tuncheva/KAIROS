"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

import {
  LedgerGroup,
  LedgerSection,
  LedgerToggle,
  useSectionCrumb,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

/**
 * Every switch on this screen, in the order they are grouped below.
 *
 * These used to be five toggles that nothing on the server read. They are now the
 * actual gate — see `~/server/notifications/dispatch`, which resolves a category
 * to one of these columns and drops the notification when it is false.
 */
type NotificationKey =
  | "inAppNotifications"
  | "directMessageNotifications"
  | "projectUpdatesNotifications"
  | "taskAssignmentNotifications"
  | "taskDueRemindersNotifications"
  | "eventRemindersNotifications"
  | "eventUpdatesNotifications"
  | "eventRsvpNotifications"
  | "socialNotifications"
  | "inviteNotifications"
  | "workspaceNotifications"
  | "emailNotifications"
  | "marketingEmailsNotifications";

const DEFAULTS: Record<NotificationKey, boolean> = {
  inAppNotifications: true,
  directMessageNotifications: true,
  projectUpdatesNotifications: true,
  taskAssignmentNotifications: true,
  taskDueRemindersNotifications: true,
  eventRemindersNotifications: true,
  eventUpdatesNotifications: true,
  eventRsvpNotifications: true,
  socialNotifications: true,
  inviteNotifications: true,
  workspaceNotifications: true,
  emailNotifications: true,
  marketingEmailsNotifications: false,
};

interface Group {
  titleKey: string;
  descriptionKey: string;
  keys: NotificationKey[];
  /**
   * Grouped switches are inert while the master in-app switch is off, because
   * the server ignores them in that state. A toggle that visibly does nothing is
   * how the previous version of this screen misled people for so long.
   */
  dependsOnInApp: boolean;
  noteKey?: string;
}

const GROUPS: Group[] = [
  {
    titleKey: "groupMasterTitle",
    descriptionKey: "groupMasterDesc",
    keys: ["inAppNotifications"],
    dependsOnInApp: false,
  },
  {
    titleKey: "groupPeopleTitle",
    descriptionKey: "groupPeopleDesc",
    keys: ["directMessageNotifications", "socialNotifications", "inviteNotifications"],
    dependsOnInApp: true,
  },
  {
    titleKey: "groupWorkTitle",
    descriptionKey: "groupWorkDesc",
    keys: [
      "projectUpdatesNotifications",
      "taskAssignmentNotifications",
      "taskDueRemindersNotifications",
      "workspaceNotifications",
    ],
    dependsOnInApp: true,
  },
  {
    titleKey: "groupEventsTitle",
    descriptionKey: "groupEventsDesc",
    keys: [
      "eventRemindersNotifications",
      "eventUpdatesNotifications",
      "eventRsvpNotifications",
    ],
    dependsOnInApp: true,
  },
  {
    titleKey: "groupEmailTitle",
    descriptionKey: "groupEmailDesc",
    keys: ["emailNotifications", "marketingEmailsNotifications"],
    dependsOnInApp: false,
    noteKey: "securityAlwaysOn",
  },
];

/** Maps a column name to its `settings.notifications.*` label and description keys. */
const LABELS: Record<NotificationKey, { title: string; desc: string }> = {
  inAppNotifications: { title: "inApp", desc: "inAppDesc" },
  directMessageNotifications: { title: "directMessages", desc: "directMessagesDesc" },
  projectUpdatesNotifications: { title: "projects", desc: "projectsDesc" },
  taskAssignmentNotifications: { title: "taskAssignments", desc: "taskAssignmentsDesc" },
  taskDueRemindersNotifications: { title: "tasks", desc: "tasksDesc" },
  eventRemindersNotifications: { title: "events", desc: "eventsDesc" },
  eventUpdatesNotifications: { title: "eventUpdates", desc: "eventUpdatesDesc" },
  eventRsvpNotifications: { title: "eventRsvps", desc: "eventRsvpsDesc" },
  socialNotifications: { title: "social", desc: "socialDesc" },
  inviteNotifications: { title: "invites", desc: "invitesDesc" },
  workspaceNotifications: { title: "workspace", desc: "workspaceDesc" },
  emailNotifications: { title: "email", desc: "emailDesc" },
  marketingEmailsNotifications: { title: "marketing", desc: "marketingDesc" },
};

export function NotificationSettingsClient() {
  const useT = useTranslations as unknown as (namespace: string) => Translator;
  const t = useT("settings.notifications");
  const crumb = useSectionCrumb("notifications");
  const save = useSettingsSave();

  const { status } = useSession();
  const enabled = status === "authenticated";

  const { data, isLoading } = api.settings.get.useQuery(undefined, {
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const utils = api.useUtils();

  const updateNotifications = api.settings.updateNotifications.useMutation({
    // Optimistic, because a switch that waits for a round trip before moving
    // feels broken, and this page no longer has a Save button to blame the
    // delay on. The header's indicator carries the truth.
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
    },
  });

  const values = useMemo(() => {
    const resolved = { ...DEFAULTS };
    if (data) {
      for (const key of Object.keys(DEFAULTS) as NotificationKey[]) {
        const value = data[key as keyof typeof data];
        if (typeof value === "boolean") resolved[key] = value;
      }
    }
    return resolved;
  }, [data]);

  const onToggle = (key: NotificationKey, checked: boolean) => {
    void save.run(() => updateNotifications.mutateAsync({ [key]: checked }));
  };

  return (
    <LedgerSection
      sectionId="notifications"
      crumb={crumb}
      title={t("title")}
      subtitle={t("subtitle")}
    >
      {GROUPS.map((group) => {
        const muted = group.dependsOnInApp && !values.inAppNotifications;

        const rows: LedgerRow[] = group.keys.map((key) => ({
          id: key,
          title: t(LABELS[key].title),
          desc: t(LABELS[key].desc),
          keywords: key,
          muted,
          control: (
            <LedgerToggle
              checked={values[key]}
              disabled={isLoading || muted}
              label={t(LABELS[key].title)}
              onChange={(next) => onToggle(key, next)}
            />
          ),
        }));

        return (
          <LedgerGroup
            key={group.titleKey}
            label={t(group.titleKey)}
            hint={t(group.descriptionKey)}
            note={group.noteKey ? t(group.noteKey) : undefined}
            rows={rows}
          />
        );
      })}
    </LedgerSection>
  );
}
