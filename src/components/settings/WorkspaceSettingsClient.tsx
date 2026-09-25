"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Pencil, QrCode, RefreshCw, Trash2, X } from "~/components/ui/icons";
import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { useSocketEvent } from "~/hooks/useSocketEvent";
import { useSwitchOrganization } from "~/hooks/useSwitchOrganization";
import { InviteQrDialog } from "~/components/orgs/InviteQrDialog";
import { InviteBuilder } from "~/components/orgs/InviteBuilder";
import {
  PermissionGrid,
  usePermissionSummary,
} from "~/components/orgs/PermissionGrid";
import {
  ROLE_TEMPLATES,
  TEMPLATE_ROLE_ORDER,
  pickPermissionFlags,
  type MemberPermissionFlags,
} from "~/lib/permissions";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useTranslations } from "next-intl";
import Image from "next/image";

import { avatarGradientStyle } from "~/lib/avatarGradient";
import { OrgBadge } from "~/components/orgs/OrgBadge";
import { ProfileLink } from "~/components/profile/ProfileLink";
import { useUploadThing } from "~/lib/uploadthing";

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
// Permissions
// ---------------------------------------------------------------------------
const EMPTY_FLAGS = pickPermissionFlags({});

/** Member-row select values: a built-in role, or `custom:<id>`. */
function customRoleValue(id: number): string {
  return `custom:${id}`;
}

/**
 * A workspace's logo: the uploaded image when it has one, otherwise the same
 * seeded gradient monogram profiles fall back to — seeded by id so the
 * colour survives a rename. Admins get a "Replace" control next to it; other
 * members just see the badge.
 */
