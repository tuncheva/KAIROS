"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { AlertCircle, Check, Copy, Loader2, Lock, Plus, RefreshCw, Search, Trash2 } from "~/components/ui/icons";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useToast } from "~/components/providers/ToastProvider";
import { ProfileLink } from "~/components/profile/ProfileLink";
import { usePermissionLabel } from "~/components/orgs/PermissionGrid";
import { avatarGradientStyle } from "~/lib/avatarGradient";
import {
  PERMISSION_FLAG_KEYS,
  ROLE_TEMPLATES,
  TEMPLATE_ROLE_ORDER,
  pickPermissionFlags,
  sameFlags,
  type MemberPermissionFlags,
  type PermissionFlag,
} from "~/lib/permissions";
import { api } from "~/trpc/react";

import { useSettingsSave } from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

type TemplateRole = (typeof TEMPLATE_ROLE_ORDER)[number];
/** A column: a built-in template, a custom role, or the one being created. */
type ColumnKey = TemplateRole | `custom:${number}` | "new";

export type MatrixMember = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  displayRole: string | null;
} & MemberPermissionFlags;

export type MatrixRole = { id: number; name: string } & MemberPermissionFlags;

/**
 * The eight flags as rows, in `PERMISSION_DISPLAY_ORDER` and grouped by what
 * they are about. A test holds this to covering every flag exactly once.
 */
export const PERMISSION_GROUPS = [
  {
    key: "groupWork",
    flags: ["canCreateProjects", "canEditProjects", "canAssignTasks", "canDeleteTasks"],
  },
  { key: "groupPeople", flags: ["canAddMembers", "canKickMembers", "canManageRoles"] },
  { key: "groupInsight", flags: ["canViewAnalytics"] },
] as const satisfies readonly { key: string; flags: readonly PermissionFlag[] }[];

/** Flags that give power over other people rather than over work. */
export const RISKY_FLAGS: ReadonlySet<PermissionFlag> = new Set([
  "canKickMembers",
  "canManageRoles",
]);

interface Column {
  key: ColumnKey;
  name: string;
  kind: "template" | "custom" | "new";
  roleId?: number;
  /** The saved flags — what holders are compared against. */
  flags: MemberPermissionFlags;
}

/**
 * Who holds a column's role.
 *
 * A membership remembers a custom role only by name (`displayRole`) and keeps
 * its own copy of the flags, so this is a label match, not a foreign key. A
 * `displayRole` naming a role that no longer exists falls back to the
 * membership's base role. `worker` is `member` under its older name.
 */
export function holdersByColumn(
  members: readonly MatrixMember[],
  customRoles: readonly MatrixRole[],
): Map<ColumnKey, MatrixMember[]> {
  const byName = new Map(customRoles.map((r) => [r.name, r.id]));
  const out = new Map<ColumnKey, MatrixMember[]>();
  for (const member of members) {
    const customId = member.displayRole ? byName.get(member.displayRole) : undefined;
    const key: ColumnKey =
      customId !== undefined
        ? `custom:${customId}`
        : ((member.role === "worker" ? "member" : member.role) as ColumnKey);
    const list = out.get(key) ?? [];
    list.push(member);
    out.set(key, list);
  }
  return out;
}

/** Holders whose own flags no longer match the role's. */
export function driftedHolders(
  holders: readonly MatrixMember[],
  flags: MemberPermissionFlags,
): MatrixMember[] {
  return holders.filter((m) => !sameFlags(pickPermissionFlags(m), flags));
}

const FIELD =
  "rounded-[6px] border border-transparent bg-fg-primary/5 text-settings-body text-fg-primary outline-none transition-colors placeholder:text-fg-quaternary focus:border-accent-primary/50 focus:bg-transparent";

const BUTTON =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-[13px] text-settings-small font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Roles & permissions as one matrix: roles across, permissions down, so any
 * two roles compare at a glance. The selected column is edited in place and
 * described in the panel beside it — who holds it, and who has drifted from it.
 */
