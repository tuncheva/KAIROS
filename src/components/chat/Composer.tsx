"use client";

/**
 * The message composer.
 *
 * This was an `<input type="text">`, which made multi-line messages impossible:
 * the Enter/Shift+Enter handler was there, but an input cannot hold a newline,
 * so Shift+Enter did nothing. It is a textarea that grows with its content and
 * stops at `MAX_ROWS`, after which it scrolls.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CornerUpLeft, FileText, ImageIcon, Loader2, Paperclip, Send, X } from "~/components/ui/icons";

import { formatFileSize, isImageMime } from "./chatUi";
import type { ThreadMessage } from "./MessageBubble";

/** Height cap, in rows, before the box scrolls instead of growing. */
const MAX_ROWS = 6;
const LINE_HEIGHT_PX = 20;
const VERTICAL_PADDING_PX = 20;

export interface PendingAttachment {
  file: File;
  /** Object URL for the local preview; revoked on removal to avoid a leak. */
  previewUrl: string | null;
}

export function Composer({
  value,
  onChange,
  onSend,
  replyingTo,
  onCancelReply,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onTyping,
  onStopTyping,
  disabled,
  isSending,
  isUploading,
  hasDraft,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  replyingTo: ThreadMessage | null;
  onCancelReply: () => void;
  attachments: PendingAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onTyping: () => void;
  onStopTyping: () => void;
  disabled: boolean;
  isSending: boolean;
  isUploading: boolean;
  hasDraft: boolean;
  placeholder: string;
}) {
  const t = useTranslations("chat.direct");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled && !isSending && !isUploading;

  /* Resize on every value change, including when the parent swaps in another
     conversation's draft — not just on keystrokes, or a restored multi-line
     draft would render in a one-line box. */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = MAX_ROWS * LINE_HEIGHT_PX + VERTICAL_PADDING_PX;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value]);

  /* Focus the box when a reply is started, so the next keystroke goes where the
     user is looking. */
  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus();
  }, [replyingTo]);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onAddFiles(Array.from(files));
  };

  return (
    <div
      className="flex-none px-3 sm:px-5 py-3 border-t border-border-light/40 bg-bg-surface"
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        /* Only clear when the pointer actually leaves the composer — moving
           over a child fires dragleave on the parent too. */
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {replyingTo && (
        <div className="flex items-center gap-2.5 px-3 py-2 mb-2 rounded-xl bg-bg-secondary">
          <CornerUpLeft size={14} className="text-accent-primary flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-accent-primary uppercase tracking-wide">
              {t("replyingTo", { name: replyingTo.senderName ?? t("userFallback") })}
            </p>
            <p className="text-xs text-fg-tertiary truncate">
              {replyingTo.body.trim().length > 0
                ? replyingTo.body
                : replyingTo.attachments[0]?.name ?? t("attachment")}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label={t("cancelReply")}
            className="kairos-tap p-1 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-tertiary transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((item, idx) => (
            <div
              key={`${item.file.name}-${idx}`}
              className="flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-xl bg-bg-secondary ring-1 ring-border-light/50"
            >
              <span className="w-7 h-7 rounded-lg grid place-items-center bg-accent-primary/15 text-accent-primary flex-shrink-0">
                {isImageMime(item.file.type) ? <ImageIcon size={13} /> : <FileText size={13} />}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-fg-primary truncate max-w-[140px]">
                  {item.file.name}
                </span>
                <span className="block text-[10px] text-fg-tertiary">{formatFileSize(item.file.size)}</span>
              </span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(idx)}
                aria-label={t("removeAttachment", { name: item.file.name })}
                className="p-1 rounded-lg text-fg-tertiary hover:text-error transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={`flex items-end gap-2 rounded-2xl bg-bg-secondary px-2 py-2 ring-1 transition-colors focus-within:ring-accent-primary ${
          dragActive ? "ring-accent-primary" : "ring-border-light/50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            /* Reset so picking the same file twice in a row still fires change. */
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isUploading}
          aria-label={t("attachFiles")}
          className="p-2 rounded-xl text-accent-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50 flex-shrink-0"
        >
          <Paperclip size={18} />
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            /* An empty box is not typing — clearing the draft retracts the
               indicator rather than refreshing it. */
            if (e.target.value) onTyping();
            else onStopTyping();
          }}
          onBlur={onStopTyping}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          onPaste={(e) => {
            /* Pasted screenshots are the common case for sharing an image, and
               they arrive as clipboard files rather than text. */
            const files = Array.from(e.clipboardData.files);
            if (files.length > 0) {
              e.preventDefault();
              onAddFiles(files);
            }
          }}
          className="flex-1 bg-transparent text-sm text-fg-primary placeholder:text-fg-tertiary resize-none focus:outline-none py-1.5 leading-5 disabled:opacity-50"
        />

        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={t("send")}
          className="p-2.5 rounded-xl bg-gradient-to-br from-accent-primary to-accent-secondary text-white shadow-accent disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all flex-shrink-0"
        >
          {isUploading || isSending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>

      <div className="flex items-center justify-between px-1 pt-1.5">
        <span className="text-[10px] text-fg-quaternary">{t("sendHint")}</span>
        {hasDraft && <span className="text-[10px] text-fg-quaternary">{t("draftSaved")}</span>}
      </div>
    </div>
  );
}