function OrgLogoCell({
  org,
  canEdit,
  isUploading,
  onUpload,
  uploadLabel,
}: {
  org: { id: number; name: string; image?: string | null };
  canEdit: boolean;
  isUploading: boolean;
  onUpload: (file: File) => Promise<void>;
  uploadLabel: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const badge = (
    <OrgBadge id={org.id} name={org.name} image={org.image} size={40} rounded="rounded-full" />
  );

  if (!canEdit) return badge;

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 4 * 1024 * 1024 || !file.type.startsWith("image/")) return;
    await onUpload(file);
  };

  return (
    <span className="flex items-center gap-3">
      {badge}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="rounded-sm border border-border-medium px-[13px] py-1.5 text-[12.5px] font-medium text-fg-primary transition-colors hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploadLabel}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
    </span>
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
  // Bumped with a counter so picking the same person twice still re-fills.
  const [invitePrefill, setInvitePrefill] = useState<{ email: string; n: number } | null>(null);
  const [inviteQrForOrgId, setInviteQrForOrgId] = useState<number | null>(null);

  // ---- Leave-organization confirmation ----
  // The org being left, plus the last failure for it: leaving can be refused
  // (sole admin), and that reason has to survive long enough to be read.
  /* Removing a member and deleting a role were the last two `window.confirm`
     calls in the app: an unstyled, untranslated browser box asking about
     someone else's access. Both now go through the same dialog as leaving and
     deleting an organisation. */
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [roleDeleteTarget, setRoleDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
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

  // ---- Custom role create/edit state ----
  // `editingRoleId` null with the form open means "creating".
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRolePerms, setNewRolePerms] = useState<MemberPermissionFlags>(EMPTY_FLAGS);

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

  // ---- Org logo upload ----
  const [uploadingOrgId, setUploadingOrgId] = useState<number | null>(null);
  const { startUpload: startLogoUpload } = useUploadThing("imageUploader");
  const updateOrgImage = api.organization.updateImage.useMutation({
    onSuccess: () => {
      void utils.organization.listMine.invalidate();
      void utils.organization.getActive.invalidate();
    },
    onSettled: () => setUploadingOrgId(null),
  });

  const handleOrgLogoUpload = (organizationId: number) => async (file: File) => {
    setUploadingOrgId(organizationId);
    await save.run(async () => {
      try {
        const uploadResult = await startLogoUpload([file]);
        const url = uploadResult?.[0]?.url;
        if (!url) throw new Error("Upload failed");
        await updateOrgImage.mutateAsync({ organizationId, image: url });
      } catch (e) {
        setUploadingOrgId(null);
        throw e;
      }
    });
  };

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
        void utils.organization.listInviteLinks.invalidate();
      }
    },
    [
      utils.organization.getInvites,
      utils.organization.getInviteHistory,
      utils.organization.getMembers,
      utils.organization.getProjectInviteCandidates,
      utils.organization.listInviteLinks,
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

  /*
   * Who the caller is, so their own row can omit the permission toggles.
   *
   * `updateMemberPermissions` refuses a self-edit outright — an admin cannot
   * revoke their own rights by accident — so showing the controls there would
   * only offer a guaranteed error.
   */
  const currentUser = api.user.getCurrentUser.useQuery();

  const updateMemberPermissions =
    api.organization.updateMemberPermissions.useMutation({
      onSuccess: () => {
        toast.success(t("messages.permissionsUpdated"));
        void utils.organization.getMembers.invalidate();
      },
      onError: (e) => toast.error(e.message),
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

  const resendInvite = api.organization.resendInvite.useMutation({
    onSuccess: (result) => {
      if (result.emailSent) toast.success(t("inviteBuilder.emailSent", { email: result.email }));
      else toast.error(t("inviteBuilder.emailFailed", { email: result.email }));
      void utils.organization.getInvites.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelInvite = api.organization.cancelInvite.useMutation({
    onSuccess: () => {
      toast.success(t("messages.inviteCancelled"));
      void utils.organization.getInvites.invalidate();
      void utils.organization.getInviteHistory.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const createRole = api.organization.createRole.useMutation();
  const updateRole = api.organization.updateRole.useMutation();

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
    // `worker` is `member` under its older name.
    if (normalized === "worker") return t("roles.member");
    if (
      normalized === "admin" ||
      normalized === "member" ||
      normalized === "guest" ||
      normalized === "mentor"
    ) {
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

  const customRoles = roles ?? [];

  /** The member-row select: the built-in templates, then this workspace's own roles. */
  const roleOptions = [
    ...TEMPLATE_ROLE_ORDER.map((r) => ({ value: r as string, label: t(`roles.${r}`) })),
    ...(customRoles.length ? [{ value: "__sep", label: "──────────", disabled: true }] : []),
    ...customRoles.map((role) => ({ value: customRoleValue(role.id), label: role.name })),
  ];

  /** Which option a member's row should show as selected. */
  const memberRoleValue = (member: { role: string; displayRole: string | null }) => {
    const custom = member.displayRole
      ? customRoles.find((r) => r.name === member.displayRole)
      : undefined;
    if (custom) return customRoleValue(custom.id);
    return member.role === "worker" ? "member" : member.role;
  };

  const me = members?.find((m) => m.id === currentUser.data?.id);
  const myFlags = me ? pickPermissionFlags(me) : EMPTY_FLAGS;
  const iManageRoles = isAdmin && myFlags.canManageRoles;
  const summarizePermissions = usePermissionSummary();

  // ---- Organizations ------------------------------------------------------
  const orgRows: LedgerRow[] = (myOrgs ?? []).map((org) => ({
    id: `org-${org.id}`,
    title: org.name,
    // "Active" belongs in the control column beside Switch, not repeated here.
    desc: translateRoleLabel(org.role),
    leading: (
      <OrgLogoCell
        org={org}
        canEdit={org.role === "admin"}
        isUploading={uploadingOrgId === org.id}
        onUpload={handleOrgLogoUpload(org.id)}
        uploadLabel={t("organizations.uploadLogo")}
      />
    ),
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
  const memberRows: LedgerRow[] = [];

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
              value={memberRoleValue(member)}
              ariaLabel={t("roles.title")}
              disabled={updateMemberRole.isPending || member.id === currentUser.data?.id}
              options={roleOptions}
              onChange={(next) =>
                void save.run(() =>
                  updateMemberRole.mutateAsync(
                    next.startsWith("custom:")
                      ? {
                          organizationId: activeOrgId,
                          userId: member.id,
                          customRoleId: Number(next.slice("custom:".length)),
                        }
                      : {
                          organizationId: activeOrgId,
                          userId: member.id,
                          role: next as (typeof TEMPLATE_ROLE_ORDER)[number],
                        },
                  ),
                )
              }
            />
          ) : (
            <LedgerValue>{member.displayRole ?? translateRoleLabel(member.role)}</LedgerValue>
          )}
          {isAdmin && activeOrgId && member.id !== currentUser.data?.id
            ? /*
               * Only the two flags the procedure accepts.
               *
               * `updateMemberPermissions` takes `canAddMembers` and
               * `canAssignTasks` and nothing else, so the roster offers exactly
               * those. The other six come from the role or invite; putting
               * toggles here for flags the server ignores would be a lie.
               */
              (
                [
                  ["canAddMembers", member.canAddMembers] as const,
                  ["canAssignTasks", member.canAssignTasks] as const,
                ].map(([flag, value]) => (
                  <label
                    key={flag}
                    className="flex items-center gap-1.5 text-[12px] text-fg-tertiary"
                  >
                    <input
                      type="checkbox"
                      checked={value ?? false}
                      disabled={updateMemberPermissions.isPending}
                      onChange={(event) =>
                        void save.run(() =>
                          updateMemberPermissions.mutateAsync({
                            organizationId: activeOrgId,
                            userId: member.id,
                            // Both flags travel together: the input requires
                            // each one, so the untouched flag must carry its
                            // current value or the write would clear it.
                            canAddMembers:
                              flag === "canAddMembers"
                                ? event.target.checked
                                : (member.canAddMembers ?? false),
                            canAssignTasks:
                              flag === "canAssignTasks"
                                ? event.target.checked
                                : (member.canAssignTasks ?? false),
                          }),
                        )
                      }
                    />
                    {t(`permissions.${flag === "canAddMembers" ? "inviteMembers" : "assignTasks"}`)}
                  </label>
                ))
              )
            : null}
          {isAdmin && activeOrgId ? (
            // A bare icon, matching the invite list below: a bordered danger
            // button next to every member turns the roster into a row of red.
            <button
              type="button"
              aria-label={t("members.remove")}
              title={t("members.remove")}
              disabled={removeMember.isPending}
              onClick={() =>
                setRemoveTarget({
                  id: member.id,
                  name: member.name ?? member.email,
                })
              }
              className="rounded-sm p-1.5 text-fg-tertiary transition hover:text-error disabled:opacity-50"
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
        <InviteBuilder
          organizationId={activeOrgId}
          customRoles={customRoles}
          callerFlags={myFlags}
          callerIsRoleManager={iManageRoles}
          prefill={invitePrefill ?? undefined}
        />

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
                    onClick={() =>
                      setInvitePrefill((prev) => ({ email: m.email, n: (prev?.n ?? 0) + 1 }))
                    }
                    className="rounded-sm border border-border-light px-3 py-1.5 text-xs text-fg-secondary transition hover:border-accent-primary/35 hover:text-fg-primary"
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
                  <span className="kairos-break-anywhere min-w-0 text-[13.5px] text-fg-secondary">
                    {inv.email}
                  </span>
                  <span className="text-xs text-fg-tertiary">
                    {translateRoleLabel(inv.displayRole ?? inv.role)}
                  </span>
                  <span
                    className="text-xs text-fg-tertiary"
                    title={t("inviteBuilder.permissions")}
                  >
                    {summarizePermissions(inv.permissions, t("inviteBuilder.viewOnly"))}
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
                    aria-label={t("inviteBuilder.resend")}
                    title={t("inviteBuilder.resend")}
                    disabled={resendInvite.isPending}
                    onClick={() =>
                      void save.run(() =>
                        resendInvite.mutateAsync({
                          organizationId: activeOrgId,
                          inviteId: inv.id,
                        }),
                      )
                    }
                    className="rounded-sm p-1 text-fg-tertiary transition hover:text-fg-primary disabled:opacity-50"
                  >
                    <RefreshCw size={14} />
                  </button>
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
                    className="rounded-sm p-1 text-fg-tertiary transition hover:text-error disabled:opacity-50"
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
                  // Wraps like the pending list above: an address, a status
                  // and a full timestamp do not fit one line of a phone.
                  className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2 ${
                    index > 0 ? "border-t border-border-light" : ""
                  }`}
                >
                  <span className="kairos-break-anywhere min-w-0 text-[13.5px] text-fg-secondary">
                    {inv.email}
                  </span>
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
  const closeRoleForm = () => {
    setShowCreateRole(false);
    setEditingRoleId(null);
    setNewRoleName("");
    setNewRolePerms(EMPTY_FLAGS);
  };

  const openRoleForm = (
    from?: { id?: number; name: string } & MemberPermissionFlags,
  ) => {
    setShowCreateRole(true);
    setEditingRoleId(from?.id ?? null);
    setNewRoleName(from?.id ? from.name : "");
    setNewRolePerms(from ? pickPermissionFlags(from) : EMPTY_FLAGS);
  };

  const submitRoleForm = async () => {
    if (!newRoleName.trim() || !activeOrgId) return;
    await save.run(async () => {
      try {
        if (editingRoleId !== null) {
          await updateRole.mutateAsync({
            organizationId: activeOrgId,
            roleId: editingRoleId,
            name: newRoleName,
            permissions: newRolePerms,
          });
          toast.success(t("messages.roleUpdatedSaved"));
        } else {
          await createRole.mutateAsync({
            organizationId: activeOrgId,
            name: newRoleName,
            ...newRolePerms,
          });
          toast.success(t("messages.roleCreated"));
        }
        await utils.organization.getRoles.invalidate();
        closeRoleForm();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("messages.roleCreateFailed"));
        throw e;
      }
    });
  };

  const roleRows: LedgerRow[] = [];

  if (iManageRoles) {
    roleRows.push({
      id: "newRole",
      title: t("roles.newRole"),
      control: (
        <LedgerAction onClick={() => (showCreateRole ? closeRoleForm() : openRoleForm())}>
          {showCreateRole ? t("common.cancel") : t("roles.newRole")}
        </LedgerAction>
      ),
    });
  }

  const roleFormPending = createRole.isPending || updateRole.isPending;

  const rolesBlock = (
    <div className="flex flex-col gap-5">
      {showCreateRole && iManageRoles && activeOrgId ? (
        <div className="rounded-xl border border-accent-primary/20 p-4">
          <input
            type="text"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRoleForm();
            }}
            placeholder={t("roles.namePlaceholder")}
            aria-label={t("roles.namePlaceholder")}
            maxLength={100}
            className="mb-3 w-full rounded-md border border-border-medium bg-bg-secondary px-2.5 py-1.5 text-[13.5px] text-fg-primary outline-none placeholder:text-fg-quaternary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30"
            autoFocus
          />
          <div className="mb-3">
            <PermissionGrid value={newRolePerms} onChange={setNewRolePerms} />
          </div>
          {editingRoleId !== null ? (
            <p className="mb-3 text-[11.5px] text-fg-tertiary">{t("roles.editNote")}</p>
          ) : null}
          <LedgerAction
            disabled={!newRoleName.trim() || roleFormPending}
            onClick={() => void submitRoleForm()}
          >
            {roleFormPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : editingRoleId !== null ? (
              t("roles.saveRole")
            ) : (
              t("roles.createRole")
            )}
          </LedgerAction>
        </div>
      ) : null}

      {/* The built-in templates, straight from `~/lib/permissions` — the same
          flags the server applies, so this list cannot disagree with it. */}
      {TEMPLATE_ROLE_ORDER.map((role) => (
        <div key={role} className="flex flex-col gap-2 border-t border-border-light pt-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[13.5px] font-semibold text-fg-primary">{t(`roles.${role}`)}</h4>
            <div className="flex items-center gap-2">
              <span className="rounded-sm bg-bg-tertiary px-2 py-0.5 text-[10px] font-medium text-fg-tertiary">
                {t("roles.template")}
              </span>
              {iManageRoles && activeOrgId ? (
                <button
                  type="button"
                  onClick={() =>
                    openRoleForm({ name: t(`roles.${role}`), ...ROLE_TEMPLATES[role] })
                  }
                  className="rounded-sm px-1.5 py-0.5 text-[11px] font-medium text-fg-tertiary transition hover:text-fg-primary"
                >
                  {t("roles.duplicate")}
                </button>
              ) : null}
            </div>
          </div>
          <PermissionGrid value={ROLE_TEMPLATES[role]} />
        </div>
      ))}

      {customRoles.map((role) => (
        <div
          key={role.id}
          className="flex flex-col gap-2 border-t border-border-light pt-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[13.5px] font-semibold text-fg-primary">{role.name}</h4>
            <div className="flex items-center gap-2">
              <span className="rounded-sm bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium text-accent-primary">
                {t("roles.custom")}
              </span>
              {iManageRoles && activeOrgId ? (
                <>
                  <button
                    type="button"
                    aria-label={t("roles.edit", { name: role.name })}
                    title={t("roles.edit", { name: role.name })}
                    onClick={() => openRoleForm(role)}
                    className="rounded-sm p-1 text-fg-tertiary transition hover:text-fg-primary"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("roles.deleteConfirm", { name: role.name })}
                    disabled={deleteRole.isPending}
                    onClick={() => setRoleDeleteTarget({ id: role.id, name: role.name })}
                    className="rounded-sm p-1 text-fg-tertiary transition hover:text-error disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <PermissionGrid value={pickPermissionFlags(role)} />
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

      {removeTarget !== null && activeOrgId ? (
        <ConfirmDialog
          destructive
          title={t("members.removeTitle", { name: removeTarget.name })}
          message={t("members.removeBody")}
          confirmLabel={
            removeMember.isPending ? t("common.working") : t("members.remove")
          }
          cancelLabel={t("common.cancel")}
          isPending={removeMember.isPending}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => {
            const userId = removeTarget.id;
            setRemoveTarget(null);
            void save.run(() =>
              removeMember.mutateAsync({ organizationId: activeOrgId, userId }),
            );
          }}
        />
      ) : null}

      {roleDeleteTarget !== null && activeOrgId ? (
        <ConfirmDialog
          destructive
          title={t("roles.deleteConfirm", { name: roleDeleteTarget.name })}
          message={t("roles.deleteBody")}
          confirmLabel={deleteRole.isPending ? t("common.working") : t("roles.delete")}
          cancelLabel={t("common.cancel")}
          isPending={deleteRole.isPending}
          onCancel={() => setRoleDeleteTarget(null)}
          onConfirm={() => {
            const roleId = roleDeleteTarget.id;
            setRoleDeleteTarget(null);
            void save.run(() =>
              deleteRole.mutateAsync({ organizationId: activeOrgId, roleId }),
            );
          }}
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