export function RoleMatrix({
  organizationId,
  customRoles,
  members,
  canManage,
  callerFlags,
  currentUserId,
}: {
  organizationId: number;
  customRoles: readonly MatrixRole[];
  members: readonly MatrixMember[];
  /** Admin holding `canManageRoles` — the server's rule for every write here. */
  canManage: boolean;
  callerFlags: MemberPermissionFlags;
  currentUserId: string | undefined;
}) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.workspace");
  const label = usePermissionLabel();
  const toast = useToast();
  const save = useSettingsSave();
  const utils = api.useUtils();

  const [selected, setSelected] = useState<ColumnKey>("admin");
  const [draft, setDraft] = useState<{ name: string; flags: MemberPermissionFlags } | null>(null);
  const [filter, setFilter] = useState("");
  const [nudge, setNudge] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string; holders: number } | null>(null);
  const [reapplying, setReapplying] = useState(false);

  const createRole = api.organization.createRole.useMutation();
  const updateRole = api.organization.updateRole.useMutation();
  const deleteRole = api.organization.deleteRole.useMutation();
  const updateMemberRole = api.organization.updateMemberRole.useMutation();

  // ---- Columns ------------------------------------------------------------
  const columns: Column[] = [
    ...TEMPLATE_ROLE_ORDER.map((role) => ({
      key: role,
      name: t(`roles.${role}`),
      kind: "template" as const,
      flags: ROLE_TEMPLATES[role],
    })),
    ...customRoles.map((role) => ({
      key: `custom:${role.id}` as const,
      name: role.name,
      kind: "custom" as const,
      roleId: role.id,
      flags: pickPermissionFlags(role),
    })),
  ];
  if (selected === "new" && draft) {
    columns.push({ key: "new", name: draft.name.trim() || t("roles.newRole"), kind: "new", flags: draft.flags });
  }

  // A role deleted elsewhere drops the selection back to the first template.
  const active = columns.find((c) => c.key === selected) ?? columns[0]!;
  const editable = canManage && active.kind !== "template" && draft !== null;
  const shownFlags = (col: Column) => (col.key === active.key && editable ? draft.flags : col.flags);

  const dirty =
    active.kind === "new" ||
    (active.kind === "custom" &&
      draft !== null &&
      (draft.name.trim() !== active.name || !sameFlags(draft.flags, active.flags)));

  const holders = holdersByColumn(members, customRoles);
  const activeHolders = holders.get(active.key) ?? [];
  // Your own membership is left out: the server refuses to re-role you.
  const drifted = driftedHolders(activeHolders, active.flags).filter((m) => m.id !== currentUserId);

  const lockedKeys = PERMISSION_FLAG_KEYS.filter((k) => !callerFlags[k]);

  // ---- Selection ----------------------------------------------------------
  /** Selects a column unless that would throw away unsaved edits. */
  const select = (col: Column): boolean => {
    if (col.key === active.key) return true;
    if (dirty) {
      setNudge(true);
      return false;
    }
    setNudge(false);
    setSelected(col.key);
    setDraft(col.kind === "custom" && canManage ? { name: col.name, flags: { ...col.flags } } : null);
    return true;
  };

  const startNew = (from?: Column) => {
    if (dirty) {
      setNudge(true);
      return;
    }
    setNudge(false);
    setSelected("new");
    setDraft({
      name: from ? t("roles.copyName", { name: from.name }) : "",
      flags: from ? { ...from.flags } : pickPermissionFlags({}),
    });
  };

  const discard = () => {
    setNudge(false);
    if (active.kind === "new") {
      setSelected("admin");
      setDraft(null);
    } else {
      setDraft({ name: active.name, flags: { ...active.flags } });
    }
  };

  const toggle = (col: Column, flag: PermissionFlag) => {
    if (!canManage || col.kind === "template" || lockedKeys.includes(flag)) return;
    if (col.key !== active.key) {
      if (!select(col)) return;
      // `select` just seeded the draft from the saved flags.
      setDraft({ name: col.name, flags: { ...col.flags, [flag]: !col.flags[flag] } });
      return;
    }
    if (!draft) return;
    setDraft({ ...draft, flags: { ...draft.flags, [flag]: !draft.flags[flag] } });
  };

  // ---- Writes -------------------------------------------------------------
  const pending = createRole.isPending || updateRole.isPending;

  const submit = async () => {
    if (!draft?.name.trim() || pending) return;
    await save.run(async () => {
      try {
        if (active.kind === "new") {
          const role = await createRole.mutateAsync({
            organizationId,
            name: draft.name,
            ...draft.flags,
          });
          toast.success(t("messages.roleCreated"));
          await utils.organization.getRoles.invalidate();
          if (role) {
            setSelected(`custom:${role.id}`);
            setDraft({ name: role.name, flags: pickPermissionFlags(role) });
          }
        } else if (active.roleId !== undefined) {
          await updateRole.mutateAsync({
            organizationId,
            roleId: active.roleId,
            name: draft.name,
            permissions: draft.flags,
          });
          toast.success(t("messages.roleUpdatedSaved"));
          // A rename moves the label on every holder, so both lists change.
          await Promise.all([
            utils.organization.getRoles.invalidate(),
            utils.organization.getMembers.invalidate(),
          ]);
          setDraft({ name: draft.name.trim(), flags: { ...draft.flags } });
        }
        setNudge(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("messages.roleCreateFailed"));
        throw e;
      }
    });
  };

  /**
   * Stamps the role's current flags back onto everyone who drifted, one
   * `updateMemberRole` at a time — the same write as picking the role from
   * their row, so it is held to the same checks.
   */
  const reapply = async () => {
    if (!drifted.length || reapplying) return;
    setReapplying(true);
    await save.run(async () => {
      try {
        for (const member of drifted) {
          await updateMemberRole.mutateAsync(
            active.roleId !== undefined
              ? { organizationId, userId: member.id, customRoleId: active.roleId }
              : { organizationId, userId: member.id, role: active.key as TemplateRole },
          );
        }
        toast.success(t("roles.reapplied", { count: drifted.length }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("roles.reapplyFailed"));
        throw e;
      } finally {
        await utils.organization.getMembers.invalidate();
        setReapplying(false);
      }
    });
  };

  // ---- Rows ---------------------------------------------------------------
  const query = filter.trim().toLowerCase();
  const groups = PERMISSION_GROUPS.map((g) => ({
    ...g,
    flags: g.flags.filter((f) => !query || label(f).toLowerCase().includes(query)),
  })).filter((g) => g.flags.length > 0);

  const grantedCount = PERMISSION_FLAG_KEYS.filter((k) => shownFlags(active)[k]).length;

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      {/* ---- Matrix ---- */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[160px] flex-1">
            <Search
              size={13}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
            />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("roles.filterPermissions")}
              aria-label={t("roles.filterPermissions")}
              className={`${FIELD} h-8 w-full pl-8 pr-2.5`}
            />
          </label>
          {canManage ? (
            <button
              type="button"
              onClick={() => startNew()}
              disabled={active.kind === "new"}
              className={`${BUTTON} bg-fg-primary/5 text-fg-primary hover:bg-fg-primary/10`}
            >
              <Plus size={13} aria-hidden />
              {t("roles.newRole")}
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border-light bg-bg-elevated">
          <table className="w-full border-collapse text-settings-small">
            <caption className="sr-only">{t("roles.title")}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-[1] min-w-[150px] bg-bg-elevated px-3 py-2.5 text-left text-settings-eyebrow font-medium uppercase tracking-[0.1em] text-fg-tertiary"
                >
                  {t("roles.permissionColumn")}
                </th>
                {columns.map((col) => {
                  const isActive = col.key === active.key;
                  const colHolders = holders.get(col.key) ?? [];
                  const colDrift = driftedHolders(colHolders, col.flags).filter(
                    (m) => m.id !== currentUserId,
                  ).length;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-current={isActive ? "true" : undefined}
                      className={`min-w-[92px] px-1 py-1.5 align-bottom ${isActive ? "bg-accent-primary/[0.07]" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => select(col)}
                        className="flex w-full cursor-pointer flex-col items-center gap-1 rounded-[6px] px-1.5 py-1 transition-colors hover:bg-fg-primary/5"
                      >
                        <span
                          className={`kairos-break-anywhere flex items-center gap-1 text-settings-small font-medium ${
                            isActive ? "text-accent-primary" : "text-fg-primary"
                          }`}
                        >
                          {col.kind === "template" ? (
                            <Lock size={10} aria-label={t("roles.template")} className="flex-none text-fg-quaternary" />
                          ) : null}
                          {col.name}
                        </span>
                        <span
                          className={`rounded-sm px-1.5 py-px text-settings-eyebrow ${
                            colDrift
                              ? "bg-warning/15 text-warning"
                              : "bg-fg-primary/5 text-fg-tertiary"
                          }`}
                        >
                          {colDrift
                            ? t("roles.holdersDrifted", { count: colHolders.length, drifted: colDrift })
                            : t("roles.holders", { count: colHolders.length })}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <GroupRows
                  key={group.key}
                  title={t(`roles.${group.key}`)}
                  span={columns.length + 1}
                >
                  {group.flags.map((flag) => {
                    const locked = lockedKeys.includes(flag);
                    return (
                      <tr key={flag} className="border-t border-border-light">
                        <th
                          scope="row"
                          className="sticky left-0 z-[1] bg-bg-elevated px-3 py-2 text-left font-normal text-fg-secondary"
                        >
                          <span className="flex items-center gap-1.5">
                            {label(flag)}
                            {RISKY_FLAGS.has(flag) ? (
                              <span title={t("roles.riskyHint")} className="inline-flex flex-none">
                                <AlertCircle
                                  size={12}
                                  aria-label={t("roles.riskyHint")}
                                  className="text-warning"
                                />
                              </span>
                            ) : null}
                          </span>
                        </th>
                        {columns.map((col) => {
                          const on = shownFlags(col)[flag];
                          const isActive = col.key === active.key;
                          const changed =
                            isActive && editable && on !== col.flags[flag] && col.kind === "custom";
                          const canToggle = canManage && col.kind !== "template" && !locked;
                          return (
                            <td
                              key={col.key}
                              className={`px-1 py-1.5 text-center ${isActive ? "bg-accent-primary/[0.07]" : ""}`}
                            >
                              <CellMark
                                on={on}
                                changed={changed}
                                interactive={canToggle}
                                locked={canManage && col.kind !== "template" && locked}
                                label={`${col.name}: ${label(flag)}`}
                                lockedHint={t("inviteBuilder.lockedHint")}
                                onToggle={() => toggle(col, flag)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </GroupRows>
              ))}
              {groups.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="px-3 py-6 text-center text-settings-meta text-fg-tertiary"
                  >
                    {t("roles.noPermissionMatch")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-settings-micro text-fg-tertiary">
          <span className="inline-flex items-center gap-1">
            <Lock size={10} aria-hidden /> {t("roles.legendTemplate")}
          </span>
          <span className="inline-flex items-center gap-1">
            <AlertCircle size={11} aria-hidden className="text-warning" /> {t("roles.riskyHint")}
          </span>
        </p>
      </div>

      {/* ---- Selected role ---- */}
      <aside
        aria-label={active.name}
        className="flex w-full flex-col gap-4 rounded-lg border border-border-light bg-bg-elevated p-4 xl:sticky xl:top-28 xl:w-[270px] xl:flex-none"
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            {editable ? (
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  if (e.key === "Escape") discard();
                }}
                placeholder={t("roles.namePlaceholder")}
                aria-label={t("roles.namePlaceholder")}
                maxLength={100}
                autoFocus={active.kind === "new"}
                className={`${FIELD} h-8 min-w-0 flex-1 px-2.5 font-medium`}
              />
            ) : (
              <span className="kairos-break-anywhere text-settings-row font-medium text-fg-primary">
                {active.name}
              </span>
            )}
            <span
              className={`flex-none rounded-sm px-2 py-0.5 text-settings-eyebrow font-medium ${
                active.kind === "template"
                  ? "bg-bg-tertiary text-fg-tertiary"
                  : "bg-accent-primary/10 text-accent-primary"
              }`}
            >
              {active.kind === "template" ? t("roles.template") : t("roles.custom")}
            </span>
          </div>
          <span className="text-settings-meta text-fg-tertiary">
            {grantedCount === 0
              ? t("roles.viewOnly")
              : t("roles.grantedCount", { count: grantedCount, total: PERMISSION_FLAG_KEYS.length })}
          </span>
        </div>

        {active.kind !== "new" ? (
          <div className="flex flex-col gap-2">
            <span className="text-settings-eyebrow font-medium uppercase tracking-[0.1em] text-fg-tertiary">
              {t("roles.heldBy")}
            </span>
            {activeHolders.length ? (
              <HolderStack holders={activeHolders} />
            ) : (
              <span className="text-settings-meta text-fg-quaternary">{t("roles.noHolders")}</span>
            )}
          </div>
        ) : null}

        {drifted.length && canManage && active.kind !== "new" ? (
          <div className="flex flex-col gap-2 rounded-md bg-warning/10 p-3 text-settings-meta text-warning">
            <span>
              {t("roles.driftBody", {
                count: drifted.length,
                names: drifted
                  .slice(0, 3)
                  .map((m) => m.name ?? m.email)
                  .join(", "),
              })}
            </span>
            <button
              type="button"
              onClick={() => void reapply()}
              disabled={reapplying || dirty}
              title={dirty ? t("roles.saveFirst") : undefined}
              className={`${BUTTON} self-start border border-warning/40 text-warning hover:bg-warning/10`}
            >
              {reapplying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} aria-hidden />}
              {t("roles.reapply")}
            </button>
          </div>
        ) : null}

        {dirty && active.kind === "custom" && activeHolders.length ? (
          <p className="m-0 text-settings-micro text-fg-tertiary">{t("roles.editNote")}</p>
        ) : null}

        {nudge && dirty ? (
          <p role="status" className="m-0 text-settings-micro font-medium text-warning">
            {t("roles.saveFirst")}
          </p>
        ) : null}

        {canManage ? (
          <div className="flex flex-col gap-2 border-t border-border-light pt-3">
            {active.kind !== "template" ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!dirty || !draft?.name.trim() || pending}
                  className={`${BUTTON} flex-1 bg-accent-primary text-white hover:bg-accent-primary/90`}
                >
                  {pending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : active.kind === "new" ? (
                    t("roles.createRole")
                  ) : (
                    t("roles.saveRole")
                  )}
                </button>
                {dirty ? (
                  <button
                    type="button"
                    onClick={discard}
                    className={`${BUTTON} bg-fg-primary/5 text-fg-primary hover:bg-fg-primary/10`}
                  >
                    {active.kind === "new" ? t("common.cancel") : t("roles.discard")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {active.kind !== "new" ? (
              <button
                type="button"
                onClick={() => startNew(active)}
                className={`${BUTTON} bg-fg-primary/5 text-fg-primary hover:bg-fg-primary/10`}
              >
                <Copy size={13} aria-hidden />
                {t("roles.duplicate")}
              </button>
            ) : null}
            {active.kind === "custom" && active.roleId !== undefined ? (
              <button
                type="button"
                onClick={() =>
                  setDeleteTarget({ id: active.roleId!, name: active.name, holders: activeHolders.length })
                }
                className={`${BUTTON} text-error hover:bg-error/10`}
              >
                <Trash2 size={13} aria-hidden />
                {t("roles.delete")}
              </button>
            ) : null}
          </div>
        ) : null}
      </aside>

      {deleteTarget ? (
        <ConfirmDialog
          destructive
          title={t("roles.deleteConfirm", { name: deleteTarget.name })}
          message={t("roles.deleteBody", { count: deleteTarget.holders })}
          confirmLabel={deleteRole.isPending ? t("common.working") : t("roles.delete")}
          cancelLabel={t("common.cancel")}
          isPending={deleteRole.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const roleId = deleteTarget.id;
            setDeleteTarget(null);
            void save.run(async () => {
              try {
                await deleteRole.mutateAsync({ organizationId, roleId });
                toast.success(t("messages.roleDeleted"));
                setSelected("admin");
                setDraft(null);
                await utils.organization.getRoles.invalidate();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t("messages.roleCreateFailed"));
                throw e;
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}

function GroupRows({
  title,
  span,
  children,
}: {
  title: string;
  span: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="border-t border-border-light">
        <th
          scope="colgroup"
          colSpan={span}
          className="sticky left-0 bg-bg-elevated px-3 pb-1 pt-3 text-left text-settings-eyebrow font-medium uppercase tracking-[0.1em] text-fg-quaternary"
        >
          {title}
        </th>
      </tr>
      {children}
    </>
  );
}

function CellMark({
  on,
  changed,
  interactive,
  locked,
  label,
  lockedHint,
  onToggle,
}: {
  on: boolean;
  changed: boolean;
  interactive: boolean;
  locked: boolean;
  label: string;
  lockedHint: string;
  onToggle: () => void;
}) {
  const box = (
    <span
      className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition ${
        on
          ? "border-accent-primary/50 bg-accent-primary/20 text-accent-primary"
          : "border-border-medium bg-transparent"
      } ${changed ? "ring-2 ring-warning/50 ring-offset-1 ring-offset-bg-elevated" : ""}`}
    >
      {on ? <Check size={11} /> : null}
    </span>
  );

  if (!interactive) {
    return (
      <span
        role="img"
        aria-label={`${label}: ${on ? "✓" : "—"}`}
        title={locked ? lockedHint : undefined}
        className={`inline-flex ${locked ? "cursor-not-allowed opacity-50" : ""}`}
      >
        {box}
      </span>
    );
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className="inline-flex cursor-pointer rounded-[5px] p-1 transition hover:bg-fg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
    >
      {box}
    </button>
  );
}

function HolderStack({ holders }: { holders: readonly MatrixMember[] }) {
  const shown = holders.slice(0, 6);
  const rest = holders.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((m) => {
        const name = m.name ?? m.email;
        return (
          <ProfileLink key={m.id} userId={m.id} name={name} className="flex-none">
            {m.image ? (
              <Image
                src={m.image}
                alt={name}
                title={name}
                width={26}
                height={26}
                unoptimized
                className="h-[26px] w-[26px] rounded-full object-cover"
              />
            ) : (
              <span
                title={name}
                style={avatarGradientStyle(m.email)}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-settings-eyebrow font-semibold text-white"
              >
                {name[0]?.toUpperCase() ?? "?"}
              </span>
            )}
          </ProfileLink>
        );
      })}
      {rest > 0 ? (
        <span className="flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-fg-primary/5 px-1.5 text-settings-eyebrow font-medium text-fg-tertiary">
          +{rest}
        </span>
      ) : null}
    </div>
  );
}
