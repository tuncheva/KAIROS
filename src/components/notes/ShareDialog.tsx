"use client";

/**
 * Sharing a note with someone.
 *
 * The logic here is the one part of the old modal worth keeping wholesale: an
 * email field that suggests people from your organisation, a debounced lookup
 * that tells you whether the address belongs to an account *before* you press
 * share, and per-person read/write permission. What is new is that it behaves
 * like a dialog — labelled, focus-trapped, dismissible with Escape — and that
 * its four lookup states now share one slot under the field.
 *
 * That last part is not cosmetic. Suggestions, looking-up, found and not-found
 * used to be four separately positioned cards, each `rounded-lg
 * kairos-system-card-elevated` — a card floating inside a card — appearing and
 * disappearing at different heights, so the panel snapped as you typed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import { avatarGradientStyle } from "~/lib/avatarGradient";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, Share2, X } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

import { NotesDialog } from "./notesDialog";
import {
  Badge,
  BTN_ACCENT,
  BTN_GHOST,
  FIELD,
  FIELD_INPUT,
  ICON_BTN_BARE,
  MICRO,
  POPOVER_SURFACE,
} from "./notesUi";

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

  const emailRef = useRef<HTMLInputElement | null>(null);
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

  const submit = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    shareNote.mutate({ noteId, email: trimmed, permission });
  };

  const shares = sharesQuery.data ?? [];

  /* One slot, four states, in the order they can actually occur. Rendering it
     as a single expression is what stops two of them ever being on screen at
     once — which the old four independent conditions allowed. */
  const popover = (() => {
    if (debouncedEmail && isLookingUp) {
      return (
        <Row muted>
          <Loader2 size={14} className="animate-spin text-fg-tertiary" />
          <span className="text-[12.5px] text-fg-tertiary">{t("sharing.lookup")}</span>
        </Row>
      );
    }
    if (debouncedEmail && lookup) {
      return (
        <Row>
          <PersonAvatar name={lookup.name} email={lookup.email} image={lookup.image} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-fg-primary">
              {lookup.name ?? t("sharing.noName")}
            </span>
            <span className="block truncate font-mono text-[9.5px] text-fg-quaternary">
              {lookup.email}
            </span>
          </span>
        </Row>
      );
    }
    if (debouncedEmail && !lookup) {
      return (
        <Row muted>
          <AlertCircle size={14} className="flex-none text-error" />
          <span className="text-[12.5px] text-error">{t("sharing.noAccount")}</span>
        </Row>
      );
    }
    if (showSuggestions && email.trim() && suggestions.length > 0) {
      return (
        <ul className="max-h-44 overflow-y-auto">
          {suggestions.map((member, index) => (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => {
                  setEmail(member.email);
                  setShowSuggestions(false);
                }}
                className="calendar-pop flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-bg-secondary"
                style={{ animationDelay: `${index * 0.03}s` }}
              >
                <PersonAvatar name={member.name} email={member.email} image={member.image} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-fg-primary">
                    {member.name ?? t("sharing.noName")}
                  </span>
                  <span className="block truncate font-mono text-[9.5px] text-fg-quaternary">
                    {member.email}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      );
    }
    return null;
  })();

  return (
    <NotesDialog
      icon={<Share2 size={15} />}
      size="lg"
      title={t("sharing.title")}
      onClose={onClose}
      initialFocusRef={emailRef}
      actions={({ close }) => (
        <button type="button" onClick={close} className={BTN_GHOST}>
          {t("common.close")}
        </button>
      )}
    >
      <div className="relative">
        <div className="flex flex-wrap gap-2">
          <label htmlFor="notes-share-email" className="sr-only">
            {t("sharing.emailPlaceholder")}
          </label>
          <div className={`${FIELD} min-w-[180px] flex-1`}>
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
              autoComplete="off"
              className={FIELD_INPUT}
            />
          </div>

          <label htmlFor="notes-share-permission" className="sr-only">
            {t("sharing.permission")}
          </label>
          <div className={`${FIELD} w-[104px] flex-none`}>
            <select
              id="notes-share-permission"
              value={permission}
              onChange={(event) => setPermission(event.target.value as "read" | "write")}
              className={`${FIELD_INPUT} cursor-pointer`}
            >
              <option value="read">{t("sharing.view")}</option>
              <option value="write">{t("sharing.edit")}</option>
            </select>
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!email.trim() || shareNote.isPending}
            className={`${BTN_ACCENT} h-[38px]`}
          >
            {shareNote.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
            {t("share")}
          </button>
        </div>

        {popover && (
          <div
            className={`calendar-pop absolute inset-x-0 top-full z-10 mt-1.5 p-1.5 ${POPOVER_SURFACE}`}
          >
            {popover}
          </div>
        )}
      </div>

      <p className={`${MICRO} mt-6 mb-1`}>{t("sharing.sharedWith")}</p>

      {sharesQuery.isLoading ? (
        <div className="kairos-shimmer h-11 rounded-[10px]" aria-hidden="true" />
      ) : shares.length === 0 ? (
        <p className="py-2 text-[12.5px] text-fg-tertiary">{t("sharing.notSharedYet")}</p>
      ) : (
        <ul className="max-h-52 overflow-y-auto">
          {shares.map((share, index) => (
            <li
              key={share.id}
              /* Rows arrive rather than replacing a pulsing block, staggered so
                 the list reads top-to-bottom. */
              className="calendar-pop flex items-center gap-2.5 border-b border-border-light/45 py-2.5 last:border-b-0"
              style={{ animationDelay: `${index * 0.04}s` }}
            >
              <PersonAvatar name={share.userName} email={share.userEmail} image={share.userImage} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-fg-primary">
                  {share.userName ?? share.userEmail}
                </span>
                <span className="block truncate font-mono text-[9.5px] text-fg-quaternary">
                  {share.userEmail}
                </span>
              </span>
              {/* A badge rather than a line of prose, so a glance down the list
                  reads the permissions column. */}
              <Badge tone={share.permission === "write" ? "ok" : "neutral"}>
                {share.permission === "write" ? t("sharing.canEdit") : t("sharing.viewOnly")}
              </Badge>
              <button
                type="button"
                onClick={() => unshareNote.mutate({ noteId, userId: share.userId })}
                disabled={unshareNote.isPending}
                aria-label={t("sharing.removeAccess", { name: share.userName ?? share.userEmail ?? "" })}
                className={`${ICON_BTN_BARE} hover:text-error disabled:opacity-50`}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </NotesDialog>
  );
}

/** One line inside the lookup slot. */
function Row({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 px-2 ${muted ? "py-2.5" : "py-2"}`}>{children}</div>
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
        className="h-7 w-7 flex-shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={avatarGradientStyle(email ?? name)}
      className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
    >
      {(name ?? email ?? "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}
