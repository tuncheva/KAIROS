"use client";

import { useTranslations } from "next-intl";

import { Check } from "~/components/ui/icons";
import type { MemberPermissionFlags, PermissionFlag } from "~/lib/permissions";

/** The eight flags in the order people read them: work first, administration last. */
export const PERMISSION_DISPLAY_ORDER = [
  "canCreateProjects",
  "canEditProjects",
  "canAssignTasks",
  "canDeleteTasks",
  "canAddMembers",
  "canKickMembers",
  "canManageRoles",
  "canViewAnalytics",
] as const satisfies readonly PermissionFlag[];

/** i18n keys under `settings.workspace.permissions`. */
export const PERMISSION_LABEL_KEYS: Record<PermissionFlag, string> = {
  canCreateProjects: "createProjects",
  canEditProjects: "editProjects",
  canAssignTasks: "assignTasks",
  canDeleteTasks: "deleteTasks",
  canAddMembers: "inviteMembers",
  canKickMembers: "removeMembers",
  canManageRoles: "manageRoles",
  canViewAnalytics: "viewAnalytics",
};

export function usePermissionLabel(): (key: PermissionFlag) => string {
  const t = useTranslations("settings.workspace.permissions");
  return (key) => t(PERMISSION_LABEL_KEYS[key]);
}

/**
 * The eight permission ticks.
 *
 * Read-only when `onChange` is absent — the template and custom role cards —
 * and editable otherwise. `lockedKeys` are shown but cannot be ticked: the flags
 * the current user does not hold and so cannot hand out.
 */
export function PermissionGrid({
  value,
  onChange,
  lockedKeys,
  lockedHint,
}: {
  value: MemberPermissionFlags;
  onChange?: (next: MemberPermissionFlags) => void;
  lockedKeys?: readonly PermissionFlag[];
  lockedHint?: string;
}) {
  const label = usePermissionLabel();

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {PERMISSION_DISPLAY_ORDER.map((key) => {
        const checked = value[key];
        const box = (
          <span
            className={`flex h-4 w-4 flex-none items-center justify-center rounded-sm border transition ${
              checked
                ? "border-accent-primary/50 bg-accent-primary/20"
                : "border-border-light bg-bg-tertiary"
            }`}
          >
            {checked ? <Check size={10} className="text-accent-primary" /> : null}
          </span>
        );

        if (!onChange) {
          return (
            <span key={key} className="flex items-center gap-2 text-xs text-fg-secondary">
              {box}
              {label(key)}
            </span>
          );
        }

        const locked = lockedKeys?.includes(key) ?? false;
        return (
          <label
            key={key}
            title={locked ? lockedHint : undefined}
            className={`flex items-center gap-2 text-xs transition ${
              locked
                ? "cursor-not-allowed text-fg-quaternary"
                : "cursor-pointer text-fg-secondary hover:text-fg-primary"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={locked}
              onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
              className="peer sr-only"
            />
            <span className="rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-accent-primary/40">
              {box}
            </span>
            {label(key)}
          </label>
        );
      })}
    </div>
  );
}

/** "Create projects, Edit projects +2" — a one-line summary for lists. */
export function usePermissionSummary(): (flags: MemberPermissionFlags, viewOnly: string) => string {
  const label = usePermissionLabel();
  return (flags, viewOnly) => {
    const granted = PERMISSION_DISPLAY_ORDER.filter((key) => flags[key]);
    if (granted.length === 0) return viewOnly;
    if (granted.length <= 2) return granted.map(label).join(", ");
    return `${granted.slice(0, 2).map(label).join(", ")} +${granted.length - 2}`;
  };
}
