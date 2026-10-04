"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Brain } from "~/components/ui/icons";

import { ComposerMenu } from "./ComposerMenu";

/**
 * How hard the model thinks before it answers.
 *
 * Mirrors `USER_REASONING_EFFORTS` in `server/llm/core/effortScope.ts`, which
 * is `server-only` and cannot be imported here. The server validates the value
 * and treats anything it does not recognise as the default.
 */
export const REASONING_EFFORTS = ["low", "medium", "high", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Leave it to the server: the configured effort, and the cheap routing pass. */
export const AUTO_EFFORT = "__auto__";

const STORAGE_KEY = "kairos-chat-effort";

function isEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === "string" &&
    (REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

/**
 * The user's pick, remembered across reloads and shared by the page and the
 * widget.
 *
 * Unlike the agent pin, this is a preference about *how* the assistant works
 * rather than about one message, so a user who wants deep answers should not
 * have to ask for them again every time the page opens. Read after mount, not
 * in the initial state, so the server render and the first client render agree.
 */
export function useReasoningEffort() {
  const [selected, setSelected] = useState<string>(AUTO_EFFORT);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isEffort(stored)) setSelected(stored);
    } catch {
      /* private mode — the default is fine */
    }
  }, []);

  const select = useCallback((id: string) => {
    const next = isEffort(id) ? id : AUTO_EFFORT;
    setSelected(next);
    try {
      if (next === AUTO_EFFORT) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* noop */
    }
  }, []);

  /** What to send: undefined for Auto. */
  const effort = isEffort(selected) ? selected : undefined;

  return { selected, effort, select };
}

interface Props {
  selected: string;
  onSelect: (id: string) => void;
  /** The widget's chips carry a smaller glyph. */
  iconClassName?: string;
}

export function EffortMenu({
  selected,
  onSelect,
  iconClassName = "h-3.5 w-3.5 shrink-0",
}: Props) {
  const t = useTranslations("agents");

  const label = isEffort(selected)
    ? t(`effort.${selected}`)
    : t("effort.auto");

  return (
    <ComposerMenu
      title={t("effort.title")}
      label={label}
      icon={<Brain className={iconClassName} />}
      selected={selected}
      onSelect={onSelect}
      options={[
        {
          id: AUTO_EFFORT,
          label: t("effort.auto"),
          description: t("effort.autoDescription"),
        },
        ...REASONING_EFFORTS.map((id) => ({
          id,
          label: t(`effort.${id}`),
          description: t(`effort.${id}Description`),
        })),
      ]}
    />
  );
}
