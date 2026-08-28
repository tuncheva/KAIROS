"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check, Loader2, QrCode, Trash2, X } from "~/components/ui/icons";
import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { useSocketEvent } from "~/hooks/useSocketEvent";
import { useSwitchOrganization } from "~/hooks/useSwitchOrganization";
import { InviteQrDialog } from "~/components/orgs/InviteQrDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { useTranslations } from "next-intl";
import Image from "next/image";

import { avatarGradientStyle } from "~/lib/avatarGradient";
import { ProfileLink } from "~/components/profile/ProfileLink";

import {
  LedgerAction,
  LedgerGroup,
  LedgerInput,
  LedgerSection,
  LedgerSelect,
  LedgerValue,
  useSectionCrumb,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

// ---------------------------------------------------------------------------
// Permission labels
// ---------------------------------------------------------------------------
const PERMISSION_KEYS = [
  "canCreateProjects",
  "canEditProjects",
  "canAssignTasks",
  "canDeleteTasks",
  "canAddMembers",
  "canKickMembers",
  "canManageRoles",
  "canViewAnalytics",
] as const;

type PermissionKey = (typeof PERMISSION_KEYS)[number];

const PERMISSION_LABEL_KEYS: Record<PermissionKey, string> = {
  canCreateProjects: "createProjects",
  canEditProjects: "editProjects",
  canAssignTasks: "assignTasks",
  canDeleteTasks: "deleteTasks",
  canAddMembers: "inviteMembers",
  canKickMembers: "removeMembers",
  canManageRoles: "manageRoles",
  canViewAnalytics: "viewAnalytics",
};

// ---------------------------------------------------------------------------
// Template role defaults (shown in the roles group as read-only templates)
// ---------------------------------------------------------------------------
const TEMPLATE_ROLES: Record<string, Record<PermissionKey, boolean>> = {
  Admin: {
    canCreateProjects: true,
    canEditProjects: true,
    canAssignTasks: true,
    canDeleteTasks: true,
    canAddMembers: true,
    canKickMembers: true,
    canManageRoles: true,
    canViewAnalytics: true,
  },
  Member: {
    canCreateProjects: true,
    canEditProjects: true,
    canAssignTasks: true,
    canDeleteTasks: false,
    canAddMembers: false,
    canKickMembers: false,
    canManageRoles: false,
    canViewAnalytics: true,
  },
  Guest: {
    canCreateProjects: false,
    canEditProjects: false,
    canAssignTasks: false,
    canDeleteTasks: false,
    canAddMembers: false,
    canKickMembers: false,
    canManageRoles: false,
    canViewAnalytics: false,
  },
};

/** A permission tick, read-only. Used by both template and custom role cards. */
function PermissionGrid({
  perms,
  t,
}: {
  perms: Record<PermissionKey, boolean>;
  t: Translator;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PERMISSION_KEYS.map((key) => (
        <span key={key} className="flex items-center gap-2 text-xs text-fg-secondary">
          <span
            className={`flex h-4 w-4 items-center justify-center rounded border ${
              perms[key]
                ? "border-accent-primary/50 bg-accent-primary/20"
                : "border-border-light bg-bg-tertiary"
            }`}
          >
            {perms[key] ? <Check size={10} className="text-accent-primary" /> : null}
          </span>
          {t(`permissions.${PERMISSION_LABEL_KEYS[key]}`)}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function WorkspaceSettingsClient() {
  const toast = useToast();
  const utils = api.useUtils();
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings.workspace");
  const tOrg = useT("org");
  const crumb = useSectionCrumb("workspace");
  const save = useSettingsSave();

  // ---- Organization state ----
  const [orgName, setOrgName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  // ---- Invite state ----
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [bulkInviteInput, setBulkInviteInput] = useState("");
  const [inviteQrForOrgId, setInviteQrForOrgId] = useState<number | null>(null);

  // ---- Leave-organization confirmation ----
  // The org being left, plus the last failure for it: leaving can be refused
  // (sole admin), and that reason has to survive long enough to be read.
  const [leaveTarget, setLeaveTarget] = useState<{ id: number; name: string } | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // ---- Delete-organization confirmation ----
  /*
   * Two gates, not one. `step` is which of them is on screen: "warn" spells out
   * what is about to be destroyed and for whom, and "type" asks for the
   * workspace name back before the button will fire. Deleting a workspace takes
   * every project, task and thread in it away from everybody, and there is no
   * undo — a single "are you sure?" is the same click the user has already
   * learned to dismiss.
   */
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
    step: "warn" | "type";
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [emailLookupDebouncedEmail, setEmailLookupDebouncedEmail] = useState("");

  // ---- Custom role creation state ----
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRolePerms, setNewRolePerms] = useState<Record<PermissionKey, boolean>>(
    Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false])) as Record<
      PermissionKey,
      boolean
    >,
  );
  const [pendingRoles, setPendingRoles] = useState<
    Array<{ id: number; name: string } & Record<PermissionKey, boolean>>
  >([]);

  // ---- Email lookup debounce ----
  const inviteEmailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (inviteEmailTimerRef.current) clearTimeout(inviteEmailTimerRef.current);
    const trimmed = inviteEmail.trim();
    if (trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      inviteEmailTimerRef.current = setTimeout(
        () => setEmailLookupDebouncedEmail(trimmed),
        400,
      );
    } else {
      setEmailLookupDebouncedEmail("");
    }
    return () => {
      if (inviteEmailTimerRef.current) clearTimeout(inviteEmailTimerRef.current);
    };
  }, [inviteEmail]);

  // A join link drops people here with the code already in the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("joinCode");
    if (!code) return;
    setJoinCode(code);
  }, []);

  // ---- Queries ----
  const { data: profile } = api.user.getProfile.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { data: myOrgs } = api.organization.listMine.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { data: activeOrg } = api.organization.getActive.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const activeOrgId = activeOrg?.organization?.id;

  const { data: members } = api.organization.getMembers.useQuery(
    { organizationId: activeOrgId! },
    { enabled: !!activeOrgId, retry: false, refetchOnWindowFocus: false },
  );
  const { data: roles } = api.organization.getRoles.useQuery(
    { organizationId: activeOrgId! },
    { enabled: !!activeOrgId, retry: false, refetchOnWindowFocus: false },
  );
  const { data: invites } = api.organization.getInvites.useQuery(
    { organizationId: activeOrgId! },
    {
      enabled: !!activeOrgId && activeOrg?.role === "admin",
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const { data: inviteHistory } = api.organization.getInviteHistory.useQuery(
    { organizationId: activeOrgId! },
    {
      enabled: !!activeOrgId && activeOrg?.role === "admin",
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const { data: inviteCandidates } =
    api.organization.getProjectInviteCandidates.useQuery(
      { organizationId: activeOrgId! },
      {
        enabled: !!activeOrgId && activeOrg?.role === "admin",
        retry: false,
        refetchOnWindowFocus: false,
      },
    );
  const { data: inviteEmailLookup, isFetching: isLookingUpEmail } =
    api.user.searchByEmail.useQuery(
      { email: emailLookupDebouncedEmail },
      { enabled: !!emailLookupDebouncedEmail, retry: false, refetchOnWindowFocus: false },
    );

  // ---- Clean up pendingRoles once they're fetched from server ----
  useEffect(() => {
    if (roles && pendingRoles.length > 0) {
      const allPendingExistInRoles = pendingRoles.every((pr) =>
        roles.some((r) => r.id === pr.id),
      );
      if (allPendingExistInRoles) setPendingRoles([]);
    }
  }, [roles, pendingRoles]);

  // Real-time: refresh members and invites when notifications about invites/joins arrive
  const handleInviteNotification = useCallback(
    (data: { title?: string }) => {
      const title = data.title?.toLowerCase() ?? "";
      if (
        title.includes("invite") ||
        title.includes("joined") ||
        title.includes("member")
      ) {
        void utils.organization.getInvites.invalidate();
        void utils.organization.getInviteHistory.invalidate();
        void utils.organization.getMembers.invalidate();
        void utils.organization.getProjectInviteCandidates.invalidate();
      }
    },
    [
      utils.organization.getInvites,
      utils.organization.getInviteHistory,
      utils.organization.getMembers,
      utils.organization.getProjectInviteCandidates,
    ],
  );
  useSocketEvent("notification:new", handleInviteNotification);

  // ---- Mutations ----
  const createOrg = api.organization.create.useMutation({
    onSuccess: () => {
      toast.success(t("messages.organizationCreated"));
      setOrgName("");
      void utils.organization.listMine.invalidate();
      void utils.organization.getActive.invalidate();
      void utils.user.getProfile.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const joinOrg = api.organization.join.useMutation({
    onSuccess: (data) => {
      toast.success(t("messages.organizationJoined", { name: data.organizationName }));
      setJoinCode("");
      void utils.organization.listMine.invalidate();
      void utils.organization.getActive.invalidate();
      void utils.user.getProfile.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setActiveOrg = useSwitchOrganization({
    onSwitched: () => toast.success(t("messages.organizationSwitched")),
    onError: (message) => toast.error(message),
  });

  const leaveOrg = api.organization.leave.useMutation({
    // Awaited, not fired and forgotten: the row must be gone from the list
    // before the dialog closes, or leaving looks like it did nothing.
    onSuccess: async () => {
      toast.success(t("messages.organizationLeft"));
      await Promise.all([
        utils.organization.listMine.invalidate(),
        utils.organization.getActive.invalidate(),
        utils.user.getProfile.invalidate(),
      ]);
      setLeaveTarget(null);
      setLeaveError(null);
    },
    onError: (e) => {
      setLeaveError(e.message);
      toast.error(e.message);
    },
  });

  const deleteOrg = api.organization.delete.useMutation({
    // Awaited for the same reason as `leave`: the row has to be gone before the
    // dialog closes, or the deletion looks like it did nothing.
    onSuccess: async (data) => {
      toast.success(t("messages.organizationDeleted", { name: data.name }));
      await Promise.all([
        utils.organization.listMine.invalidate(),
        utils.organization.getActive.invalidate(),
        utils.user.getProfile.invalidate(),
      ]);
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (e) => {
      setDeleteError(e.message);
      toast.error(e.message);
    },
  });

  const updateMemberRole = api.organization.updateMemberRole.useMutation({
    onSuccess: () => {
      toast.success(t("messages.roleUpdated"));
      void utils.organization.getMembers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMember = api.organization.removeMember.useMutation({
    onSuccess: () => {
      toast.success(t("messages.memberRemoved"));
      void utils.organization.getMembers.invalidate();
      void utils.organization.getProjectInviteCandidates.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const inviteMember = api.organization.inviteMember.useMutation({
    onSuccess: () => {
      toast.success(t("messages.inviteSent"));
      setInviteEmail("");
      void utils.organization.getInvites.invalidate();
      void utils.organization.getInviteHistory.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const parseBulkEmails = (input: string): string[] => {
    const normalized = input.replace(/\r\n/g, "\n");
    const csvRows = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(",").map((cell) => cell.trim()));
    const maybeHeader = csvRows[0]?.[0]?.toLowerCase();
    const csvEmails = csvRows
      .slice(maybeHeader === "email" ? 1 : 0)
      .map((row) => row[0] ?? "")
      .filter(Boolean);
    const parts = input
      .split(/[\n,;]/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    const unique = Array.from(new Set([...parts, ...csvEmails]));
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return unique.filter((v) => emailRegex.test(v));
  };

  const cancelInvite = api.organization.cancelInvite.useMutation({
    onSuccess: () => {
      toast.success(t("messages.inviteCancelled"));
      void utils.organization.getInvites.invalidate();
      void utils.organization.getInviteHistory.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const createRole = api.organization.createRole.useMutation();

  const deleteRole = api.organization.deleteRole.useMutation({
    onSuccess: () => {
      toast.success(t("messages.roleDeleted"));
      void utils.organization.getRoles.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ---- Helpers ----
  const isAdmin = activeOrg?.role === "admin";
  const isPersonal = profile?.usageMode === "personal";

  const translateRoleLabel = (role: string | null | undefined) => {
    if (!role) return "";
    const normalized = role.toLowerCase();
    if (normalized === "admin" || normalized === "member" || normalized === "guest") {
      return t(`roles.${normalized}`);
    }
    return role;
  };
  const translateInviteStatus = (status: string | null | undefined) => {
    if (!status) return "";
    const normalized = status.toLowerCase();
    if (
      normalized === "pending" ||
      normalized === "accepted" ||
      normalized === "declined" ||
      normalized === "expired" ||
      normalized === "cancelled"
    ) {
      return t(`members.status.${normalized}`);
    }
    return status;
  };

  /** Both selects offer the three built-ins and then this workspace's own roles. */
  const roleOptions = [
    { value: "admin", label: t("roles.admin") },
    { value: "member", label: t("roles.member") },
    { value: "guest", label: t("roles.guest") },
    ...(roles?.length ? [{ value: "__sep", label: "──────────", disabled: true }] : []),
    ...(roles ?? []).map((role) => ({ value: role.name, label: role.name })),
  ];

  // ---- Organizations ------------------------------------------------------
  const orgRows: LedgerRow[] = (myOrgs ?? []).map((org) => ({
    id: `org-${org.id}`,
    title: org.name,
    // "Active" belongs in the control column beside Switch, not repeated here.
    desc: translateRoleLabel(org.role),
    control: (
      <>
        {activeOrgId === org.id ? <LedgerValue tone="good">{t("organizations.active")}</LedgerValue> : null}
        {/* Only members who may add people get an invite control, and what it
            opens is a token that expires — not the workspace's permanent access
            code. */}
        {org.canInvite ? (
          <LedgerAction
            title={tOrg("inviteWithQr")}
            onClick={() => setInviteQrForOrgId(org.id)}
          >
            <span className="flex items-center gap-1.5">
              <QrCode size={13} />
              {tOrg("inviteWithQr")}
            </span>
          </LedgerAction>
        ) : null}
        {activeOrgId !== org.id ? (
          <LedgerAction
            disabled={setActiveOrg.isPending}
            onClick={() => setActiveOrg.mutate({ organizationId: org.id })}
          >
            {t("organizations.switch")}
          </LedgerAction>
        ) : null}
        <LedgerAction
          danger
          disabled={leaveOrg.isPending}
          onClick={() => {
            setLeaveError(null);
            setLeaveTarget({ id: org.id, name: org.name });
          }}
        >
          {t("organizations.leave")}
        </LedgerAction>
        {/* Only the creator can delete, so only the creator is shown the
            control — an admin who would be refused by the server has no
            business being offered the button. */}
        {org.isOwner ? (
          <LedgerAction
            danger
            disabled={deleteOrg.isPending}
            onClick={() => {
              setDeleteError(null);
              setDeleteTarget({ id: org.id, name: org.name, step: "warn" });
            }}
          >
            {t("organizations.delete")}
          </LedgerAction>
        ) : null}
      </>
    ),
  }));

  orgRows.push(
    {
      id: "createOrg",
      title: t("organizations.create"),
      control: (
        <>
          <LedgerInput
            value={orgName}
            onChange={setOrgName}
            ariaLabel={t("organizations.create")}
            placeholder={t("organizations.namePlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && orgName.trim()) {
                void save.run(() => createOrg.mutateAsync({ name: orgName }));
              }
            }}
          />
          <LedgerAction
            disabled={!orgName.trim() || createOrg.isPending}
            onClick={() => void save.run(() => createOrg.mutateAsync({ name: orgName }))}
          >
            {createOrg.isPending ? "…" : t("common.create")}
          </LedgerAction>
        </>
      ),
    },
    {
      id: "joinOrg",
      title: t("organizations.join"),
      control: (
        <>
          <LedgerInput
            mono
            value={joinCode}
            onChange={setJoinCode}
            ariaLabel={t("organizations.join")}
            placeholder={t("organizations.accessCodePlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && joinCode.trim()) {
                void save.run(() => joinOrg.mutateAsync({ code: joinCode }));
              }
            }}
          />
          <LedgerAction
            disabled={!joinCode.trim() || joinOrg.isPending}
            onClick={() => void save.run(() => joinOrg.mutateAsync({ code: joinCode }))}
          >
            {joinOrg.isPending ? "…" : t("common.join")}
          </LedgerAction>
        </>
      ),
    },
  );

  // ---- Members ------------------------------------------------------------
  const lookupNote = !emailLookupDebouncedEmail
    ? undefined
    : isLookingUpEmail
      ? t("members.lookingUpEmail")
      : inviteEmailLookup
        ? `${inviteEmailLookup.name ?? t("members.noName")} · ${inviteEmailLookup.email}`
        : t("members.noExistingAccount");

  const sendInvite = (email: string) => {
    if (!email.trim() || !activeOrgId) return;
    void save.run(() =>
      inviteMember.mutateAsync({
        organizationId: activeOrgId,
        email,
        role: inviteRole,
      }),
    );
  };

  const memberRows: LedgerRow[] = [];

  if (isAdmin) {
    memberRows.push({
      id: "invite",
      title: t("members.inviteMember"),
      desc: lookupNote,
      descText: "",
      control: (
        <>
          <LedgerInput
            type="email"
            inputMode="email"
            value={inviteEmail}
            onChange={setInviteEmail}
            ariaLabel={t("members.inviteMember")}
            placeholder={t("members.emailPlaceholder")}
            width="w-[240px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") sendInvite(inviteEmail);
            }}
          />
          <LedgerSelect
            width="w-[120px]"
            value={inviteRole}
            ariaLabel={t("members.invite")}
            options={roleOptions}
            onChange={setInviteRole}
          />
          <LedgerAction
            disabled={!inviteEmail.trim() || inviteMember.isPending}
            onClick={() => sendInvite(inviteEmail)}
          >
            {inviteMember.isPending ? "…" : t("members.invite")}
          </LedgerAction>
        </>
      ),
    });

    memberRows.push({
      id: "bulkInvite",
      title: t("members.bulkInviteLabel"),
      desc: t("members.bulkInviteHint"),
      control: (
        <>
          <textarea
            value={bulkInviteInput}
            onChange={(e) => setBulkInviteInput(e.target.value)}
            aria-label={t("members.bulkInviteLabel")}
            placeholder={t("members.bulkInvitePlaceholder")}
            className="min-h-[64px] w-full max-w-[420px] resize-y rounded-[10px] border border-border-medium bg-bg-secondary px-2.5 py-1.5 text-[13.5px] text-fg-primary outline-none transition-colors placeholder:text-fg-quaternary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30"
          />
          <LedgerAction
            disabled={inviteMember.isPending || !bulkInviteInput.trim()}
            onClick={async () => {
              if (!activeOrgId || inviteMember.isPending) return;
              const emails = parseBulkEmails(bulkInviteInput);
              if (emails.length === 0) {
                toast.error(t("members.bulkInviteNoValidEmails"));
                return;
              }

              await save.run(async () => {
                let sent = 0;
                let failed = 0;
                for (const email of emails) {
                  try {
                    await inviteMember.mutateAsync({
                      organizationId: activeOrgId,
                      email,
                      role: inviteRole,
                    });
                    sent += 1;
                  } catch {
                    failed += 1;
                  }
                }

                if (sent > 0) {
                  setBulkInviteInput("");
                  void utils.organization.getInvites.invalidate();
                  toast.success(t("members.bulkInviteSent", { count: sent }));
                  if (failed > 0) {
                    toast.error(t("members.bulkInvitePartial", { count: failed }));
                  }
                } else {
                  toast.error(t("members.bulkInviteFailed"));
                  throw new Error("bulk invite failed");
                }
              });
            }}
          >
            {inviteMember.isPending ? "…" : t("members.bulkInviteAction")}
          </LedgerAction>
        </>
      ),
    });
  }

  for (const member of members ?? []) {
    memberRows.push({
      id: `member-${member.id}`,
      title: member.name ?? member.email,
      desc: member.email,
      // `member.id` is the *user* id — `getMembers` selects `users.id`, not the
      // membership row — so it is the right thing to hand the profile drawer.
      leading: (
        <ProfileLink
          userId={member.id}
          name={member.name ?? member.email}
          className="flex-none"
        >
          {member.image ? (
            <Image
              src={member.image}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 flex-none rounded-full object-cover"
            />
          ) : (
            <span
              style={avatarGradientStyle(member.email)}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-bold text-white"
            >
              {(member.name ?? member.email)?.[0]?.toUpperCase() ?? "?"}
            </span>
          )}
        </ProfileLink>
      ),
      control: (
        <>
          {isAdmin && activeOrgId ? (
            <LedgerSelect
              width="w-[130px]"
              value={member.role}
              ariaLabel={t("roles.title")}
              disabled={updateMemberRole.isPending}
              options={roleOptions}
              onChange={(next) =>
                void save.run(() =>
                  updateMemberRole.mutateAsync({
                    organizationId: activeOrgId,
                    userId: member.id,
                    role: next as "admin" | "member" | "guest",
                  }),
                )
              }
            />
          ) : (
            <LedgerValue>{translateRoleLabel(member.role)}</LedgerValue>
          )}
          {isAdmin && activeOrgId ? (
            // A bare icon, matching the invite list below: a bordered danger
            // button next to every member turns the roster into a row of red.
            <button
              type="button"
              aria-label={t("members.remove")}
              title={t("members.remove")}
              disabled={removeMember.isPending}
              onClick={() => {
                if (
                  confirm(
                    t("members.removeConfirm", { name: member.name ?? member.email }),
                  )
                ) {
                  void save.run(() =>
                    removeMember.mutateAsync({
                      organizationId: activeOrgId,
                      userId: member.id,
                    }),
                  );
                }
              }}
              className="rounded p-1.5 text-fg-tertiary transition hover:text-error disabled:opacity-50"
            >
              <Trash2 size={14} />
            </button>
          ) : null}
        </>
      ),
    });
  }

  const membersBlock =
    isAdmin && activeOrgId ? (
      <div className="flex flex-col gap-6">
        {inviteCandidates?.length ? (
          <div>
            <p className="mb-2 text-xs font-medium text-fg-tertiary">
              {t("members.orgMemberQuickInviteLabel")}
            </p>
            <div className="flex flex-wrap gap-2">
              {inviteCandidates
                .filter((m) => m.email !== profile?.email)
                .slice(0, 12)
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setInviteEmail(m.email);
                      setEmailLookupDebouncedEmail(m.email);
                    }}
                    className="rounded-full border border-border-light px-3 py-1.5 text-xs text-fg-secondary transition hover:border-accent-primary/35 hover:text-fg-primary"
                  >
                    {m.name ?? m.email}
                  </button>
                ))}
            </div>
          </div>
        ) : null}

        {invites?.length ? (
          <div>
            <p className="mb-2 text-xs font-medium text-fg-tertiary">
              {t("members.pendingInvites")}
            </p>
            <ul className="flex flex-col">
              {invites.map((inv, index) => (
                <li
                  key={inv.id}
                  className={`flex flex-wrap items-center gap-3 py-2 ${
                    index > 0 ? "border-t border-border-light" : ""
                  }`}
                >
                  <span className="text-[13.5px] text-fg-secondary">{inv.email}</span>
                  <span className="text-xs text-fg-tertiary">
                    {translateRoleLabel(inv.displayRole ?? inv.role)}
                  </span>
                  <span className="text-[11px] text-fg-quaternary">
                    {inv.expiresAt
                      ? t("members.expiresOn", {
                          date: new Date(inv.expiresAt).toLocaleDateString(),
                        })
                      : t("members.noExpiry")}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    aria-label={t("common.cancel")}
                    disabled={cancelInvite.isPending}
                    onClick={() =>
                      void save.run(() =>
                        cancelInvite.mutateAsync({
                          organizationId: activeOrgId,
                          inviteId: inv.id,
                        }),
                      )
                    }
                    className="rounded p-1 text-fg-tertiary transition hover:text-error disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {inviteHistory?.length ? (
          <div>
            <p className="mb-2 text-xs font-medium text-fg-tertiary">
              {t("members.inviteHistory")}
            </p>
            <ul className="flex flex-col">
              {inviteHistory.slice(0, 8).map((inv, index) => (
                <li
                  key={`history-${inv.id}`}
                  className={`flex items-center justify-between gap-3 py-2 ${
                    index > 0 ? "border-t border-border-light" : ""
                  }`}
                >
                  <span className="text-[13.5px] text-fg-secondary">{inv.email}</span>
                  <span className="text-xs text-fg-tertiary">
                    {translateInviteStatus(inv.status)}
                  </span>
                  <span className="text-[11px] text-fg-quaternary">
                    {new Date(inv.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    ) : undefined;

  // ---- Roles --------------------------------------------------------------
  const roleRows: LedgerRow[] = [];

  if (isAdmin) {
    roleRows.push({
      id: "newRole",
      title: t("roles.newRole"),
      control: (
        <LedgerAction onClick={() => setShowCreateRole((v) => !v)}>
          {showCreateRole ? t("common.cancel") : t("roles.newRole")}
        </LedgerAction>
      ),
    });
  }

  const rolesBlock = (
    <div className="flex flex-col gap-5">
      {showCreateRole && isAdmin && activeOrgId ? (
        <div className="rounded-xl border border-accent-primary/20 p-4">
          <input
            type="text"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder={t("roles.namePlaceholder")}
            aria-label={t("roles.namePlaceholder")}
            className="mb-3 w-full rounded-[10px] border border-border-medium bg-bg-secondary px-2.5 py-1.5 text-[13.5px] text-fg-primary outline-none placeholder:text-fg-quaternary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30"
            autoFocus
          />
          <div className="mb-3 grid grid-cols-2 gap-2">
            {PERMISSION_KEYS.map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 text-xs text-fg-secondary transition hover:text-fg-primary"
              >
                <input
                  type="checkbox"
                  checked={newRolePerms[key]}
                  onChange={(e) =>
                    setNewRolePerms((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                  className="sr-only"
                />
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border transition ${
                    newRolePerms[key]
                      ? "border-accent-primary/50 bg-accent-primary/20"
                      : "border-border-light bg-bg-tertiary"
                  }`}
                >
                  {newRolePerms[key] ? (
                    <Check size={10} className="text-accent-primary" />
                  ) : null}
                </span>
                {t(`permissions.${PERMISSION_LABEL_KEYS[key]}`)}
              </label>
            ))}
          </div>
          <LedgerAction
            disabled={!newRoleName.trim() || createRole.isPending}
            onClick={async () => {
              if (!newRoleName.trim() || !activeOrgId) return;
              await save.run(async () => {
                try {
                  const created = await createRole.mutateAsync({
                    organizationId: activeOrgId,
                    name: newRoleName,
                    ...newRolePerms,
                  });
                  if (created) {
                    setPendingRoles((prev) => [
                      ...prev,
                      created as { id: number; name: string } & Record<
                        PermissionKey,
                        boolean
                      >,
                    ]);
                  }
                  await utils.organization.getRoles.invalidate();
                  toast.success(t("messages.roleCreated"));
                  setNewRoleName("");
                  setNewRolePerms(
                    Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false])) as Record<
                      PermissionKey,
                      boolean
                    >,
                  );
                  setShowCreateRole(false);
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : t("messages.roleCreateFailed"),
                  );
                  throw e;
                }
              });
            }}
          >
            {createRole.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              t("roles.createRole")
            )}
          </LedgerAction>
        </div>
      ) : null}

      {Object.entries(TEMPLATE_ROLES).map(([name, perms]) => (
        <div key={name} className="flex flex-col gap-2 border-t border-border-light pt-4">
          <div className="flex items-center justify-between">
            <h4 className="text-[13.5px] font-semibold text-fg-primary">
              {t(`roles.${name.toLowerCase()}`)}
            </h4>
            <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] font-medium text-fg-tertiary">
              {t("roles.template")}
            </span>
          </div>
          <PermissionGrid perms={perms} t={t} />
        </div>
      ))}

      {[
        ...(roles ?? []),
        ...pendingRoles.filter((pr) => !(roles ?? []).some((r) => r.id === pr.id)),
      ].map((role) => (
        <div
          key={role.id}
          className="flex flex-col gap-2 border-t border-border-light pt-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[13.5px] font-semibold text-fg-primary">{role.name}</h4>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium text-accent-primary">
                {t("roles.custom")}
              </span>
              {isAdmin && activeOrgId ? (
                <button
                  type="button"
                  aria-label={t("roles.deleteConfirm", { name: role.name })}
                  disabled={deleteRole.isPending}
                  onClick={() => {
                    if (confirm(t("roles.deleteConfirm", { name: role.name }))) {
                      void save.run(() =>
                        deleteRole.mutateAsync({
                          organizationId: activeOrgId,
                          roleId: role.id,
                        }),
                      );
                    }
                  }}
                  className="rounded p-1 text-fg-tertiary transition hover:text-error disabled:opacity-50"
                >
                  <Trash2 size={13} />
                </button>
              ) : null}
            </div>
          </div>
          <PermissionGrid perms={role as unknown as Record<PermissionKey, boolean>} t={t} />
        </div>
      ))}
    </div>
  );

  return (
    <LedgerSection
      sectionId="workspace"
      crumb={crumb}
      title={t("organizations.title")}
      subtitle={t("organizations.subtitle")}
    >
      <LedgerGroup
        label={t("organizations.title")}
        hint={t("organizations.subtitle")}
        rows={orgRows}
        note={
          (!myOrgs || myOrgs.length === 0) && isPersonal
            ? t("organizations.emptyDesc")
            : undefined
        }
      />

      {activeOrgId ? (
        <LedgerGroup
          label={t("members.title")}
          hint={t("members.count", { count: members?.length ?? 0 })}
          rows={memberRows}
          block={membersBlock}
        />
      ) : null}

      {activeOrgId ? (
        <LedgerGroup
          label={t("roles.title")}
          hint={t("roles.subtitle")}
          rows={roleRows}
          block={rolesBlock}
        />
      ) : null}

      {inviteQrForOrgId !== null ? (
        <InviteQrDialog
          organizationId={inviteQrForOrgId}
          organizationName={myOrgs?.find((o) => o.id === inviteQrForOrgId)?.name}
          onClose={() => setInviteQrForOrgId(null)}
        />
      ) : null}

      {leaveTarget !== null ? (
        <ConfirmDialog
          destructive
          title={t("organizations.leaveTitle", { name: leaveTarget.name })}
          message={t("organizations.leaveConfirm")}
          confirmLabel={leaveOrg.isPending ? t("common.working") : t("organizations.leave")}
          cancelLabel={t("common.cancel")}
          error={leaveError}
          isPending={leaveOrg.isPending}
          onCancel={() => {
            setLeaveTarget(null);
            setLeaveError(null);
          }}
          onConfirm={() => {
            setLeaveError(null);
            void save.run(() => leaveOrg.mutateAsync({ organizationId: leaveTarget.id }));
          }}
        />
      ) : null}

      {/* Gate one: what is about to happen, in words, with no way to type
          ahead of it. */}
      {deleteTarget?.step === "warn" ? (
        <ConfirmDialog
          destructive
          title={t("organizations.deleteTitle", { name: deleteTarget.name })}
          message={t("organizations.deleteWarning", { name: deleteTarget.name })}
          confirmLabel={t("organizations.deleteContinue")}
          cancelLabel={t("common.cancel")}
          isPending={false}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          onConfirm={() => setDeleteTarget({ ...deleteTarget, step: "type" })}
        />
      ) : null}

      {/* Gate two: the name, typed back. The server checks it again. */}
      {deleteTarget?.step === "type" ? (
        <ConfirmDialog
          destructive
          title={t("organizations.deleteConfirmTitle")}
          message={t("organizations.deleteConfirmMessage", { name: deleteTarget.name })}
          requireText={deleteTarget.name}
          requireTextLabel={t("organizations.deleteConfirmLabel")}
          confirmLabel={
            deleteOrg.isPending ? t("common.working") : t("organizations.deleteFinal")
          }
          cancelLabel={t("common.cancel")}
          error={deleteError}
          isPending={deleteOrg.isPending}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          onConfirm={(typed) => {
            setDeleteError(null);
            void save.run(() =>
              deleteOrg.mutateAsync({
                organizationId: deleteTarget.id,
                confirmName: typed,
              }),
            );
          }}
        />
      ) : null}
    </LedgerSection>
  );
}
