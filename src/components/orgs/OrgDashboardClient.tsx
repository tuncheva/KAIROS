"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { useSocketEvent } from "~/hooks/useSocketEvent";

function roleLabel(role: string, tOrg: (key: string) => string) {
  if (role === "admin") return tOrg("roleAdmin");
  if (role === "mentor") return tOrg("roleMentor");
  return tOrg("roleWorker");
}

export function OrgDashboardClient() {
  const tOrg = useTranslations("org");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const router = useRouter();

  const utils = api.useUtils();
  const activeQuery = api.organization.getActive.useQuery();
  const orgsQuery = api.organization.listMine.useQuery();
  const invitesQuery = api.organization.getMyInvites.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // Real-time: refresh invites when a new notification arrives (may include invite updates)
  const handleNotification = useCallback(
    (data: { type?: string; title?: string }) => {
      if (data.title?.toLowerCase().includes("invitation") || data.title?.toLowerCase().includes("invite")) {
        void utils.organization.getMyInvites.invalidate();
      }
    },
    [utils.organization.getMyInvites],
  );
  useSocketEvent("notification:new", handleNotification);

  const setActive = api.organization.setActive.useMutation({
    onSuccess: async () => {
      await utils.organization.getActive.invalidate();
      await utils.organization.listMine.invalidate();
      await utils.user.getProfile.invalidate();
    },
  });

  const acceptInvite = api.organization.acceptInvite.useMutation({
    onSuccess: async (data) => {
      toast.success(tOrg("joinedOrg", { name: data.organizationName ?? "" }));
      await utils.organization.getMyInvites.invalidate();
      await utils.organization.listMine.invalidate();
      await utils.organization.getActive.invalidate();
      await utils.user.getProfile.invalidate();
      router.push("/projects");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const declineInvite = api.organization.declineInvite.useMutation({
    onSuccess: async () => {
      toast.success(tOrg("inviteDeclined"));
      await utils.organization.getMyInvites.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const activeOrgId = activeQuery.data?.organization?.id ?? null;
  const items = orgsQuery.data ?? [];

  if (orgsQuery.isLoading) {
    return (
      <div className="surface-card p-6">
        <div className="text-sm text-fg-secondary">{tCommon("loading")}</div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="surface-card p-6">
        <div className="text-sm text-fg-secondary">{tOrg("noOrgs")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pending Invitations */}
      {(invitesQuery.data?.length ?? 0) > 0 && (
        <div className="surface-card p-6">
          <h2 className="text-lg font-bold text-fg-primary mb-3">{tOrg("pendingInvitations")}</h2>
          <div className="space-y-3">
            {invitesQuery.data?.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl bg-accent-primary/5 border border-accent-primary/20"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-fg-primary">{invite.orgName}</p>
                  <p className="text-sm text-fg-secondary">
                    {tOrg("invitedAs")} <span className="font-medium">{invite.displayRole ?? invite.role}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => acceptInvite.mutate({ inviteId: invite.id })}
                    disabled={acceptInvite.isPending}
                    className="px-4 py-2 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition disabled:opacity-50"
                  >
                    {acceptInvite.isPending ? tOrg("joining") : tCommon("accept")}
                  </button>
                  <button
                    onClick={() => declineInvite.mutate({ inviteId: invite.id })}
                    disabled={declineInvite.isPending}
                    className="px-4 py-2 rounded-xl bg-bg-surface shadow-sm text-sm text-fg-secondary hover:bg-bg-elevated transition disabled:opacity-50"
                  >
                    {tCommon("decline")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="surface-card p-6">
        <h1 className="text-2xl font-bold text-fg-primary">{tOrg("yourOrgs")}</h1>
        <p className="mt-1 text-sm text-fg-secondary">{tOrg("activeOrgHint")}</p>
      </div>

      <div className="grid gap-4">
        {items.map((org) => {
          const isActive = org.id === activeOrgId;
          return (
            <div
              key={org.id}
              className={`surface-card p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
                isActive ? "border border-accent-primary/30" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold text-fg-primary truncate">{org.name}</div>
                  {isActive ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-accent-primary/10 text-accent-primary shadow-sm">
                      {tOrg("active")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-sm text-fg-secondary">
                  {tOrg("roleLabel")}: {roleLabel(org.role, tOrg)}
                </div>
                <div className="mt-2 text-xs text-fg-tertiary">
                  {tOrg("accessCode")}: {" "}
                  <span className="font-mono tracking-[0.2em]">{org.accessCode}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActive.mutate({ organizationId: org.id })}
                  disabled={setActive.isPending || isActive}
                  className="px-4 py-2 rounded-xl bg-bg-surface shadow-sm text-sm text-fg-primary hover:bg-bg-elevated hover:shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isActive ? tOrg("active") : tOrg("setActive")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
