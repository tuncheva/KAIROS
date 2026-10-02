"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ChatDialog } from "~/components/chat/ChatDialog";
import { usePresence } from "~/components/chat/usePresence";
import { Building2, KeyRound, LogOut, UserMinus } from "~/components/ui/icons";
import { useToast } from "~/components/providers/ToastProvider";
import { useSkeletonHold } from "~/hooks/useSkeletonHold";
import { useSocketEvent } from "~/hooks/useSocketEvent";
import { useSwitchOrganization, useSwitchToPersonal } from "~/hooks/useSwitchOrganization";
import { pickPermissionFlags, type MemberPermissionFlags, type OrgRole } from "~/lib/permissions";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { TeamEmpty, TeamRolesGuide, type FeaturedInvite } from "./TeamEmpty";
import { TeamInviteDialog } from "./TeamInviteDialog";
import { TeamOrg, TeamPersonal, type TeamTab } from "./TeamOrg";
import { TeamPerson } from "./TeamPerson";
import { TeamWorkspaces, type PendingInvite, type WorkspaceId } from "./TeamWorkspaces";
import { TeamOrgSkeleton, TeamPersonSkeleton, TeamWorkspacesSkeleton } from "./TeamSkeleton";
import { type CustomRole, type TeamMember } from "./teamUi";

type Dialog = "invite" | "remove" | "leave" | "join" | "create" | null;

/**
 * The Team page (`/orgs`): workspaces and waiting invitations on the left, the
 * viewed organization's people, invites and roles in the middle, one person's
 * role and eight permission ticks on the right.
 *
 * Viewing a workspace and making it *active* are different things here — you
 * can look around any organization you belong to without switching the rest of
 * the app into it. What you can change follows your own flags in the org being
 * viewed; every mutation is authorized again on the server.
 */
