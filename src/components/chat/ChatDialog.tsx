"use client";

/**
 * The dialog shell the chat surface shares — New chat, Clear history, Leave.
 *
 * Behaviour (portal, focus trap, Escape, scroll lock, focus restore) comes from
 * `Modal`, like every dialog in the app. The chrome is the refined chat
 * language: a toned icon disc, a spaced-caps eyebrow over a serif title, and a
 * tinted footer that carries a one-line consequence beside the actions.
 */

import { useCallback, useId, type ReactNode } from "react";
import { X } from "~/components/ui/icons";

import { Modal } from "~/components/ui/Modal";
import { CHAT_EYEBROW, CHAT_ICON_BUTTON } from "./chatUi";

export type ChatDialogTone = "accent" | "warn" | "danger";

const TONE: Record<ChatDialogTone, { disc: string; primary: string }> = {
  accent: {
    disc: "border-tui-accent/45 text-tui-accent",
    primary: "border-tui-accent bg-tui-accent text-tui-on-accent hover:brightness-110",
  },
  warn: {
    disc: "border-tui-warn/40 text-tui-warn",
    primary: "border-tui-warn/40 bg-transparent text-tui-warn hover:bg-tui-warn/8",
  },
  danger: {
    disc: "border-tui-danger/40 text-tui-danger",
    primary: "border-tui-danger/40 bg-tui-danger/8 text-tui-danger hover:bg-tui-danger/14",
  },
};

export function ChatDialog({
  icon,
  tone = "accent",
  eyebrow,
  title,
  sub,
  foot,
  cancelLabel,
  closeLabel,
  primary,
  onDismiss,
  widthClass = "w-[480px]",
  role = "dialog",
  children,
}: {
  icon: ReactNode;
  tone?: ChatDialogTone;
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  /** The quiet line in the footer — what happens next, or what cannot be undone. */
  foot?: ReactNode;
  cancelLabel: string;
  closeLabel: string;
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  onDismiss: () => void;
  widthClass?: string;
  role?: "dialog" | "alertdialog";
  children?: ReactNode;
}) {
  const titleId = useId();
  const subId = useId();
  const toneCls = TONE[tone];

  /* `Modal` portals its content in a render after its own, so an effect here
     would run before the card exists. A ref callback runs when it lands: focus
     goes to whatever the dialog marked as its starting point — the search box
     in New chat, the confirm button in a confirmation. */
  const cardRef = useCallback((node: HTMLDivElement | null) => {
    node?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  return (
    <Modal
      role={role}
      labelledBy={titleId}
      describedBy={sub ? subId : undefined}
      onDismiss={onDismiss}
      overlayClassName="bg-black/45 backdrop-blur-[3px] chat-fade-in"
    >
      <div
        ref={cardRef}
        className={`${widthClass} chat-dialog-in flex max-h-[88dvh] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-tui-ink/10 bg-tui-pane text-tui-ink shadow-[var(--tui-lift)]`}
      >
        <div className="flex flex-none items-start gap-4 px-5 pt-6 sm:pr-[22px] sm:pl-[26px]">
          <span
            className={`grid h-[42px] w-[42px] flex-none place-items-center rounded-full border ${toneCls.disc}`}
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[5px] pt-px">
            {eyebrow ? <span className={`${CHAT_EYEBROW} tracking-[0.16em]`}>{eyebrow}</span> : null}
            <h2 id={titleId} className="font-display text-[27px] leading-[1.15] tracking-[-0.01em]">
              {title}
            </h2>
            {sub ? (
              <p id={subId} className="text-[14px] leading-normal text-pretty text-tui-ink2">
                {sub}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={closeLabel}
            className={`${CHAT_ICON_BUTTON} h-8 w-8`}
          >
            <X size={13} />
          </button>
        </div>

        {children}

        <div className="mt-[22px] flex flex-none items-center gap-2.5 border-t border-tui-ink/8 bg-tui-ink/[0.025] px-5 py-4 sm:pr-[22px] sm:pl-[26px]">
          <span className="flex-1 text-[12.5px] text-tui-ink3">{foot}</span>
          <button
            type="button"
            onClick={onDismiss}
            className="h-9 rounded-full border border-tui-ink/16 bg-transparent px-4 text-[13px] font-medium text-tui-ink transition-colors hover:bg-tui-accent/6"
          >
            {cancelLabel}
          </button>
          {primary ? (
            <button
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled}
              data-autofocus
              className={`h-9 rounded-full border px-4 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneCls.primary}`}
            >
              {primary.label}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
