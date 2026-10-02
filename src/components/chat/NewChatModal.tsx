"use client";

/**
 * Start a conversation.
 *
 * The suggestion sources behind this — org members, recent contacts, project
 * teammates — already worked well and are unchanged. The chrome is the chat
 * surface's shared dialog shell; focus handling comes with it from `Modal`.
 *
 * Picking someone under a project heading starts a conversation *scoped to that
 * project* rather than a plain DM. The distinction was being dropped here: every
 * row called `onSelect(person.id)`, so a project teammate produced an untagged
 * conversation, `direct_conversations.project_id` was never written by anything
 * in the UI, and the rail's "Projects" filter could never match a row.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MessageCircle, Search } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { Avatar, CHAT_EYEBROW, displayName, type ChatUser } from "./chatUi";
import { ChatDialog } from "./ChatDialog";

export function NewChatModal({
  onClose,
  onSelect,
  isCreating,
  currentUserId,
  workspaceName,
  hasConversation,
}: {
  onClose: () => void;
  /** `projectId` is present only for rows chosen under a project heading. */
  onSelect: (otherUserId: string, projectId?: number) => void;
  isCreating: boolean;
  currentUserId: string;
  /** The eyebrow over the title. */
  workspaceName?: string;
  /**
   * Whether a thread with this person (in this project, when given) already
   * exists — the row then says "Open" rather than "Start", so picking it is
   * not a surprise either way.
   */
  hasConversation?: (otherUserId: string, projectId?: number) => boolean;
}) {
  const t = useTranslations("chat.direct");
  const [query, setQuery] = useState("");

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

  const row = (person: ChatUser, key: string, projectId?: number) => {
    const existing = hasConversation?.(person.id, projectId) ?? false;
    return (
      <PersonRow
        key={key}
        person={person}
        onSelect={onSelect}
        projectId={projectId}
        disabled={isCreating}
        fallbackLabel={t("userFallback")}
        actionLabel={existing ? t("open") : t("start")}
        existing={existing}
      />
    );
  };

  return (
    <ChatDialog
      icon={<MessageCircle size={17} />}
      eyebrow={workspaceName}
      title={t("newChat")}
      sub={t("newChatSub")}
      foot={t("newChatFoot")}
      cancelLabel={t("cancel")}
      closeLabel={t("cancel")}
      onDismiss={onClose}
      widthClass="w-[540px]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 px-5 pt-[22px] pb-2 sm:px-[26px]">
        <label className="flex h-11 flex-none items-center gap-2.5 rounded-lg border border-tui-ink/16 bg-tui-bg px-3.5 transition-colors focus-within:border-tui-accent/45">
          <Search size={14} className="flex-none text-tui-ink3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchByNameOrEmail")}
            aria-label={t("searchByNameOrEmail")}
            data-autofocus
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-tui-ink outline-none placeholder:text-tui-ink3"
          />
        </label>

        <div className="-mx-2.5 flex max-h-[330px] min-h-0 flex-col gap-1 overflow-y-auto">
          {suggestionsQuery.isLoading ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="animate-spin text-tui-accent" size={20} />
            </div>
          ) : (
            <>
              {emailSearch.data && (
                <Group label={t("searchResults")}>{row(emailSearch.data, "email-hit")}</Group>
              )}
              {emailSearch.isError && query.includes("@") && (
                <p className="px-2.5 py-3 text-[13.5px] text-tui-ink3">{t("userNotFound")}</p>
              )}

              {recents.length > 0 && (
                <Group label={t("recentContacts")}>
                  {recents.map((person) => row(person, `recent-${person.id}`))}
                </Group>
              )}

              {members.length > 0 && (
                <Group label={t("people")}>
                  {members.map((person) => row(person, `member-${person.id}`))}
                </Group>
              )}

              {projectGroups.map((project) => (
                <Group key={project.projectId} label={project.projectTitle}>
                  {project.members.map((person) =>
                    row(person, `p-${project.projectId}-${person.id}`, project.projectId),
                  )}
                </Group>
              ))}

              {nothingToShow && (
                <p className="px-2.5 py-[18px] text-[13.5px] text-tui-ink3">
                  {query.trim()
                    ? t("noOneMatches", { query: query.trim() })
                    : t("noWorkspaceMembersAvailable")}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </ChatDialog>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className={`${CHAT_EYEBROW} px-2.5 pt-2.5 pb-1`}>{label}</h3>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function PersonRow({
  person,
  onSelect,
  projectId,
  disabled,
  fallbackLabel,
  actionLabel,
  existing,
}: {
  person: ChatUser;
  onSelect: (id: string, projectId?: number) => void;
  /** Set when this row sits under a project heading; tags the conversation. */
  projectId?: number;
  disabled: boolean;
  fallbackLabel: string;
  actionLabel: string;
  existing: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(person.id, projectId)}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-tui-ink transition-colors hover:bg-tui-accent/6 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Avatar user={person} size="md" fallbackLabel={fallbackLabel} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[14px] font-medium">{displayName(person, fallbackLabel)}</span>
        {person.email && (
          <span className="truncate text-[12.5px] text-tui-ink3">{person.email}</span>
        )}
      </span>
      <span className={`flex-none text-[12px] ${existing ? "text-tui-ink3" : "text-tui-accent"}`}>
        {actionLabel}
      </span>
    </button>
  );
}