export function TeamClient() {
  const t = useTranslations("team");
  const toast = useToast();
  const router = useRouter();
  const utils = api.useUtils();
  const { isOnline } = usePresence();

  const meQuery = api.user.getCurrentUser.useQuery();
  const orgsQuery = api.organization.listMine.useQuery();
  const activeQuery = api.organization.getActive.useQuery();
  const invitesQuery = api.organization.getMyInvites.useQuery(undefined, { refetchInterval: 30_000 });

  const orgs = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const activeId: WorkspaceId | null = activeQuery.isLoading
    ? null
    : (activeQuery.data?.organization?.id ?? "personal");

  /* The page opens on the active workspace — the one the rest of the app is
     in — and falls back to the first organization, then to personal. */
  const [view, setView] = useState<WorkspaceId | null>(null);
  useEffect(() => {
    if (view !== null && (view === "personal" || orgs.some((o) => o.id === view))) return;
    if (orgsQuery.isLoading || activeQuery.isLoading) return;
    setView(activeId ?? orgs[0]?.id ?? "personal");
  }, [view, orgs, orgsQuery.isLoading, activeQuery.isLoading, activeId]);

  const org = typeof view === "number" ? (orgs.find((o) => o.id === view) ?? null) : null;
  const orgId = org?.id ?? 0;

  const membersQuery = api.organization.getMembers.useQuery({ organizationId: orgId }, { enabled: !!org });
  const rolesQuery = api.organization.getRoles.useQuery({ organizationId: orgId }, { enabled: !!org });
  const members = useMemo<TeamMember[]>(() => membersQuery.data ?? [], [membersQuery.data]);
  const customRoles = useMemo<CustomRole[]>(() => rolesQuery.data ?? [], [rolesQuery.data]);

  const meId = meQuery.data?.id ?? null;
  const me = members.find((m) => m.id === meId) ?? null;
  const myFlags = me ? pickPermissionFlags(me) : pickPermissionFlags(null);
  // These mirror the server's rules for each mutation exactly.
  const isAdmin = me?.role === "admin";
  const canInvite = org?.canInvite === true;
  const canManage = isAdmin && myFlags.canManageRoles;
  const canKick = isAdmin && myFlags.canKickMembers;

  const linksQuery = api.organization.listInviteLinks.useQuery(
    { organizationId: orgId },
    { enabled: !!org && canInvite, retry: false },
  );
  const emailsQuery = api.organization.getInvites.useQuery(
    { organizationId: orgId },
    { enabled: !!org && isAdmin, retry: false },
  );

  const [tab, setTab] = useState<TeamTab>("people");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [joinCode, setJoinCode] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<number | null>(null);

  // Opening an organization selects its first person who isn't you.
  useEffect(() => {
    if (!org || members.length === 0) return;
    if (selectedId && members.some((m) => m.id === selectedId)) return;
    setSelectedId((members.find((m) => m.id !== meId) ?? members[0])?.id ?? null);
  }, [org, members, meId, selectedId]);

  const selected = members.find((m) => m.id === selectedId) ?? null;

  const viewWorkspace = (id: WorkspaceId) => {
    if (id === view) return;
    setView(id);
    setSelectedId(null);
    setTab("people");
  };

  // Real-time: invitations and joins arrive as notifications.
  const onNotification = useCallback(
    (data: { title?: string }) => {
      const title = data.title?.toLowerCase() ?? "";
      if (title.includes("invit") || title.includes("joined") || title.includes("member")) {
        void utils.organization.getMyInvites.invalidate();
        void utils.organization.getMembers.invalidate();
        void utils.organization.getInvites.invalidate();
        void utils.organization.listInviteLinks.invalidate();
        void utils.organization.listMine.invalidate();
      }
    },
    [utils],
  );
  useSocketEvent("notification:new", onNotification);

  const fail = (e: { message: string }) => toast.error(e.message);

  const refreshOrgs = () =>
    Promise.all([
      utils.organization.listMine.invalidate(),
      utils.organization.getActive.invalidate(),
      utils.user.getProfile.invalidate(),
    ]);

  // ── Workspace ──
  const setActive = useSwitchOrganization({
    onSwitched: () => toast.success(t("switchedTo", { name: org?.name ?? "" })),
    onError: (message) => toast.error(message),
  });
  const setPersonal = useSwitchToPersonal({
    onSwitched: () => toast.success(t("switchedToPersonal")),
    onError: (message) => toast.error(message),
  });

  const acceptInvite = api.organization.acceptInvite.useMutation({ onError: fail });
  const declineInvite = api.organization.declineInvite.useMutation({ onError: fail });

  const onAccept = (invite: Pick<PendingInvite, "id" | "organizationId" | "orgName">) => {
    setBusyInviteId(invite.id);
    acceptInvite.mutate(
      { inviteId: invite.id },
      {
        onSuccess: () => {
          toast.success(t("joinedOrg", { name: invite.orgName }));
          void Promise.all([utils.organization.getMyInvites.invalidate(), refreshOrgs()]).then(() =>
            viewWorkspace(invite.organizationId),
          );
        },
        onSettled: () => setBusyInviteId(null),
      },
    );
  };
  const onDecline = (invite: Pick<PendingInvite, "id">) => {
    setBusyInviteId(invite.id);
    declineInvite.mutate(
      { inviteId: invite.id },
      {
        onSuccess: () => {
          toast.success(t("inviteDeclined"));
          void utils.organization.getMyInvites.invalidate();
        },
        onSettled: () => setBusyInviteId(null),
      },
    );
  };

  const join = api.organization.join.useMutation({
    onSuccess: async (data) => {
      toast.success(t("joinedOrg", { name: data.organizationName }));
      setDialog(null);
      setJoinCode("");
      await refreshOrgs();
      // Re-pick: opens the active workspace, which is now usually the new org.
      setView(null);
    },
    onError: fail,
  });

  const create = api.organization.create.useMutation({
    onSuccess: async (data) => {
      toast.success(t("createdOrg", { name: data.name }));
      setDialog(null);
      setNewOrgName("");
      await refreshOrgs();
      viewWorkspace(data.id);
    },
    onError: fail,
  });

  const leave = api.organization.leave.useMutation({
    onSuccess: async () => {
      toast.success(t("left", { name: org?.name ?? "" }));
      setDialog(null);
      setView(null);
      await refreshOrgs();
    },
    onError: fail,
  });

  // ── People ──
  /* Ticks and role pills write straight through and paint immediately: the
     roster is patched in the cache, then refetched to pick up whatever the
     server actually stored. */
  const patchMember = (
    userId: string,
    patch: Partial<MemberPermissionFlags & { role: OrgRole; displayRole: string | null }>,
  ) =>
    utils.organization.getMembers.setData({ organizationId: orgId }, (old) =>
      old?.map((m) => (m.id === userId ? { ...m, ...patch } : m)),
    );
  const settle = () => void utils.organization.getMembers.invalidate({ organizationId: orgId });

  const updateRole = api.organization.updateMemberRole.useMutation({
    onSuccess: () => toast.success(t("roleUpdated")),
    onError: fail,
    onSettled: settle,
  });
  const updatePermissions = api.organization.updateMemberPermissions.useMutation({
    onError: fail,
    onSettled: settle,
  });
  const removeMember = api.organization.removeMember.useMutation({
    onSuccess: async () => {
      toast.success(t("removed", { name: selected?.name ?? selected?.email ?? "", org: org?.name ?? "" }));
      setDialog(null);
      setSelectedId(null);
      await Promise.all([
        utils.organization.getMembers.invalidate({ organizationId: orgId }),
        utils.organization.listMine.invalidate(),
      ]);
    },
    onError: fail,
  });

  const startChat = api.chat.getOrCreateDirectConversation.useMutation({
    onSuccess: (data) => router.push(`/chat?conversationId=${data.conversationId}`),
    onError: fail,
  });

  const onToggleFlags = (next: MemberPermissionFlags) => {
    if (!selected) return;
    void patchMember(selected.id, { ...next, displayRole: null });
    updatePermissions.mutate({ organizationId: orgId, userId: selected.id, ...next });
  };

  // ── Invites ──
  const revokeLink = api.organization.revokeInviteLink.useMutation({
    onSuccess: async () => {
      toast.success(t("linkRevoked"));
      await utils.organization.listInviteLinks.invalidate({ organizationId: orgId });
    },
    onError: fail,
  });
  const cancelInvite = api.organization.cancelInvite.useMutation({
    onSuccess: async () => {
      toast.success(t("inviteRevoked"));
      await utils.organization.getInvites.invalidate({ organizationId: orgId });
    },
    onError: fail,
  });

  const copy = (value: string, id: string, message: string) => {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopiedId(id);
        toast.success(message);
        setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
      },
      () => toast.error(t("copyFailed")),
    );
  };

  const pending: PendingInvite[] = (invitesQuery.data ?? []).map((i) => ({
    id: i.id,
    organizationId: i.organizationId,
    orgName: i.orgName,
    role: i.role,
    displayRole: i.displayRole,
  }));

  const featured: FeaturedInvite | null = invitesQuery.data?.[0] ?? null;
  const noTeam = !orgsQuery.isLoading && orgs.length === 0;

  const loading = useSkeletonHold(orgsQuery.isLoading || activeQuery.isLoading || view === null);
  const selectedName = selected?.name ?? selected?.email ?? "";
  const joinOk = joinCode.replace(/[^a-z0-9]/gi, "").length >= 6;

  return (
    <div className="tui-screen flex h-full min-h-full w-full text-tui-ink">
      <div
        className={cn(
          "grid w-full gap-4 p-2 sm:px-6 sm:pt-5 sm:pb-6",
          "grid-cols-1 lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)]",
          (!!org || noTeam || loading) && "xl:grid-cols-[300px_minmax(0,1fr)_320px]",
        )}
      >
        {loading ? <TeamWorkspacesSkeleton /> : <TeamWorkspaces
          userName={meQuery.data?.name ?? meQuery.data?.email ?? ""}
          orgs={orgs}
          pending={pending}
          view={view ?? "personal"}
          activeId={activeId}
          onView={viewWorkspace}
          onAccept={onAccept}
          onDecline={onDecline}
          busyInviteId={busyInviteId}
          onJoin={() => {
            setJoinCode("");
            setDialog("join");
          }}
          onCreate={() => {
            setNewOrgName("");
            setDialog("create");
          }}
        />}

        {loading ? (
          <TeamOrgSkeleton
            onRetry={() => {
              void orgsQuery.refetch();
              void activeQuery.refetch();
            }}
          />
        ) : org ? (
          <TeamOrg
            org={org}
            members={members}
            meId={meId}
            isOnline={isOnline}
            customRoles={customRoles}
            links={linksQuery.data ?? []}
            emailInvites={emailsQuery.data ?? []}
            canInvite={canInvite}
            canManage={canManage}
            canSeeEmails={isAdmin}
            isActive={activeId === org.id}
            switching={setActive.isPending}
            tab={tab}
            onTab={setTab}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onSetActive={() => setActive.mutate({ organizationId: org.id })}
            onInvite={() => setDialog("invite")}
            onLeave={() => setDialog("leave")}
            onRevokeLink={(linkId) => revokeLink.mutate({ organizationId: org.id, linkId })}
            onRevokeEmail={(inviteId) => cancelInvite.mutate({ organizationId: org.id, inviteId })}
            onCopy={copy}
            copiedId={copiedId}
          />
        ) : noTeam ? (
          <TeamEmpty
            userName={meQuery.data?.name ?? ""}
            email={meQuery.data?.email ?? null}
            invite={featured}
            onJoin={(code) => join.mutate({ code })}
            joining={join.isPending}
            onCreate={(name) => create.mutate({ name })}
            creating={create.isPending}
            onAccept={onAccept}
            onDecline={onDecline}
            busyInviteId={busyInviteId}
          />
        ) : (
          <TeamPersonal
            isActive={activeId === "personal"}
            busy={setPersonal.isPending}
            onSetActive={() => setPersonal.mutate()}
          />
        )}

        {loading ? <TeamPersonSkeleton /> : null}

        {noTeam && !loading ? (
          <div className="flex min-h-0 lg:col-span-2 xl:col-span-1">
            <div className="flex min-h-0 w-full flex-col [&>aside]:flex-1">
              <TeamRolesGuide />
            </div>
          </div>
        ) : null}

        {org && !loading ? (
          <div className="flex min-h-0 lg:col-span-2 xl:col-span-1">
            <div className="flex min-h-0 w-full flex-col [&>aside]:flex-1">
              <TeamPerson
                member={selected}
                isMe={selected?.id === meId}
                online={selected ? isOnline(selected.id) : false}
                customRoles={customRoles}
                canManage={canManage}
                canRemove={canKick && !!selected && selected.id !== meId}
                messaging={startChat.isPending}
                onMessage={() => selected && startChat.mutate({ otherUserId: selected.id })}
                onRemove={() => setDialog("remove")}
                onPickRole={(role) => {
                  if (!selected) return;
                  void patchMember(selected.id, { role, displayRole: null });
                  updateRole.mutate({ organizationId: orgId, userId: selected.id, role });
                }}
                onPickCustomRole={(role) => {
                  if (!selected) return;
                  void patchMember(selected.id, { ...pickPermissionFlags(role), displayRole: role.name });
                  updateRole.mutate({ organizationId: orgId, userId: selected.id, customRoleId: role.id });
                }}
                onToggleFlags={onToggleFlags}
              />
            </div>
          </div>
        ) : null}
      </div>

      {dialog === "invite" && org ? (
        <TeamInviteDialog
          organizationId={org.id}
          organizationName={org.name}
          customRoles={customRoles}
          callerFlags={myFlags}
          callerIsRoleManager={canManage}
          onCopy={copy}
          copiedId={copiedId}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === "remove" && org && selected ? (
        <ChatDialog
          role="alertdialog"
          tone="danger"
          icon={<UserMinus size={17} />}
          eyebrow={org.name}
          title={t("removeTitle", { name: selectedName.split(" ")[0] ?? selectedName })}
          sub={t("removeSub")}
          foot={t("removeFoot")}
          cancelLabel={t("cancel")}
          closeLabel={t("close")}
          primary={{
            label: t("remove"),
            disabled: removeMember.isPending,
            onClick: () => removeMember.mutate({ organizationId: org.id, userId: selected.id }),
          }}
          onDismiss={() => setDialog(null)}
        />
      ) : null}

      {dialog === "leave" && org ? (
        <ChatDialog
          role="alertdialog"
          tone="danger"
          icon={<LogOut size={17} />}
          eyebrow={org.name}
          title={t("leaveTitle")}
          sub={t("leaveSub")}
          foot={activeId === org.id ? t("leaveFootActive") : undefined}
          cancelLabel={t("stay")}
          closeLabel={t("close")}
          primary={{
            label: t("leave"),
            disabled: leave.isPending,
            onClick: () => leave.mutate({ organizationId: org.id }),
          }}
          onDismiss={() => setDialog(null)}
        />
      ) : null}

      {dialog === "create" ? (
        <ChatDialog
          icon={<Building2 size={17} />}
          eyebrow={t("newOrg")}
          title={t("createTitle")}
          sub={t("createSub")}
          foot={t("createFoot")}
          cancelLabel={t("cancel")}
          closeLabel={t("close")}
          widthClass="w-[460px]"
          primary={{
            label: t("create"),
            disabled: !newOrgName.trim() || create.isPending,
            onClick: () => create.mutate({ name: newOrgName.trim() }),
          }}
          onDismiss={() => setDialog(null)}
        >
          <form
            className="flex flex-col gap-2.5 px-5 pt-[22px] sm:px-[26px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (newOrgName.trim() && !create.isPending) create.mutate({ name: newOrgName.trim() });
            }}
          >
            <input
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder={t("createPlaceholder")}
              aria-label={t("createTitle")}
              autoComplete="organization"
              data-autofocus
              className="h-[48px] rounded-lg border border-tui-ink/16 bg-tui-bg px-4 text-[15px] text-tui-ink outline-none placeholder:text-tui-ink3 focus:border-tui-accent/50"
            />
          </form>
        </ChatDialog>
      ) : null}

      {dialog === "join" ? (
        <ChatDialog
          icon={<KeyRound size={17} />}
          eyebrow={t("joinEyebrow")}
          title={t("joinWithCode")}
          sub={t("joinSub")}
          cancelLabel={t("cancel")}
          closeLabel={t("close")}
          widthClass="w-[460px]"
          primary={{
            label: t("join"),
            disabled: !joinOk || join.isPending,
            onClick: () => join.mutate({ code: joinCode.trim() }),
          }}
          onDismiss={() => setDialog(null)}
        >
          <form
            className="flex flex-col gap-2.5 px-5 pt-[22px] sm:px-[26px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (joinOk && !join.isPending) join.mutate({ code: joinCode.trim() });
            }}
          >
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="KX7-42QD"
              aria-label={t("joinWithCode")}
              autoComplete="off"
              spellCheck={false}
              data-autofocus
              className="h-[52px] rounded-lg border border-tui-ink/16 bg-tui-bg px-4 text-center font-mono text-[20px] tracking-[0.14em] text-tui-ink uppercase outline-none placeholder:text-tui-ink3 focus:border-tui-accent/50"
            />
            <span className="text-center text-[12.5px] text-tui-ink3">{t("joinHint")}</span>
          </form>
        </ChatDialog>
      ) : null}
    </div>
  );
}
