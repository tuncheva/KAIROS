"use client";

/**
 * One message, with everything that hangs off it.
 *
 * Grouping is decided by the thread and passed in: `showHead` marks the first
 * message of a run by one sender, which carries the name and time once, so a
 * burst reads as one block rather than a stack of identical captions.
 *
 * The actions — reply, react, pin, edit, delete — float in a small pill above
 * the bubble on hover or keyboard focus, rather than sitting beside it, so the
 * column of bubbles never shifts sideways while the pointer crosses it.
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  FileText,
  Pencil,
  Pin,
  Smile,
  Trash2,
} from "~/components/ui/icons";

import type { RouterOutputs } from "~/trpc/react";
import { chatPill, formatFileSize, formatTime, isImageMime } from "./chatUi";

export type ThreadMessage = RouterOutputs["chat"]["listMessages"]["messages"][number];

/** The emoji offered by the quick reaction bar. */
export const QUICK_REACTIONS = ["👍", "❤️", "😄", "🎉", "👀", "🙏"] as const;

export type SendStatus = "sent" | "sending" | "failed";

const TOOL =
  "kairos-tap grid h-7 w-7 place-items-center rounded-full text-tui-ink2 transition-colors hover:bg-tui-accent/6";

export function MessageBubble({
  message,
  isOwn,
  showHead,
  senderLabel,
  showReceipt,
  seen,
  status,
  locale,
  onReply,
  onToggleReaction,
  onEdit,
  onDelete,
  onTogglePin,
  onRetry,
  onDiscard,
  onJumpToMessage,
  highlighted,
  fresh,
}: {
  message: ThreadMessage;
  isOwn: boolean;
  /** First of a run: show the name and time above the bubble. */
  showHead: boolean;
  /** "You" for your own messages, the sender's name otherwise. */
  senderLabel: string;
  /** The delivery line under the newest own message, when nothing came after it. */
  showReceipt: boolean;
  seen: boolean;
  status: SendStatus;
  locale: string;
  onReply: (message: ThreadMessage) => void;
  onToggleReaction: (messageId: number, emoji: string) => void;
  onEdit: (messageId: number, body: string) => void;
  onDelete: (messageId: number) => void;
  onTogglePin: (messageId: number) => void;
  onRetry: (messageId: number) => void;
  onDiscard: (messageId: number) => void;
  onJumpToMessage: (messageId: number) => void;
  highlighted: boolean;
  /** Arrived while the thread was open — rises into place. */
  fresh: boolean;
}) {
  const t = useTranslations("chat.direct");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  const deleted = message.deletedAt !== null;
  const failed = status === "failed";
  const pending = status !== "sent";
  const pinned = message.pinnedAt !== null && !deleted;
  const createdAt = new Date(message.createdAt);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      /* Caret to the end rather than the start — the usual reason to edit is to
         add to or fix the tail of a message. */
      const len = editRef.current?.value.length ?? 0;
      editRef.current?.setSelectionRange(len, len);
    }
  }, [editing]);

  const commitEdit = () => {
    const next = editDraft.trim();
    if (next.length === 0 || next === message.body) {
      setEditing(false);
      setEditDraft(message.body);
      return;
    }
    onEdit(message.id, next);
    setEditing(false);
  };

  const side = isOwn ? "right-2" : "left-2";
  const align = isOwn ? "items-end" : "items-start";

  return (
    <div
      id={`chat-message-${message.id}`}
      ref={rootRef}
      onMouseLeave={() => setPickerOpen(false)}
      className={`group/msg flex flex-col gap-1.5 ${align} ${showHead ? "pt-5" : "pt-1"}`}
    >
      {showHead && (
        <span className="flex items-baseline gap-2 text-[12.5px]">
          <span className="font-medium text-tui-ink">{senderLabel}</span>
          <span className="text-tui-ink3 tabular-nums">{formatTime(createdAt, locale)}</span>
        </span>
      )}

      <div className={`relative flex max-w-[min(480px,88%)] flex-col gap-1.5 ${align}`}>
        <div
          title={showHead ? undefined : formatTime(createdAt, locale)}
          className={`flex min-w-0 max-w-full flex-col gap-2.5 rounded-[14px] border px-[15px] py-[11px] text-[14.5px] leading-[1.55] text-tui-ink transition-shadow duration-400 ${
            isOwn ? "bg-tui-accent/10" : "bg-tui-ink/[0.045]"
          } ${
            failed ? "border-tui-danger/40" : isOwn ? "border-tui-accent/30" : "border-tui-ink/16"
          } ${highlighted ? "shadow-[0_0_0_4px_rgb(var(--tui-accent)/0.28)]" : ""} ${
            pending && !failed ? "opacity-70" : ""
          } ${fresh ? "chat-rise" : ""}`}
        >
          {message.replyTo && !deleted && (
            <button
              type="button"
              onClick={() => onJumpToMessage(message.replyTo!.id)}
              className="flex flex-col gap-0.5 border-b border-tui-ink/16 pb-[9px] text-left"
            >
              <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-tui-ink3">
                <CornerUpLeft size={11} />
                {message.replyTo.senderName ?? t("userFallback")}
              </span>
              <span className="line-clamp-2 text-[13px] leading-[1.45] text-tui-ink2">
                {message.replyTo.deleted ? t("messageDeleted") : message.replyTo.body}
              </span>
            </button>
          )}

          {deleted ? (
            <span className="text-tui-ink3 italic">{t("messageDeleted")}</span>
          ) : editing ? (
            <div className="flex min-w-[min(260px,60vw)] flex-col gap-2">
              <textarea
                ref={editRef}
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    commitEdit();
                  }
                  if (e.key === "Escape") {
                    setEditing(false);
                    setEditDraft(message.body);
                  }
                }}
                rows={2}
                className="w-full resize-none rounded-lg border border-tui-ink/16 bg-tui-bg p-2 text-[14px] text-tui-ink outline-none focus:border-tui-accent/45"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setEditDraft(message.body);
                  }}
                  className="h-7 rounded-full border border-tui-ink/16 px-3 text-[12px] text-tui-ink2 transition-colors hover:bg-tui-accent/6"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={commitEdit}
                  className="h-7 rounded-full border border-tui-accent bg-tui-accent px-3 text-[12px] font-semibold text-tui-on-accent"
                >
                  {t("save")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {message.attachments.map((file) =>
                isImageMime(file.mime) ? (
                  <a
                    key={file.id}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-[10px] border border-tui-ink/16"
                  >
                    <Image
                      src={file.url}
                      alt={file.name}
                      width={file.width ?? 400}
                      height={file.height ?? 300}
                      className="h-auto max-h-64 w-auto max-w-full object-contain transition-opacity hover:opacity-90"
                      unoptimized
                    />
                  </a>
                ) : (
                  <a
                    key={file.id}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-[min(260px,60vw)] items-center gap-3 rounded-[10px] border border-tui-ink/16 bg-tui-bg px-3 py-2.5 transition-colors hover:border-tui-accent/45"
                  >
                    <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full border border-tui-ink/16 text-tui-ink2">
                      <FileText size={14} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[13.5px] font-medium">{file.name}</span>
                      <span className="text-[12px] text-tui-ink3">{formatFileSize(file.sizeBytes)}</span>
                    </span>
                  </a>
                ),
              )}
              {message.body.trim().length > 0 && (
                <span className="break-words whitespace-pre-wrap text-pretty">
                  {message.body}
                  {message.editedAt && (
                    <span className="ml-1.5 text-[11.5px] text-tui-ink3">{t("edited")}</span>
                  )}
                </span>
              )}
            </>
          )}
        </div>

        {!deleted && (pinned || message.reactions.length > 0) && (
          <div className={`flex flex-wrap items-center gap-1.5 ${isOwn ? "justify-end" : "justify-start"}`}>
            {pinned && (
              <span className="flex h-6 items-center gap-[5px] rounded-full border border-tui-ink/16 px-[9px] text-[11.5px] text-tui-ink3">
                <Pin size={11} />
                {t("pinned")}
              </span>
            )}
            {message.reactions.map((group) => (
              <button
                key={group.emoji}
                type="button"
                onClick={() => onToggleReaction(message.id, group.emoji)}
                aria-pressed={group.mine}
                aria-label={`${group.emoji} ${group.count}`}
                className={`flex h-6 items-center gap-[5px] rounded-full border px-[9px] text-[12px] transition-colors ${chatPill(group.mine)}`}
              >
                <span className="text-[12.5px]">{group.emoji}</span>
                <span className="tabular-nums">{group.count}</span>
              </button>
            ))}
          </div>
        )}

        {failed ? (
          <span className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-tui-danger">
            <span className="flex items-center gap-1.5">
              <AlertCircle size={13} />
              {t("notSent")}
            </span>
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              className="h-[26px] rounded-full border border-tui-danger/40 bg-tui-danger/8 px-[11px] text-[12px] font-medium text-tui-danger"
            >
              {t("retry")}
            </button>
            <button
              type="button"
              onClick={() => onDiscard(message.id)}
              className="h-[26px] rounded-full border border-tui-ink/16 bg-transparent px-[11px] text-[12px] text-tui-ink2 transition-colors hover:bg-tui-accent/6"
            >
              {t("discard")}
            </button>
          </span>
        ) : showReceipt ? (
          <span className="flex items-center gap-[5px] text-[11.5px] text-tui-ink3" aria-live="polite">
            {status === "sending" ? <Clock size={12} /> : seen ? <CheckCheck size={12} /> : <Check size={12} />}
            {status === "sending" ? t("sending") : seen ? t("seen") : t("sent")}
          </span>
        ) : null}

        {/* Hover actions. Invisible until the row is hovered or something in it
            takes keyboard focus, so they stay reachable without a pointer. */}
        {!deleted && !pending && !editing && !pickerOpen && (
          <div
            className={`pointer-events-none absolute -top-[18px] ${side} z-[4] flex gap-0.5 rounded-full border border-tui-ink/16 bg-tui-pane p-[3px] opacity-0 shadow-[var(--tui-lift)] transition-opacity group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100`}
          >
            <button type="button" onClick={() => onReply(message)} aria-label={t("reply")} title={t("reply")} className={TOOL}>
              <CornerUpLeft size={14} />
            </button>
            <button type="button" onClick={() => setPickerOpen(true)} aria-label={t("react")} title={t("react")} className={TOOL}>
              <Smile size={14} />
            </button>
            <button
              type="button"
              onClick={() => onTogglePin(message.id)}
              aria-label={pinned ? t("unpin") : t("pin")}
              aria-pressed={pinned}
              title={pinned ? t("unpin") : t("pin")}
              className={`${TOOL} ${pinned ? "text-tui-accent" : ""}`}
            >
              <Pin size={14} />
            </button>
            {isOwn && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditDraft(message.body);
                    setEditing(true);
                  }}
                  aria-label={t("edit")}
                  title={t("edit")}
                  className={TOOL}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(message.id)}
                  aria-label={t("deleteForEveryone")}
                  title={t("deleteForEveryone")}
                  className={`${TOOL} text-tui-danger hover:bg-tui-danger/8`}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        )}

        {pickerOpen && (
          <div
            role="menu"
            aria-label={t("react")}
            className={`chat-menu-in absolute -top-[22px] ${side} z-[5] flex gap-0.5 rounded-full border border-tui-ink/16 bg-tui-pane p-1 shadow-[var(--tui-lift)]`}
          >
            {QUICK_REACTIONS.map((emoji) => {
              const mine = message.reactions.some((r) => r.emoji === emoji && r.mine);
              return (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onToggleReaction(message.id, emoji);
                    setPickerOpen(false);
                  }}
                  className={`grid h-8 w-8 place-items-center rounded-full text-[16px] transition-colors hover:bg-tui-accent/6 ${mine ? "bg-tui-accent/15" : ""}`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
