"use client";

/**
 * Sharing a note with someone.
 *
 * The logic here is the one part of the old modal worth keeping wholesale: an
 * email field that suggests people from your organisation, a debounced lookup
 * that tells you whether the address belongs to an account *before* you press
 * share, and per-person read/write permission. What is new is that it behaves
 * like a dialog — labelled, focus-trapped, dismissible with Escape.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import { avatarGradientStyle } from "~/lib/avatarGradient";
import { useTranslations } from "next-intl";
import { Loader2, Share2, X } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOKUP_DEBOUNCE_MS = 400;

export function ShareDialog({ noteId, onClose }: { noteId: number; onClose: () => void }) {
  const t = useTranslations("notes");
  const toast = useToast();
  const utils = api.useUtils();

  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"read" | "write">("read");
  const [debouncedEmail, setDebouncedEmail] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sharesQuery = api.note.getNoteShares.useQuery({ noteId });
  const { data: activeOrg } = api.organization.getActive.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const organizationId = activeOrg?.organization?.id;
  const { data: orgMembers } = api.organization.getMembers.useQuery(
    { organizationId: organizationId! },
    { enabled: !!organizationId, retry: false, refetchOnWindowFocus: false },
  );

  /* Only look an address up once it is plausibly an address — otherwise every
     keystroke of "a", "an", "ana@" becomes a query. */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = email.trim();
    if (EMAIL_RE.test(trimmed)) {
      debounceRef.current = setTimeout(() => setDebouncedEmail(trimmed), LOOKUP_DEBOUNCE_MS);
    } else {
      setDebouncedEmail("");
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [email]);

  const { data: lookup, isFetching: isLookingUp } = api.user.searchByEmail.useQuery(
    { email: debouncedEmail },
    { enabled: !!debouncedEmail, retry: false, refetchOnWindowFocus: false },
  );

  const suggestions = useMemo(() => {
    const trimmed = email.trim().toLowerCase();
    if (!orgMembers || !trimmed) return [];
    return orgMembers
      .filter(
        (member) =>
          !!member.email &&
          ((member.email?.toLowerCase().includes(trimmed) ?? false) ||
            (member.name?.toLowerCase().includes(trimmed) ?? false)),
      )
      .slice(0, 5);
  }, [orgMembers, email]);

  const shareNote = api.note.shareNote.useMutation({
    onSuccess: () => {
      toast.success(t("messages.shared"));
      setEmail("");
      setShowSuggestions(false);
      void utils.note.getNoteShares.invalidate({ noteId });
      void utils.note.getAll.invalidate();
      emailRef.current?.focus();
    },
    onError: (error) => toast.error(error.message),
  });

  const unshareNote = api.note.unshareNote.useMutation({
    onSuccess: () => {
      toast.success(t("messages.accessRemoved"));
      void utils.note.getNoteShares.invalidate({ noteId });
      void utils.note.getAll.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    emailRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo.current?.focus();
    };
  }, [onClose]);

  const submit = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    shareNote.mutate({ noteId, email: trimmed, permission });
  };

  const shares = sharesQuery.data ?? [];

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/50 grid place-items-center p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notes-share-title"
        className="w-full max-w-md p-6 rounded-2xl bg-bg-elevated kairos-system-card-elevated"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-accent-primary/12 grid place-items-center">
            <Share2 size={16} className="text-accent-primary" />
          </div>
          <h2 id="notes-share-title" className="flex-1 text-base font-bold text-fg-primary">
            {t("sharing.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="kairos-tap p-1.5 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative">
            <label htmlFor="notes-share-email" className="sr-only">
              {t("sharing.emailPlaceholder")}
            </label>
            <input
              id="notes-share-email"
              ref={emailRef}
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={t("sharing.emailPlaceholder")}
              className="w-full px-3 py-2 text-sm bg-bg-secondary rounded-lg text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
            />

            {showSuggestions && email.trim() && !debouncedEmail && suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-10 max-h-40 overflow-y-auto rounded-lg bg-bg-elevated kairos-system-card-elevated p-1">
                {suggestions.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(member.email);
                        setShowSuggestions(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-bg-secondary transition-colors text-left"
                    >
                      <PersonAvatar name={member.name} email={member.email} image={member.image} />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-fg-primary truncate">
                          {member.name ?? t("sharing.noName")}
                        </span>
                        <span className="block text-[10px] text-fg-tertiary truncate">{member.email}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {debouncedEmail && isLookingUp && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 flex items-center gap-2 p-2.5 rounded-lg bg-bg-elevated kairos-system-card-elevated">
                <Loader2 size={12} className="animate-spin text-fg-tertiary" />
                <p className="text-xs text-fg-tertiary">{t("sharing.lookup")}</p>
              </div>
            )}

            {debouncedEmail && !isLookingUp && lookup && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 flex items-center gap-2.5 p-2.5 rounded-lg bg-bg-elevated kairos-system-card-elevated ring-1 ring-accent-primary/20">
                <PersonAvatar name={lookup.name} email={lookup.email} image={lookup.image} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg-primary truncate">
                    {lookup.name ?? t("sharing.noName")}
                  </p>
                  <p className="text-[10px] text-fg-tertiary truncate">{lookup.email}</p>
                </div>
              </div>
            )}

            {debouncedEmail && !isLookingUp && !lookup && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 p-2.5 rounded-lg bg-bg-elevated kairos-system-card-elevated ring-1 ring-error/20">
                <p className="text-xs text-error">{t("sharing.noAccount")}</p>
              </div>
            )}
          </div>

          <label htmlFor="notes-share-permission" className="sr-only">
            {t("sharing.permission")}
          </label>
          <select
            id="notes-share-permission"
            value={permission}
            onChange={(event) => setPermission(event.target.value as "read" | "write")}
            className="px-3 py-2 text-sm bg-bg-secondary rounded-lg text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
          >
            <option value="read">{t("sharing.view")}</option>
            <option value="write">{t("sharing.edit")}</option>
          </select>

          <button
            type="button"
            onClick={submit}
            disabled={!email.trim() || shareNote.isPending}
            className="px-4 py-2 rounded-lg bg-accent-primary text-white text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {shareNote.isPending ? <Loader2 size={14} className="animate-spin" /> : t("share")}
          </button>
        </div>

        <p className="text-[9.5px] font-semibold uppercase tracking-widest text-fg-quaternary mb-2">
          {t("sharing.sharedWith")}
        </p>

        {sharesQuery.isLoading ? (
          <div className="h-10 rounded-lg bg-bg-secondary animate-pulse" aria-hidden="true" />
        ) : shares.length === 0 ? (
          <p className="text-xs text-fg-tertiary py-2">{t("sharing.notSharedYet")}</p>
        ) : (
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {shares.map((share) => (
              <li
                key={share.id}
                className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-bg-secondary"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <PersonAvatar name={share.userName} email={share.userEmail} image={share.userImage} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-fg-primary truncate">
                      {share.userName ?? share.userEmail}
                    </p>
                    <p className="text-[10px] text-fg-tertiary">
                      {share.permission === "write" ? t("sharing.canEdit") : t("sharing.viewOnly")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => unshareNote.mutate({ noteId, userId: share.userId })}
                  disabled={unshareNote.isPending}
                  aria-label={t("sharing.removeAccess", { name: share.userName ?? share.userEmail ?? "" })}
                  className="p-1 rounded text-fg-tertiary hover:text-error transition-colors disabled:opacity-50"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PersonAvatar({
  name,
  email,
  image,
}: {
  name: string | null;
  email: string | null;
  image: string | null;
}) {
  if (image) {
    return (
      <Image
        src={image}
        alt=""
        width={28}
        height={28}
        unoptimized
        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={avatarGradientStyle(email ?? name)}
      className="w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold text-white flex-shrink-0"
    >
      {(name ?? email ?? "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}
