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
import { ArrowUp, CornerUpLeft, FileText, ImageIcon, Loader2, Paperclip, X } from "~/components/ui/icons";

import { formatFileSize, isImageMime } from "./chatUi";
import type { ThreadMessage } from "./MessageBubble";

/** Height cap, in rows, before the box scrolls instead of growing. */
const MAX_ROWS = 6;
const LINE_HEIGHT_PX = 22;
const VERTICAL_PADDING_PX = 0;

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
  replyingName,
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
  /** Who the reply is to, as the thread names them — "yourself" for your own. */
  replyingName?: string;
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
      className="flex flex-none flex-col gap-2.5 border-t border-tui-ink/8 px-4 pt-3.5 pb-5 sm:px-6"
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
        <div className="chat-rise flex items-center gap-3 rounded-[10px] border border-tui-ink/16 bg-tui-ink/[0.025] py-[9px] pr-2.5 pl-3.5">
          <CornerUpLeft size={14} className="flex-none text-tui-accent" />
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <p className="text-[12px] font-medium text-tui-ink2">
              {t("replyingTo", { name: replyingName ?? replyingTo.senderName ?? t("userFallback") })}
            </p>
            <p className="truncate text-[13px] text-tui-ink3">
              {replyingTo.body.trim().length > 0
                ? replyingTo.body
                : replyingTo.attachments[0]?.name ?? t("attachment")}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label={t("cancelReply")}
            className="kairos-tap grid h-7 w-7 flex-none place-items-center rounded-full border border-tui-ink/16 text-tui-ink2 transition-colors hover:bg-tui-accent/6"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div
        className={`flex flex-col gap-2 rounded-xl border bg-tui-bg pt-3 pr-3 pb-2.5 pl-4 transition-colors focus-within:border-tui-accent/45 ${
          dragActive ? "border-tui-accent/45" : "border-tui-ink/16"
        }`}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((item, idx) => (
              <span
                key={`${item.file.name}-${idx}`}
                className="flex h-[30px] max-w-full items-center gap-2 rounded-full border border-tui-ink/16 pr-1.5 pl-[11px] text-[12.5px] text-tui-ink2"
              >
                {isImageMime(item.file.type) ? (
                  <ImageIcon size={12} className="flex-none text-tui-ink3" />
                ) : (
                  <FileText size={12} className="flex-none text-tui-ink3" />
                )}
                <span className="truncate">
                  {item.file.name} · {formatFileSize(item.file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(idx)}
                  aria-label={t("removeAttachment", { name: item.file.name })}
                  className="kairos-tap grid h-5 w-5 flex-none place-items-center rounded-full text-tui-ink3 transition-colors hover:text-tui-danger"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

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

        <textarea
          ref={textareaRef}
          value={value}
          rows={2}
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
          className="w-full resize-none border-0 bg-transparent p-0 text-[14.5px] leading-normal text-tui-ink outline-none placeholder:text-tui-ink3 disabled:opacity-50"
        />

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isUploading}
            aria-label={t("attachFiles")}
            title={t("attachFiles")}
            className="kairos-tap grid h-8 w-8 flex-none place-items-center rounded-full border border-tui-ink/16 text-tui-ink2 transition-colors hover:bg-tui-accent/6 disabled:opacity-50"
          >
            <Paperclip size={14} />
          </button>
          <span className="min-w-0 flex-1 truncate text-[12px] text-tui-ink3">
            {hasDraft ? t("draftSaved") : t("sendHint")}
          </span>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className={`flex h-[34px] flex-none items-center gap-[7px] rounded-full border px-[15px] text-[13px] font-semibold transition-colors duration-200 ${
              canSend
                ? "cursor-pointer border-tui-accent bg-tui-accent text-tui-on-accent"
                : "cursor-default border-tui-ink/16 bg-transparent text-tui-ink3"
            }`}
          >
            {t("send")}
            {isUploading || isSending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ArrowUp size={13} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
