"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { AlertCircle, Building2, CheckCircle2, Loader2 } from "~/components/ui/icons";
import { useToast } from "~/components/providers/ToastProvider";
import { PermissionGrid } from "~/components/orgs/PermissionGrid";
import { api } from "~/trpc/react";

/** The landing screen for an emailed invitation. */
export function AcceptInviteClient({ token }: { token: string }) {
  const t = useTranslations("org");
  const tRoles = useTranslations("settings.workspace.roles");
  const router = useRouter();
  const toast = useToast();
  const utils = api.useUtils();

  const [joined, setJoined] = useState<string | null>(null);

  const peek = api.organization.peekInvite.useQuery(
    { token },
    { retry: false, refetchOnWindowFocus: false },
  );

  const refreshShell = async () => {
    await Promise.all([
      utils.organization.getActive.invalidate(),
      utils.organization.listMine.invalidate(),
      utils.organization.getMyInvites.invalidate(),
      utils.user.getProfile.invalidate(),
    ]);
  };

  const accept = api.organization.acceptInviteByToken.useMutation({
    onSuccess: async (result) => {
      setJoined(result.organizationName);
      toast.success(t("joinedOrg", { name: result.organizationName }));
      await refreshShell();
      router.replace("/dashboard");
      router.refresh();
    },
    onError: (error) => {
      toast.error(error.message);
      void peek.refetch();
    },
  });

  const decline = api.organization.declineInvite.useMutation({
    onSuccess: async () => {
      toast.success(t("inviteDeclined"));
      await refreshShell();
      router.replace("/dashboard");
    },
    onError: (error) => toast.error(error.message),
  });

  const goToDashboard = useCallback(() => {
    router.replace("/dashboard");
    router.refresh();
  }, [router]);

  if (peek.isLoading) {
    return (
      <Card>
        <Loader2 size={28} className="animate-spin text-fg-tertiary" />
        <p className="text-sm text-fg-secondary">{t("joinChecking")}</p>
      </Card>
    );
  }

  if (peek.isError) {
    return (
      <Card>
        <AlertCircle size={28} className="text-status-danger-ink" />
        <p className="text-sm text-fg-secondary">{peek.error.message}</p>
        <SecondaryButton onClick={goToDashboard} label={t("joinGoToDashboard")} />
      </Card>
    );
  }

  if (joined) {
    return (
      <Card>
        <CheckCircle2 size={28} className="text-status-success-ink" />
        <p className="text-sm font-medium text-fg-primary">{t("joinedOrg", { name: joined })}</p>
        <SecondaryButton onClick={goToDashboard} label={t("joinGoToDashboard")} />
      </Card>
    );
  }

  const result = peek.data;

  if (result?.status === "wrongAccount") {
    return (
      <Card>
        <AlertCircle size={28} className="text-status-warning-ink" />
        <p className="text-sm text-fg-secondary">
          {t("inviteWrongAccount", {
            invited: result.invitedEmail,
            current: result.signedInEmail ?? "—",
          })}
        </p>
        <SecondaryButton onClick={goToDashboard} label={t("joinGoToDashboard")} />
      </Card>
    );
  }

  if (result?.status !== "valid") {
    const reason =
      result?.status === "expired"
        ? t("inviteExpired")
        : result?.status === "used"
          ? t("inviteUsed")
          : result?.status === "revoked"
            ? t("inviteRevoked")
            : t("inviteInvalid");

    return (
      <Card>
        <AlertCircle size={28} className="text-status-warning-ink" />
        <p className="text-sm text-fg-secondary">{reason}</p>
        <p className="text-xs text-fg-tertiary">{t("inviteAskForNew")}</p>
        <SecondaryButton onClick={goToDashboard} label={t("joinGoToDashboard")} />
      </Card>
    );
  }

  if (result.alreadyMember) {
    return (
      <Card>
        <Building2 size={28} className="text-fg-tertiary" />
        <p className="text-sm text-fg-secondary">
          {t("joinAlreadyMember", { name: result.organizationName })}
        </p>
        <SecondaryButton onClick={goToDashboard} label={t("joinGoToDashboard")} />
      </Card>
    );
  }

  const roleLabel =
    result.displayRole ?? tRoles(result.role === "worker" ? "member" : result.role);

  return (
    <Card>
      <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-accent-primary/10">
        <Building2 size={24} className="text-accent-primary" />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold text-fg-primary">{result.organizationName}</p>
        <p className="text-sm text-fg-secondary">
          {result.inviterName
            ? t("inviteFrom", { name: result.inviterName, role: roleLabel })
            : t("joinAsRole", { role: roleLabel })}
        </p>
      </div>

      <div className="w-full rounded-lg border border-border-light p-4 text-left">
        <p className="mb-3 text-xs font-medium text-fg-tertiary">{t("inviteYouWillBeAbleTo")}</p>
        <PermissionGrid value={result.permissions} />
      </div>

      <button
        type="button"
        onClick={() => accept.mutate({ token })}
        disabled={accept.isPending || decline.isPending}
        className="w-full rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {accept.isPending ? t("joining") : t("inviteAccept")}
      </button>
      <SecondaryButton
        onClick={() => decline.mutate({ inviteId: result.inviteId })}
        label={t("inviteDecline")}
      />
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-card flex flex-col items-center gap-4 p-8 text-center">
      {children}
    </div>
  );
}

function SecondaryButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium text-fg-tertiary transition-colors hover:text-fg-secondary"
    >
      {label}
    </button>
  );
}
