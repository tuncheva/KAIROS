"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, QrCode, User } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import { InviteQrDialog } from "~/components/orgs/InviteQrDialog";
import { OrgBadge } from "~/components/orgs/OrgBadge";
import { useToast } from "~/components/providers/ToastProvider";
import {
  useSwitchOrganization,
  useSwitchToPersonal,
} from "~/hooks/useSwitchOrganization";
import { api } from "~/trpc/react";

/**
 * The workspace identity in the topbar.
 *
 * Replaces the old indicator, which shouted the organisation name in uppercase
 * accent text and parked a permanent access code next to it. The code is gone —
 * people get in by scanning a QR that expires — so what is left is: which
 * workspace am I in, how do I move, and how do I let somebody else in.
 */
export function WorkspaceMenu() {
  const t = useTranslations("org");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /*
   * The workspace name sits in the top bar, so this mounts on every page. The
   * active organisation only changes when somebody switches it — which goes
   * through `useSwitchOrganization` and invalidates this key — so re-asking the
   * server for it on each navigation was pure latency in front of the bar.
   */
  const activeQuery = api.organization.getActive.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const orgsQuery = api.organization.listMine.useQuery(undefined, {
    enabled: open,
  });

  const setActive = useSwitchOrganization({
    onSwitched: () => setOpen(false),
    onError: (message) => toast.error(message),
  });

  const setPersonal = useSwitchToPersonal({
    onSwitched: () => setOpen(false),
    onError: (message) => toast.error(message),
  });

  const isSwitching = setActive.isPending || setPersonal.isPending;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = activeQuery.data;
  const orgName = active?.organization?.name ?? null;
  const isPersonal = !active?.organization;
  const canInvite = active?.canInvite === true;

  const roleLabels: Record<string, string> = {
    admin: t("roleAdmin"),
    worker: t("roleWorker"),
    member: t("roleWorker"),
    mentor: t("roleMentor"),
    guest: t("roleGuest"),
  };
  const roleLabel = active?.role ? (roleLabels[active.role] ?? active.role) : null;

  return (
    <>
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`group flex max-w-[15rem] items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors sm:max-w-[20rem] ${
            open ? "bg-bg-elevated" : "hover:bg-bg-elevated"
          }`}
        >
          {isPersonal ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-secondary text-fg-tertiary">
              <User size={15} />
            </span>
          ) : (
            <OrgBadge
              id={active?.organization?.id ?? orgName ?? ""}
              name={orgName ?? ""}
              image={active?.organization?.image}
            />
          )}

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-tight text-fg-primary">
              {isPersonal ? t("personalWorkspace") : orgName}
            </span>
            <span className="block truncate text-[11px] leading-tight text-fg-tertiary">
              {isPersonal
                ? t("personalHint")
                : roleLabel
                  ? `${t("organization")} · ${roleLabel}`
                  : t("organization")}
            </span>
          </span>

          <ChevronDown
            size={15}
            className={`shrink-0 text-fg-tertiary transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute left-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-border-light/60 bg-bg-surface shadow-2xl"
          >
            <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-fg-tertiary">
              {t("switchWorkspace")}
            </div>

            <div className="max-h-64 overflow-auto py-1">
              {/* Your own space is a destination, not just the state you are in
                  before joining somewhere — so it belongs in the list you can
                  switch to, above the organisations. */}
              <button
                type="button"
                role="menuitem"
                disabled={isSwitching}
                onClick={() => setPersonal.mutate()}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  isPersonal ? "bg-accent-primary/10" : "hover:bg-bg-elevated"
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-secondary text-fg-tertiary">
                  <User size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg-primary">
                    {t("personalWorkspace")}
                  </span>
                  <span className="block text-[11px] text-fg-tertiary">
                    {t("personalSubtitle")}
                  </span>
                </span>
                {isPersonal ? (
                  <Check size={15} className="shrink-0 text-accent-primary" />
                ) : null}
              </button>

              {(orgsQuery.data?.length ?? 0) > 0 ? (
                <div
                  aria-hidden="true"
                  className="my-1 border-t border-border-light/40"
                />
              ) : null}

              {(orgsQuery.data ?? []).map((org) => {
                const isActive = active?.organization?.id === org.id;
                return (
                  <button
                    key={org.id}
                    type="button"
                    role="menuitem"
                    disabled={isSwitching}
                    onClick={() => setActive.mutate({ organizationId: org.id })}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                      isActive ? "bg-accent-primary/10" : "hover:bg-bg-elevated"
                    }`}
                  >
                    <OrgBadge id={org.id} name={org.name} image={org.image} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg-primary">
                        {org.name}
                      </span>
                      <span className="block text-[11px] capitalize text-fg-tertiary">
                        {roleLabels[org.role] ?? org.role}
                      </span>
                    </span>
                    {isActive ? (
                      <Check size={15} className="shrink-0 text-accent-primary" />
                    ) : null}
                  </button>
                );
              })}

              {orgsQuery.isLoading ? (
                <div className="px-3 py-2 text-xs text-fg-tertiary">
                  {t("loadingOrgs")}
                </div>
              ) : null}

              {!orgsQuery.isLoading && (orgsQuery.data?.length ?? 0) === 0 ? (
                <div className="px-3 py-2 text-xs text-fg-tertiary">
                  {t("noOrgs")}
                </div>
              ) : null}
            </div>

            <div className="border-t border-border-light/40 p-1.5">
              {canInvite ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setShowInvite(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-accent-primary transition-colors hover:bg-accent-primary/10"
                >
                  <QrCode size={16} />
                  {t("inviteWithQr")}
                </button>
              ) : null}

              <Link
                href="/orgs"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-fg-secondary transition-colors hover:bg-bg-elevated hover:text-fg-primary"
              >
                <Building2 size={16} />
                {t("yourOrgs")}
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {showInvite ? (
        <InviteQrDialog
          organizationId={active?.organization?.id}
          organizationName={orgName}
          onClose={() => setShowInvite(false)}
        />
      ) : null}
    </>
  );
}
