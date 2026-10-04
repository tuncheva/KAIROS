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
} from "~/components/ui/icons";

import { useSkeletonHold } from "~/hooks/useSkeletonHold";
import type { RouterOutputs } from "~/trpc/react";
import { DetailsSectionsSkeleton } from "./ChatSkeletons";
import {
  Avatar,
  CHAT_EYEBROW,
  CHAT_ICON_BUTTON,
  CHAT_PANE,
  displayName,
  formatFileSize,
  formatRailTimestamp,
  isImageMime,
  type ChatUser,
} from "./chatUi";
import { projectHref } from "~/lib/routes";

type Details = RouterOutputs["chat"]["getConversationDetails"];

const ROW =
  "flex w-full items-center gap-[11px] rounded-lg px-1.5 text-left transition-colors disabled:opacity-50";

export function ConversationDetails({
  user,
  online,
  details,
  isLoading,
  muted,
  archived,
  locale,
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
  locale: string;
  onClose: () => void;
  onToggleMute: () => void;
  onToggleArchive: () => void;
  onClearHistory: () => void;
  onLeave: () => void;
  onJumpToMessage: (messageId: number) => void;
  busy: boolean;
}) {
  const t = useTranslations("chat.direct");
  const showSkeleton = useSkeletonHold(isLoading);
  const name = displayName(user, t("userFallback"));
  const firstName = name.split(" ")[0] ?? name;

  return (
    <aside className={`${CHAT_PANE} chat-fade-in flex h-full min-h-0 flex-col`} aria-label={t("details")}>
      <div className="flex flex-none items-center border-b border-tui-ink/8 pt-[18px] pr-4 pb-4 pl-[22px]">
        <h2 className="flex-1 font-display text-[21px] text-tui-ink">{t("details")}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeDetails")}
          className={`${CHAT_ICON_BUTTON} h-[30px] w-[30px]`}
        >
          <X size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto text-tui-ink">
        <section className="flex flex-col items-center gap-1.5 border-b border-tui-ink/8 px-[22px] pt-7 pb-6 text-center">
          <div className="mb-2">
            <Avatar user={user} size="xl" online={online} fallbackLabel={t("userFallback")} peek />
          </div>
          <p className="max-w-full truncate font-display text-[24px] leading-[1.1]">{name}</p>
          <p className="max-w-full truncate text-[13px] text-tui-ink3">
            {user?.email ?? (online ? t("activeNow") : "")}
          </p>
        </section>

        {showSkeleton ? (
          <DetailsSectionsSkeleton />
        ) : (
          <>
            {details && details.pinned.length > 0 && (
              <Section label={t("pinned")} gap="gap-2">
                {details.pinned.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => onJumpToMessage(message.id)}
                    className="flex flex-col gap-[5px] rounded-lg border border-tui-ink/16 bg-tui-bg px-3 py-[11px] text-left transition-colors hover:border-tui-accent/45"
                  >
                    <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-tui-ink3">
                      <Pin size={11} />
                      {message.senderName ?? t("userFallback")} ·{" "}
                      {formatRailTimestamp(new Date(message.createdAt), locale, { yesterday: t("yesterday") })}
                    </span>
                    <span className="line-clamp-3 text-[13px] leading-normal text-tui-ink2">{message.body}</span>
                  </button>
                ))}
              </Section>
            )}

            <Section label={t("sharedFilesCount", { count: details?.files.length ?? 0 })}>
              {details && details.files.length > 0 ? (
                details.files.map((file) => (
                  <a
                    key={file.id}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${ROW} py-2 hover:bg-tui-accent/6`}
                  >
                    <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full border border-tui-ink/16 text-tui-ink2">
                      {isImageMime(file.mime) ? <ImageIcon size={13} /> : <FileText size={13} />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[13px]">{file.name}</span>
                      <span className="text-[11.5px] text-tui-ink3">{formatFileSize(file.sizeBytes)}</span>
                    </span>
                  </a>
                ))
              ) : (
                <p className="px-1.5 text-[13px] text-tui-ink3">{t("noSharedFiles")}</p>
              )}
            </Section>

            {details && details.sharedProjects.length > 0 && (
              <Section label={t("sharedWork")}>
                {details.sharedProjects.map((project) => (
                  <a
                    key={project.id}
                    href={projectHref(project.id)}
                    className={`${ROW} h-9 text-[13.5px] hover:bg-tui-accent/6`}
                  >
                    <FolderKanban size={14} className="flex-none text-tui-ink3" />
                    <span className="truncate">{project.title}</span>
                  </a>
                ))}
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

        <section className="flex flex-col gap-0.5 px-4 pt-3.5 pb-[22px]">
          <button
            type="button"
            onClick={onClearHistory}
            disabled={busy}
            className={`${ROW} h-10 text-[13.5px] text-tui-ink2 hover:bg-tui-accent/6`}
          >
            <Eraser size={14} className="flex-none text-tui-ink3" />
            {t("clearHistory")}
          </button>
          <button
            type="button"
            onClick={onLeave}
            disabled={busy}
            className={`${ROW} h-10 text-[13.5px] text-tui-danger hover:bg-tui-danger/8`}
          >
            <LogOut size={14} className="flex-none" />
            {t("leaveConversation")}
          </button>
          {/* Both actions are one-sided by design — see `clearHistory` and
              `leaveConversation` in the router. The copy says so explicitly
              because the previous Delete Chat did the opposite. */}
          <p className="px-1.5 pt-2 text-[12px] leading-[1.55] text-pretty text-tui-ink3">
            {t("oneSidedNoteNamed", { name: firstName })}
          </p>
        </section>
      </div>
    </aside>
  );
}

function Section({
  label,
  gap = "gap-0.5",
  children,
}: {
  label: string;
  gap?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex flex-col ${gap} border-b border-tui-ink/8 px-4 pt-5 pb-4`}>
      <h3 className={`${CHAT_EYEBROW} px-1.5 pb-2`}>{label}</h3>
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
      className={`${ROW} h-10 text-tui-ink hover:bg-tui-accent/6`}
    >
      <span className="flex-none text-tui-ink3">{icon}</span>
      <span className="flex-1 text-[13.5px]">{label}</span>
      <span
        className={`relative h-5 w-[34px] flex-none rounded-full border transition-colors duration-200 ${
          checked ? "border-tui-accent bg-tui-accent" : "border-tui-ink/16 bg-transparent"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left] duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${
            checked ? "left-4 bg-tui-on-accent" : "left-0.5 bg-tui-ink3"
          }`}
        />
      </span>
    </button>
  );
}
