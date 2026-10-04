"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, QrCode, User } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import { InviteQrDialog } from "~/components/orgs/InviteQrDialog";
import { OrgBadge } from "~/components/orgs/OrgBadge";
import { OrgEmptyState } from "~/components/orgs/OrgEmptyState";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        /* Back to the trigger. Closing a menu and leaving focus on the
           document body strands a keyboard user at the top of the page. */
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      /* `role="menu"` was here without any of the behaviour it promises: a
         screen reader announced a menu, and then arrow keys did nothing.
         `notes/Menu.tsx` already does this correctly; this is the same walk. */
      const items = menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      );
      if (!items || items.length === 0) return;
      event.preventDefault();

      const list = Array.from(items);
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? list[(index + 1) % list.length]
          : list[(index - 1 + list.length) % list.length];
      next?.focus();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /* Opening a menu puts you on its first item — otherwise Tab walks from the
     trigger into the page behind the open menu. */
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
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
      {/* `min-w-0` so the switcher is what gives way in a 320px top bar: it
          was the one item that could not shrink, and pushed the bell and the
          avatar off the right edge instead of truncating its own name. */}
      <div className="relative min-w-0" ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`group flex h-[38px] min-w-0 max-w-[min(15rem,100%)] items-center gap-2.5 rounded-full border py-0 pr-2.5 pl-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-tui-accent focus-visible:outline-none sm:h-10 sm:max-w-[17rem] ${
            open
              ? "border-tui-ink/8 bg-tui-ink/[0.04]"
              : "border-transparent hover:border-tui-ink/8 hover:bg-tui-ink/[0.04]"
          }`}
        >
          {isPersonal ? (
            <WorkspaceMark personal />
          ) : (
            <WorkspaceMark
              id={active?.organization?.id ?? orgName ?? ""}
              name={orgName ?? ""}
              image={active?.organization?.image}
            />
          )}

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold leading-tight tracking-[-0.005em] text-tui-ink">
              {isPersonal ? t("personalWorkspace") : orgName}
            </span>
            {/* The role is the one coloured word, so "Admin" reads at a glance.
                Hidden on phones, where the name needs every pixel. */}
            <span className="hidden truncate text-[11px] leading-tight text-tui-ink3 sm:block">
              {isPersonal ? (
                t("personalHint")
              ) : roleLabel ? (
                <>
                  {t("organization")} ·{" "}
                  <span className="font-medium text-tui-accent">{roleLabel}</span>
                </>
              ) : (
                t("organization")
              )}
            </span>
          </span>

          <ChevronDown
            size={14}
            className={`shrink-0 text-tui-ink3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open ? (
          <div
            ref={menuRef}
            role="menu"
            className="absolute left-0 z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-tui-ink/12 bg-tui-pane shadow-[var(--tui-lift)]"
          >
            <div className="px-4 pb-1.5 pt-3.5 text-[11px] font-medium uppercase tracking-[0.12em] text-tui-ink3">
              {t("switchWorkspace")}
            </div>

            <div className="max-h-64 overflow-auto px-1.5 py-1">
              {/* Your own space is a destination, not just the state you are in
                  before joining somewhere — so it belongs in the list you can
                  switch to, above the organisations. */}
              <button
                type="button"
                role="menuitem"
                disabled={isSwitching}
                onClick={() => setPersonal.mutate()}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isPersonal ? "bg-tui-accent/10" : "hover:bg-tui-ink/[0.045]"
                }`}
              >
                <WorkspaceMark personal size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-tui-ink">
                    {t("personalWorkspace")}
                  </span>
                  <span className="block text-[11.5px] text-tui-ink3">
                    {t("personalSubtitle")}
                  </span>
                </span>
                {isPersonal ? (
                  <Check size={15} className="shrink-0 text-tui-accent" />
                ) : null}
              </button>

              {(orgsQuery.data?.length ?? 0) > 0 ? (
                <div
                  aria-hidden="true"
                  className="mx-2.5 my-1 border-t border-tui-ink/8"
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
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isActive ? "bg-tui-accent/10" : "hover:bg-tui-ink/[0.045]"
                    }`}
                  >
                    <WorkspaceMark id={org.id} name={org.name} image={org.image} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-tui-ink">
                        {org.name}
                      </span>
                      <span className="block text-[11.5px] capitalize text-tui-ink3">
                        {roleLabels[org.role] ?? org.role}
                      </span>
                    </span>
                    {isActive ? (
                      <Check size={15} className="shrink-0 text-tui-accent" />
                    ) : null}
                  </button>
                );
              })}

              {orgsQuery.isLoading ? (
                <div className="px-2.5 py-2 text-xs text-tui-ink3">
                  {t("loadingOrgs")}
                </div>
              ) : null}

              {/* The switcher's dead end: it stated the problem and offered no
                  way out. Same empty state as `/orgs`, in its compact form. */}
              {!orgsQuery.isLoading && (orgsQuery.data?.length ?? 0) === 0 ? (
                <OrgEmptyState compact />
              ) : null}
            </div>

            <div className="border-t border-tui-ink/8 p-1.5">
              {canInvite ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setShowInvite(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium text-tui-accent transition-colors hover:bg-tui-accent/10"
                >
                  <QrCode size={16} />
                  {t("inviteWithQr")}
                </button>
              ) : null}

              <Link
                href="/orgs"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-tui-ink2 transition-colors hover:bg-tui-ink/[0.045] hover:text-tui-ink"
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

/**
 * The workspace's face in the switcher: an uploaded logo when there is one,
 * otherwise a serif initial in a soft wash — the same avatar language as the
 * dashboard, instead of the loud gradient monogram `OrgBadge` paints. Your own
 * space is the neutral one.
 */
function WorkspaceMark({
  personal = false,
  id = "",
  name = "",
  image,
  size = 32,
}: {
  personal?: boolean;
  id?: number | string;
  name?: string;
  image?: string | null;
  size?: number;
}) {
  if (!personal && image) {
    return <OrgBadge id={id} name={name} image={image} size={size} rounded="rounded-full" />;
  }

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-display leading-none ${
        personal ? "bg-tui-ink/[0.06] text-tui-ink2" : "bg-tui-accent/12 text-tui-accent"
      }`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.56) }}
    >
      {personal ? (
        <User size={Math.round(size * 0.45)} />
      ) : (
        name.trim().charAt(0).toUpperCase() || "·"
      )}
    </span>
  );
}
