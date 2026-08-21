"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, CheckCircle2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useToast } from "~/components/providers/ToastProvider";
import { api } from "~/trpc/react";

/**
 * The landing screen for a scanned invite QR.
 *
 * Split from the page so the token can be checked against the live table on the
 * client: the code may well have rotated in the seconds between the camera
 * seeing it and the browser opening, and this screen should say so rather than
 * failing at the moment somebody presses join.
 */
export function JoinWithQrClient({ code }: { code: string }) {
  const t = useTranslations("org");
  const router = useRouter();
  const toast = useToast();
  const utils = api.useUtils();

  const [joined, setJoined] = useState<string | null>(null);

  const peek = api.organization.peekJoinQr.useQuery(
    { code },
    { retry: false, refetchOnWindowFocus: false },
  );

  const join = api.organization.joinWithQr.useMutation({
    onSuccess: async (result) => {
      setJoined(result.organizationName);
      toast.success(t("joinedOrg", { name: result.organizationName }));
      await Promise.all([
        utils.organization.getActive.invalidate(),
        utils.organization.listMine.invalidate(),
        utils.user.getProfile.invalidate(),
      ]);
      router.replace("/dashboard");
      router.refresh();
    },
    onError: (error) => {
      toast.error(error.message);
      // The token died between the peek and the press; re-read so the screen
      // stops offering a button that cannot work.
      void peek.refetch();
    },
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
        <AlertCircle size={28} className="text-red-500" />
        <p className="text-sm text-fg-secondary">{peek.error.message}</p>
        <SecondaryButton onClick={goToDashboard} label={t("joinGoToDashboard")} />
      </Card>
    );
  }

  const result = peek.data;

  if (joined) {
    return (
      <Card>
        <CheckCircle2 size={28} className="text-emerald-500" />
        <p className="text-sm font-medium text-fg-primary">
          {t("joinedOrg", { name: joined })}
        </p>
        <SecondaryButton onClick={goToDashboard} label={t("joinGoToDashboard")} />
      </Card>
    );
  }

  if (result?.status !== "valid") {
    // Every dead-token reason gets its own line — "expired" and "already used"
    // both mean "ask for a fresh QR", but only one of them means the person did
    // nothing wrong.
    const reason =
      result?.status === "expired"
        ? t("joinExpired")
        : result?.status === "used"
          ? t("joinUsed")
          : result?.status === "revoked"
            ? t("joinRevoked")
            : t("joinInvalid");

    return (
      <Card>
        <AlertCircle size={28} className="text-amber-500" />
        <p className="text-sm text-fg-secondary">{reason}</p>
        <p className="text-xs text-fg-tertiary">{t("joinAskForFresh")}</p>
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
    result.role === "mentor"
      ? t("roleMentor")
      : result.role === "admin"
        ? t("roleAdmin")
        : t("roleWorker");

  return (
    <Card>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-primary/10">
        <Building2 size={24} className="text-accent-primary" />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold text-fg-primary">
          {result.organizationName}
        </p>
        <p className="text-sm text-fg-secondary">
          {t("joinAsRole", { role: roleLabel })}
        </p>
      </div>

      <button
        type="button"
        onClick={() => join.mutate({ code })}
        disabled={join.isPending}
        className="w-full rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {join.isPending ? t("joining") : t("joinCta")}
      </button>
      <SecondaryButton onClick={goToDashboard} label={t("joinDecline")} />
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

function SecondaryButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
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
