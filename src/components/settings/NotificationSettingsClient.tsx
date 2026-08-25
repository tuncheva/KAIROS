"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

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
   * Grouped switches are disabled while the master in-app switch is off, because
   * the server ignores them in that state. A toggle that visibly does nothing is
   * how the previous version of this screen misled people for so long.
   */
  dependsOnInApp: boolean;
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

  const { status } = useSession();
  const enabled = status === "authenticated";

  const { data, isLoading } = api.settings.get.useQuery(undefined, {
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const utils = api.useUtils();

  const settings = data;

  const updateNotifications = api.settings.updateNotifications.useMutation({
    onSuccess: async () => {
      await utils.settings.get.invalidate();
    },
  });

  const initial = useMemo(() => {
    const resolved = { ...DEFAULTS };
    if (settings) {
      for (const key of Object.keys(DEFAULTS) as NotificationKey[]) {
        const value = settings[key as keyof typeof settings];
        if (typeof value === "boolean") resolved[key] = value;
      }
    }
    return resolved;
  }, [settings]);

  const [values, setValues] = useState<Record<NotificationKey, boolean>>(initial);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setValues(initial);
    setTouched(false);
  }, [initial]);

  const isBusy = isLoading || updateNotifications.isPending;

  const onToggle = (key: NotificationKey, checked: boolean) => {
    setValues((prev) => ({ ...prev, [key]: checked }));
    setTouched(true);
  };

  const onSave = async () => {
    await updateNotifications.mutateAsync(values);
    setTouched(false);
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-bg-primary">
      <div className="w-full px-4 sm:px-6">
        {/* Header */}
        <div className="pt-8 pb-6">
          <h1 className="text-[34px] font-[700] leading-[1.1] tracking-[-0.022em] text-fg-primary mb-2">
            {t("title")}
          </h1>
          <p className="text-[15px] leading-[1.4667] tracking-[-0.01em] text-fg-tertiary">
            {t("subtitle")}
          </p>
        </div>

        <div className="space-y-8">
          {GROUPS.map((group) => {
            const dimmed = group.dependsOnInApp && !values.inAppNotifications;

            return (
              <div key={group.titleKey} className="mb-8">
                <div className="px-1 mb-2">
                  <h2 className="text-[13px] font-[590] uppercase tracking-[0.06em] text-fg-tertiary">
                    {t(group.titleKey)}
                  </h2>
                  <p className="mt-1 text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary">
                    {t(group.descriptionKey)}
                  </p>
                </div>

                <div
                  className={`bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06] transition-opacity duration-200 ${
                    dimmed ? "opacity-50" : ""
                  }`}
                >
                  {group.keys.map((key, index) => {
                    const checked = values[key];
                    const disabled = isBusy || dimmed;

                    return (
                      <div key={key} className="relative">
                        <div className="flex items-center justify-between pl-[16px] pr-[18px] py-[11px]">
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="text-[17px] leading-[1.235] tracking-[-0.016em] text-fg-primary font-[590] mb-[1px]">
                              {t(LABELS[key].title)}
                            </div>
                            <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary">
                              {t(LABELS[key].desc)}
                            </div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={checked}
                            aria-label={t(LABELS[key].title)}
                            disabled={disabled}
                            onClick={() => onToggle(key, !checked)}
                            className={`relative inline-flex h-[31px] w-[51px] flex-shrink-0 rounded-full border transition-colors duration-200 focus:outline-none ${
                              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                            } ${
                              checked
                                ? "border-transparent"
                                : "border-gray-300/30 dark:border-gray-600/50"
                            } ${!checked ? "bg-bg-tertiary" : ""}`}
                            style={
                              checked
                                ? { backgroundColor: `rgb(var(--accent-primary))` }
                                : undefined
                            }
                          >
                            <span
                              className={`pointer-events-none inline-block h-[27px] w-[27px] transform rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-transform duration-200 ease-in-out ${
                                checked ? "translate-x-[20px]" : "translate-x-[1px]"
                              }`}
                            />
                          </button>
                        </div>
                        {index < group.keys.length - 1 && (
                          <div className="absolute bottom-0 left-[16px] right-[18px] h-[0.33px] border-t border-white/[0.04]" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Security notices are not configurable; saying so is clearer than
              leaving a user to wonder which switch covers them. */}
          <div className="mb-8 px-1">
            <p className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary">
              {t("securityAlwaysOn")}
            </p>
          </div>

          {/* Save Button Card */}
          <div className="mb-6">
            <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
              <div className="px-4 py-4">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={isBusy || !touched}
                  className={`w-full py-3.5 rounded-[10px] text-center text-[17px] leading-[1.235] tracking-[-0.016em] font-[590] transition-all duration-200 ${
                    isBusy || !touched
                      ? "bg-bg-tertiary text-fg-secondary cursor-not-allowed"
                      : "text-white active:opacity-80"
                  }`}
                  style={
                    !isBusy && touched
                      ? { backgroundColor: `rgb(var(--accent-primary))` }
                      : undefined
                  }
                >
                  {t("save")}
                </button>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {updateNotifications.error && (
            <div className="mb-6">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-[10px] overflow-hidden">
                <div className="px-4 py-3.5">
                  <p className="text-[15px] leading-[1.4667] tracking-[-0.012em] text-red-600 dark:text-red-400 text-center">
                    {updateNotifications.error.message}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Spacing */}
          <div className="h-8"></div>
        </div>
      </div>
    </div>
  );
}
