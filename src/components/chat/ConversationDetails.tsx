"use client";

/**
 * The details pane.
 *
 * Everything here used to be either unreachable or buried in a three-item
 * overflow menu whose only real entry destroyed the conversation for both
 * people. Pins, shared files, shared projects and the notification controls now
 * have somewhere to live.
 */

import { useTranslations } from "next-intl";
import {
  Archive,
  ArchiveRestore,
  BellOff,
  BellRing,
  Eraser,
  FileText,
  FolderKanban,
  ImageIcon,
  LogOut,
  Pin,
  X,
} from "lucide-react";

import type { RouterOutputs } from "~/trpc/react";
import { Avatar, displayName, formatFileSize, isImageMime, type ChatUser } from "./chatUi";

type Details = RouterOutputs["chat"]["getConversationDetails"];

export function ConversationDetails({
  user,
  online,
  details,
  isLoading,
  muted,
  archived,
  onClose,
  onToggleMute,
  onToggleArchive,
  onClearHistory,
  onLeave,
  onJumpToMessage,
  busy,
}: {
  user: ChatUser | null;
  online: boolean;
  details: Details | undefined;
  isLoading: boolean;
  muted: boolean;
  archived: boolean;
  onClose: () => void;
  onToggleMute: () => void;
  onToggleArchive: () => void;
  onClearHistory: () => void;
  onLeave: () => void;
  onJumpToMessage: (messageId: number) => void;
  busy: boolean;
}) {
  const t = useTranslations("chat.direct");

  return (
    <aside
      className="flex flex-col h-full bg-bg-surface border-l border-border-light/40"
      aria-label={t("details")}
    >
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border-light/40 flex-none">
        <h2 className="flex-1 text-base font-bold text-fg-primary">{t("details")}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeDetails")}
          className="kairos-tap p-1.5 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="px-4 py-5 text-center border-b border-border-light/40">
          <div className="inline-block">
            <Avatar user={user} size="xl" online={online} fallbackLabel={t("userFallback")} />
          </div>
          <p className="mt-2.5 text-base font-bold text-fg-primary truncate">
            {displayName(user, t("userFallback"))}
          </p>
          <p className="text-xs text-fg-tertiary truncate">
            {online ? t("activeNow") : user?.email ?? ""}
          </p>
        </section>

        {isLoading ? (
          <div className="px-4 py-5 space-y-3" aria-hidden="true">
            <div className="h-3 w-1/3 rounded bg-bg-secondary animate-pulse" />
            <div className="h-10 rounded-lg bg-bg-secondary animate-pulse" />
            <div className="h-10 rounded-lg bg-bg-secondary animate-pulse" />
          </div>
        ) : (
          <>
            {details && details.pinned.length > 0 && (
              <Section label={t("pinned")}>
                <ul className="flex flex-col gap-1.5">
                  {details.pinned.map((message) => (
                    <li key={message.id}>
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(message.id)}
                        className="w-full text-left p-2.5 rounded-xl bg-bg-secondary hover:bg-bg-tertiary ring-1 ring-border-light/50 transition-colors"
                      >
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-quaternary">
                          <Pin size={10} />
                          {message.senderName ?? t("userFallback")}
                        </span>
                        <span className="block mt-1 text-xs text-fg-secondary line-clamp-3">{message.body}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section label={t("sharedFilesCount", { count: details?.files.length ?? 0 })}>
              {details && details.files.length > 0 ? (
                <ul className="flex flex-col">
                  {details.files.map((file) => (
                    <li key={file.id}>
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 py-2 px-1 rounded-lg hover:bg-bg-secondary transition-colors group"
                      >
                        <span className="w-7 h-7 rounded-lg grid place-items-center bg-bg-tertiary text-fg-tertiary group-hover:text-accent-primary flex-shrink-0 transition-colors">
                          {isImageMime(file.mime) ? <ImageIcon size={13} /> : <FileText size={13} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs text-fg-secondary truncate">{file.name}</span>
                          <span className="block text-[10px] text-fg-quaternary">
                            {formatFileSize(file.sizeBytes)}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-quaternary py-1">{t("noSharedFiles")}</p>
              )}
            </Section>

            {details && details.sharedProjects.length > 0 && (
              <Section label={t("sharedWork")}>
                <ul className="flex flex-col">
                  {details.sharedProjects.map((project) => (
                    <li key={project.id}>
                      <a
                        href={`/projects/${project.id}`}
                        className="flex items-center gap-2.5 py-2 px-1 rounded-lg hover:bg-bg-secondary transition-colors"
                      >
                        <FolderKanban size={14} className="text-fg-quaternary flex-shrink-0" />
                        <span className="text-xs text-fg-secondary truncate">{project.title}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}

        <Section label={t("notifications")}>
          <ToggleRow
            icon={muted ? <BellOff size={14} /> : <BellRing size={14} />}
            label={t("muteConversation")}
            checked={muted}
            onChange={onToggleMute}
            disabled={busy}
          />
          <ToggleRow
            icon={archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            label={t("archiveConversation")}
            checked={archived}
            onChange={onToggleArchive}
            disabled={busy}
          />
        </Section>

        <Section label={t("dangerZone")}>
          <button
            type="button"
            onClick={onClearHistory}
            disabled={busy}
            className="w-full flex items-center gap-2.5 py-2 px-1 rounded-lg text-xs text-fg-secondary hover:bg-bg-secondary transition-colors disabled:opacity-50"
          >
            <Eraser size={14} className="text-fg-quaternary flex-shrink-0" />
            <span className="flex-1 text-left">{t("clearHistory")}</span>
          </button>
          <button
            type="button"
            onClick={onLeave}
            disabled={busy}
            className="w-full flex items-center gap-2.5 py-2 px-1 rounded-lg text-xs text-error hover:bg-error/10 transition-colors disabled:opacity-50"
          >
            <LogOut size={14} className="flex-shrink-0" />
            <span className="flex-1 text-left">{t("leaveConversation")}</span>
          </button>
          {/* Both actions are one-sided by design — see `clearHistory` and
              `leaveConversation` in the router. The copy says so explicitly
              because the previous Delete Chat did the opposite. */}
          <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-fg-quaternary">
            {t("oneSidedNote")}
          </p>
        </Section>
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-4 border-b border-border-light/40">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-fg-quaternary">
        {label}
      </h3>
      {children}
    </section>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className="w-full flex items-center gap-2.5 py-2 px-1 rounded-lg hover:bg-bg-secondary transition-colors disabled:opacity-50"
    >
      <span className="text-fg-quaternary flex-shrink-0">{icon}</span>
      <span className="flex-1 text-left text-xs text-fg-secondary">{label}</span>
      <span
        className={`w-[30px] h-[17px] rounded-full relative transition-colors flex-shrink-0 ${
          checked ? "bg-accent-primary" : "bg-border-strong"
        }`}
      >
        <span
          className={`absolute top-0.5 w-[13px] h-[13px] rounded-full bg-white transition-all ${
            checked ? "left-[15px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
