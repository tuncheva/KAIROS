"use client";

/**
 * Start a conversation.
 *
 * The suggestion sources behind this — org members, recent contacts, project
 * teammates — already worked well and are unchanged; this restyles the modal and
 * gives it the focus handling it was missing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MessageCircle, Search, Users, X } from "lucide-react";

import { api } from "~/trpc/react";
import { Avatar, displayName, type ChatUser } from "./chatUi";

export function NewChatModal({
  onClose,
  onSelect,
  isCreating,
  currentUserId,
}: {
  onClose: () => void;
  onSelect: (otherUserId: string) => void;
  isCreating: boolean;
  currentUserId: string;
}) {
  const t = useTranslations("chat.direct");
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const suggestionsQuery = api.chat.getParticipantSuggestions.useQuery();
  const suggestions = suggestionsQuery.data ?? {
    organizationMembers: [],
    recentContacts: [],
    projectSuggestions: [],
  };

  const emailSearch = api.user.searchByEmail.useQuery(
    { email: query.trim() },
    { enabled: query.trim().length > 3 && query.includes("@"), retry: false },
  );

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo.current?.focus();
    };
  }, [onClose]);

  const matches = (person: ChatUser, needle: string) =>
    (person.name?.toLowerCase() ?? "").includes(needle) ||
    (person.email?.toLowerCase() ?? "").includes(needle);

  const needle = query.toLowerCase().trim();

  const members = useMemo(
    () =>
      suggestions.organizationMembers
        .filter((m) => m.id !== currentUserId)
        .filter((m) => !needle || matches(m, needle))
        .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "")),
    [suggestions.organizationMembers, needle, currentUserId],
  );

  const recents = useMemo(
    () =>
      suggestions.recentContacts
        .filter((m) => !needle || matches(m, needle))
        .slice(0, 8),
    [suggestions.recentContacts, needle],
  );

  const projectGroups = useMemo(
    () =>
      suggestions.projectSuggestions
        .map((project) => ({
          ...project,
          members: project.members.filter((m) => !needle || matches(m, needle)),
        }))
        .filter((project) => project.members.length > 0)
        .slice(0, 6),
    [suggestions.projectSuggestions, needle],
  );

  const nothingToShow =
    members.length === 0 && recents.length === 0 && projectGroups.length === 0 && !emailSearch.data;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 grid place-items-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-chat-title"
        className="w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl bg-bg-elevated kairos-system-card-elevated overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border-light/40 flex-none">
          <h2 id="new-chat-title" className="flex-1 text-lg font-bold text-fg-primary">
            {t("startNewChat")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="p-1.5 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 flex-none">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary pointer-events-none" size={15} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchByNameOrEmail")}
              aria-label={t("searchByNameOrEmail")}
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-bg-secondary rounded-xl text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {suggestionsQuery.isLoading ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="animate-spin text-accent-primary" size={20} />
            </div>
          ) : (
            <>
              {emailSearch.data && (
                <Group label={t("searchResults")}>
                  <PersonRow
                    person={emailSearch.data}
                    onSelect={onSelect}
                    disabled={isCreating}
                    fallbackLabel={t("userFallback")}
                  />
                </Group>
              )}
              {emailSearch.isError && query.includes("@") && (
                <p className="px-3 py-3 text-sm text-fg-tertiary text-center">{t("userNotFound")}</p>
              )}

              {recents.length > 0 && (
                <Group label={t("recentContacts")} icon={<MessageCircle size={13} />}>
                  {recents.map((person) => (
                    <PersonRow
                      key={`recent-${person.id}`}
                      person={person}
                      onSelect={onSelect}
                      disabled={isCreating}
                      fallbackLabel={t("userFallback")}
                    />
                  ))}
                </Group>
              )}

              {members.length > 0 && (
                <Group label={t("workspaceMembers")} icon={<Users size={13} />}>
                  {members.map((person) => (
                    <PersonRow
                      key={`member-${person.id}`}
                      person={person}
                      onSelect={onSelect}
                      disabled={isCreating}
                      fallbackLabel={t("userFallback")}
                    />
                  ))}
                </Group>
              )}

              {projectGroups.map((project) => (
                <Group key={project.projectId} label={project.projectTitle}>
                  {project.members.map((person) => (
                    <PersonRow
                      key={`p-${project.projectId}-${person.id}`}
                      person={person}
                      onSelect={onSelect}
                      disabled={isCreating}
                      fallbackLabel={t("userFallback")}
                    />
                  ))}
                </Group>
              ))}

              {nothingToShow && (
                <p className="px-3 py-8 text-sm text-fg-tertiary text-center">
                  {query.trim() ? t("noWorkspaceMembersMatch") : t("noWorkspaceMembersAvailable")}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-1">
      <h3 className="flex items-center gap-1.5 px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-quaternary">
        {icon}
        {label}
      </h3>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function PersonRow({
  person,
  onSelect,
  disabled,
  fallbackLabel,
}: {
  person: ChatUser;
  onSelect: (id: string) => void;
  disabled: boolean;
  fallbackLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(person.id)}
      disabled={disabled}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Avatar user={person} size="md" fallbackLabel={fallbackLabel} ringClass="ring-bg-elevated" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fg-primary truncate">
          {displayName(person, fallbackLabel)}
        </span>
        {person.email && (
          <span className="block text-xs text-fg-tertiary truncate">{person.email}</span>
        )}
      </span>
    </button>
  );
}
