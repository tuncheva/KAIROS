"use client";

/**
 * One message, with everything that hangs off it.
 *
 * Grouping is decided by the thread and passed in: `showAvatar` marks the first
 * message of a run by one sender, so a burst reads as one block instead of a
 * stack of identical avatars.
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  Check,
  CheckCheck,
  CornerUpLeft,
  FileText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCw,
  Smile,
  Trash2,
  X,
} from "~/components/ui/icons";

import type { RouterOutputs } from "~/trpc/react";
import { Avatar, formatFileSize, formatTime, isImageMime, type ChatUser } from "./chatUi";

export type ThreadMessage = RouterOutputs["chat"]["listMessages"]["messages"][number];

/** The emoji offered by the quick reaction bar. */
export const QUICK_REACTIONS = ["👍", "🎉", "❤️", "👀", "😄", "🙏"] as const;

export type SendStatus = "sent" | "sending" | "failed";

export function MessageBubble({
  message,
  isOwn,
  showAvatar,
  isLastOwn,
  seen,
  status,
  locale,
  sender,
  onReply,
  onToggleReaction,
  onEdit,
  onDelete,
  onTogglePin,
  onRetry,
  onDiscard,
  onJumpToMessage,
  highlighted,
}: {
  message: ThreadMessage;
  isOwn: boolean;
  showAvatar: boolean;
  isLastOwn: boolean;
  seen: boolean;
  status: SendStatus;
  locale: string;
  sender: ChatUser | null;
  onReply: (message: ThreadMessage) => void;
  onToggleReaction: (messageId: number, emoji: string) => void;
  onEdit: (messageId: number, body: string) => void;
  onDelete: (messageId: number) => void;
  onTogglePin: (messageId: number) => void;
  onRetry: (messageId: number) => void;
  onDiscard: (messageId: number) => void;
  onJumpToMessage: (messageId: number) => void;
  highlighted: boolean;
}) {
  const t = useTranslations("chat.direct");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  const deleted = message.deletedAt !== null;
  const pending = status !== "sent";

  useEffect(() => {
    if (!menuOpen && !pickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setPickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, pickerOpen]);

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

  const bubbleTone = isOwn
    ? "bg-gradient-to-br from-accent-primary to-accent-secondary text-white"
    : "bg-bg-elevated text-fg-primary kairos-system-card";

  return (
    <div
      id={`chat-message-${message.id}`}
      className={`group flex items-end gap-2 ${isOwn ? "flex-row-reverse" : ""} ${
        highlighted ? "rounded-2xl ring-2 ring-accent-primary/50 bg-accent-primary/5 py-1" : ""
      } transition-colors`}
    >
      {showAvatar && !isOwn ? (
        <Avatar user={sender} size="sm" fallbackLabel={t("userFallback")} peek />
      ) : (
        <div className="w-[26px] flex-shrink-0" />
      )}

      <div className={`max-w-[78%] sm:max-w-[70%] flex flex-col gap-1 ${isOwn ? "items-end" : "items-start"}`}>
        {showAvatar && !isOwn && (
          <span className="text-xs font-semibold text-fg-secondary px-3">
            {sender?.name ?? t("userFallback")}
          </span>
        )}

        <div className={`flex items-end gap-1 ${isOwn ? "flex-row-reverse" : ""}`}>
          <div
            className={`px-3.5 py-2.5 rounded-2xl ${
              isOwn ? "rounded-br-md" : "rounded-bl-md"
            } ${deleted ? "bg-bg-secondary text-fg-tertiary italic" : bubbleTone} ${
              pending ? "opacity-60" : ""
            }`}
          >
            {message.replyTo && !deleted && (
              <button
                type="button"
                onClick={() => onJumpToMessage(message.replyTo!.id)}
                className={`block w-full text-left mb-2 pl-2 border-l-2 text-xs rounded-r hover:opacity-80 transition-opacity ${
                  isOwn ? "border-white/50 text-white/80" : "border-accent-primary/60 text-fg-tertiary"
                }`}
              >
                <span className={`block font-semibold ${isOwn ? "text-white" : "text-accent-primary"}`}>
                  {message.replyTo.senderName ?? t("userFallback")}
                </span>
                <span className="line-clamp-2">
                  {message.replyTo.deleted ? t("messageDeleted") : message.replyTo.body}
                </span>
              </button>
            )}

            {deleted ? (
              <p className="text-sm">{t("messageDeleted")}</p>
            ) : editing ? (
              <div className="flex flex-col gap-2 min-w-[220px]">
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
                  className={`w-full text-sm bg-transparent resize-none focus:outline-none rounded-lg p-1 ring-1 ${
                    isOwn ? "ring-white/40 placeholder:text-white/60" : "ring-border-medium"
                  }`}
                />
                <div className="flex items-center gap-2 justify-end text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setEditDraft(message.body);
                    }}
                    className="px-2 py-1 rounded-md hover:bg-black/10"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={commitEdit}
                    className={`px-2 py-1 rounded-md font-semibold ${
                      isOwn ? "bg-white/20 hover:bg-white/30" : "bg-accent-primary text-white"
                    }`}
                  >
                    {t("save")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {message.body.trim().length > 0 && (
                  <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{message.body}</p>
                )}
                {message.attachments.length > 0 && (
                  <div className={`flex flex-col gap-2 ${message.body.trim().length > 0 ? "mt-2" : ""}`}>
                    {message.attachments.map((file) =>
                      isImageMime(file.mime) ? (
                        <a
                          key={file.id}
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-xl overflow-hidden"
                        >
                          <Image
                            src={file.url}
                            alt={file.name}
                            width={file.width ?? 400}
                            height={file.height ?? 300}
                            className="max-w-full max-h-64 w-auto h-auto rounded-xl object-contain hover:opacity-90 transition-opacity"
                            unoptimized
                          />
                        </a>
                      ) : (
                        <a
                          key={file.id}
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-2.5 p-2 rounded-xl min-w-[200px] transition-colors ${
                            isOwn ? "bg-white/15 hover:bg-white/25" : "bg-bg-secondary hover:bg-bg-tertiary"
                          }`}
                        >
                          <span
                            className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${
                              isOwn ? "bg-white/20" : "bg-accent-primary/15 text-accent-primary"
                            }`}
                          >
                            <FileText size={15} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold truncate max-w-[170px]">{file.name}</span>
                            <span className={`block text-[11px] ${isOwn ? "text-white/70" : "text-fg-tertiary"}`}>
                              {formatFileSize(file.sizeBytes)}
                            </span>
                          </span>
                        </a>
                      ),
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Hover actions. Hidden from the tab order only while invisible —
              `focus-within` brings them back for keyboard users. */}
          {!deleted && !pending && !editing && (
            <div
              ref={menuRef}
              className="relative flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
            >
              <button
                type="button"
                onClick={() => {
                  setPickerOpen((v) => !v);
                  setMenuOpen(false);
                }}
                aria-label={t("react")}
                className="p-1.5 rounded-lg text-fg-tertiary hover:text-accent-primary hover:bg-bg-secondary transition-colors"
              >
                <Smile size={15} />
              </button>
              <button
                type="button"
                onClick={() => onReply(message)}
                aria-label={t("reply")}
                className="p-1.5 rounded-lg text-fg-tertiary hover:text-accent-primary hover:bg-bg-secondary transition-colors"
              >
                <CornerUpLeft size={15} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((v) => !v);
                  setPickerOpen(false);
                }}
                aria-label={t("moreActions")}
                aria-expanded={menuOpen}
                className="p-1.5 rounded-lg text-fg-tertiary hover:text-accent-primary hover:bg-bg-secondary transition-colors"
              >
                <MoreHorizontal size={15} />
              </button>

              {pickerOpen && (
                <div
                  className="absolute bottom-full mb-1 right-0 z-30 flex items-center gap-1 p-1.5 rounded-xl kairos-system-card-elevated bg-bg-elevated"
                  role="menu"
                >
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onToggleReaction(message.id, emoji);
                        setPickerOpen(false);
                      }}
                      className="w-7 h-7 grid place-items-center rounded-lg text-base hover:bg-bg-secondary transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {menuOpen && (
                <div
                  className="absolute bottom-full mb-1 right-0 z-30 min-w-[168px] py-1 rounded-xl kairos-system-card-elevated bg-bg-elevated"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onTogglePin(message.id);
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-fg-secondary hover:bg-bg-secondary transition-colors"
                  >
                    {message.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}
                    {message.pinnedAt ? t("unpin") : t("pin")}
                  </button>
                  {isOwn && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setEditDraft(message.body);
                          setEditing(true);
                          setMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-fg-secondary hover:bg-bg-secondary transition-colors"
                      >
                        <Pencil size={14} />
                        {t("edit")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onDelete(message.id);
                          setMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors"
                      >
                        <Trash2 size={14} />
                        {t("delete")}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {message.reactions.length > 0 && (
          <div className={`flex flex-wrap gap-1 px-1 ${isOwn ? "justify-end" : ""}`}>
            {message.reactions.map((group) => (
              <button
                key={group.emoji}
                type="button"
                onClick={() => onToggleReaction(message.id, group.emoji)}
                aria-pressed={group.mine}
                aria-label={`${group.emoji} ${group.count}`}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                  group.mine
                    ? "bg-accent-primary/15 text-accent-primary ring-1 ring-accent-primary/35"
                    : "bg-bg-secondary text-fg-secondary ring-1 ring-border-light/60 hover:bg-bg-tertiary"
                }`}
              >
                <span>{group.emoji}</span>
                <span className="font-semibold tabular-nums">{group.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* One status line per message: the failure affordance when a send did
            not land, the seen receipt on the last own message, otherwise the
            timestamp. */}
        {status === "failed" ? (
          <div className="flex items-center gap-2 px-2 text-xs text-error">
            <span>{t("notSent")}</span>
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80"
            >
              <RotateCw size={11} />
              {t("retry")}
            </button>
            <button
              type="button"
              onClick={() => onDiscard(message.id)}
              className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80"
            >
              <X size={11} />
              {t("discard")}
            </button>
          </div>
        ) : (
          <span
            className={`flex items-center gap-1.5 px-2 text-xs tabular-nums ${
              isOwn && isLastOwn && seen ? "text-accent-primary" : "text-fg-tertiary"
            }`}
          >
            {message.pinnedAt && !deleted && <Pin size={11} aria-label={t("pinned")} />}
            {formatTime(new Date(message.createdAt), locale)}
            {message.editedAt && !deleted && <span className="italic">{t("edited")}</span>}
            {isOwn && status === "sending" && <Check size={12} aria-label={t("sending")} />}
            {isOwn && isLastOwn && status === "sent" && (
              <>
                <CheckCheck size={12} />
                {seen ? t("seen") : t("sent")}
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
