"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

type Translator = (key: string, values?: Record<string, unknown>) => string;

interface Props {
  draftId: string;
  kind: "tasks" | "notes";
  /** Lets the caller refresh the boards after a rollback. */
  onUndone?: () => void;
}

/**
 * Take back an applied plan.
 *
 * This is the oldest gap in the agent surface: `undoApply` and
 * `undoAvailability` have existed as procedures with no caller at all, so the
 * confidence the draft/confirm/apply lifecycle is supposed to buy — press Apply,
 * you can take it back — has never actually been available.
 *
 * The outcome is not binary and the UI must not pretend it is. Creates are
 * deleted and edits are restored from the before-image; deletes cannot be
 * reversed, because the row is gone and re-inserting it under a new id would
 * orphan every comment, activity entry and finding that pointed at the old one.
 * `notReversed` carries a sentence per case, written for exactly this panel.
 * Collapsing that into "Undone" would tell someone their data is back when part
 * of it is not, which is the worst thing this component could do.
 *
 * The button disappears when the window closes rather than erroring on click:
 * `UNDO_WINDOW_MS` is ten minutes, and an affordance that is still there but no
 * longer works is worse than one that is honestly gone.
 */
export function UndoApplyButton({ draftId, kind, onUndone }: Props) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("undo");

  const [result, setResult] = useState<{
    undone: {
      tasksDeleted: number;
      notesDeleted: number;
      tasksRestored: number;
      notesRestored: number;
    };
    notReversed: string[];
  } | null>(null);

  const availability = api.agent.undoAvailability.useQuery(
    { draftId },
    // Polled rather than computed from a client clock: the window is enforced
    // server-side against the apply row, and a client whose clock is off would
    // either hide a live button or offer a dead one.
    { retry: false, refetchInterval: 30_000, enabled: result === null },
  );

  const undo = api.agent.undoApply.useMutation({
    onSuccess: (res) => {
      setResult(res);
      onUndone?.();
    },
  });

  // Hide the button as the window lapses, without waiting for the next poll.
  const [expired, setExpired] = useState(false);
  const availableUntil = availability.data?.expiresAt ?? null;

  useEffect(() => {
    if (!availableUntil) return;
    const remaining = new Date(availableUntil).getTime() - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [availableUntil]);

  if (result) return <UndoOutcome result={result} t={t} />;

  if (expired || !availability.data?.available) return null;

  return (
    <button
      type="button"
      onClick={() => undo.mutate({ draftId, kind })}
      disabled={undo.isPending}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
    >
      <Undo2 className="h-3.5 w-3.5" />
      {undo.isPending ? t("undoing") : t("undo")}
    </button>
  );
}

/**
 * What came back.
 *
 * Green only when everything was reversed. The moment `notReversed` has anything
 * in it the panel is amber and leads with "partly" — the user needs to know their
 * data is not entirely as it was before they move on.
 */
function UndoOutcome({
  result,
  t,
}: {
  result: {
    undone: {
      tasksDeleted: number;
      notesDeleted: number;
      tasksRestored: number;
      notesRestored: number;
    };
    notReversed: string[];
  };
  t: Translator;
}) {
  const { undone, notReversed } = result;
  const removed = undone.tasksDeleted + undone.notesDeleted;
  const restored = undone.tasksRestored + undone.notesRestored;
  const partial = notReversed.length > 0;

  const parts = [
    restored > 0 ? t("restored", { count: restored }) : null,
    removed > 0 ? t("removed", { count: removed }) : null,
  ].filter(Boolean);

  return (
    <div
      className={`mt-2 rounded-lg border px-3 py-2 ${
        partial
          ? "border-amber-500/35 bg-amber-500/10"
          : "border-emerald-500/35 bg-emerald-500/10"
      }`}
    >
      <p className="text-xs font-semibold text-fg-primary">
        {partial ? t("partlyUndone") : t("undone")}
      </p>

      {parts.length > 0 ? (
        <p className="mt-0.5 text-[11px] text-fg-secondary">
          {parts.join(" · ")}
        </p>
      ) : null}

      {/*
        Rendered verbatim. These strings come from `describeIrreversible` in
        `undo.ts`, which is where the reasoning about what cannot be put back
        lives — paraphrasing them here would put that explanation in two places
        and let them drift.
      */}
      {notReversed.map((line) => (
        <p
          key={line}
          className="mt-1 text-[11px] leading-snug text-amber-700 dark:text-amber-300"
        >
          {line}
        </p>
      ))}
    </div>
  );
}
