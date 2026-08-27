"use client";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

type Translator = (key: string, values?: Record<string, unknown>) => string;

interface Props {
  draftId: string;
}

/**
 * What a task plan will actually change, field by field, before it is confirmed.
 *
 * Two things distinguish this from the `diffPreview` the model already returns in
 * its plan, and the second is the reason this component exists.
 *
 * The model's preview is a set of sentences it wrote *about its own plan* —
 * "moved the due date out a fortnight". Useful, and unverified: nothing checks it
 * against the rows. This reads the current state of every task the plan names and
 * computes the difference, so what the user approves is what will happen rather
 * than what the model believes will happen.
 *
 * The second: it is computed now, not at draft time. A plan written two minutes
 * ago may already be stale — a colleague edited the task, or deleted it — and a
 * preview cached with the draft would confidently describe a change that is no
 * longer possible. `missing` is rendered for exactly that case, because a card
 * that silently drops a row promises more than the apply will do.
 *
 * Undo answers "that was wrong". This prevents the moment, which is worth more:
 * reviewing thirty proposed edits properly is work most people will skim, and the
 * skim is only safe if it shows the diff rather than a count.
 */
export function PlanDiffCard({ draftId }: Props) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("planDiff");

  const diff = api.agent.taskPlanDiff.useQuery(
    { draftId },
    { retry: false, staleTime: 0 },
  );

  // Silent while loading and silent on failure. This sits above a working
  // confirm button, so a spinner or an error banner would make a healthy plan
  // look broken over a preview that is an enhancement, not a prerequisite.
  if (diff.isLoading || diff.isError) return null;

  const data = diff.data;
  if (!data || (data.rows.length === 0 && data.missing.length === 0)) return null;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {data.rows.map((row, index) => (
        <div
          key={`${row.kind}-${row.id ?? index}`}
          className="overflow-hidden rounded-lg border border-border-light bg-bg-secondary"
        >
          <div className="flex items-center gap-2 border-b border-border-light px-2.5 py-1.5">
            <KindBadge kind={row.kind} t={t} />
            <span className="min-w-0 truncate text-xs font-semibold text-fg-primary">
              {row.label}
            </span>
          </div>

          {row.changes.length > 0 ? (
            <dl className="divide-y divide-border-light">
              {row.changes.map((change) => (
                <div
                  key={change.field}
                  className="grid grid-cols-[88px_1fr] items-baseline gap-2 px-2.5 py-1.5"
                >
                  <dt className="kairos-stamp text-[9.5px] text-fg-tertiary">
                    {change.field}
                  </dt>
                  <dd className="text-[11.5px]">
                    <span className="text-fg-tertiary line-through decoration-red-500/50">
                      {format(change.before, t)}
                    </span>
                    <span aria-hidden className="px-1.5 text-fg-quaternary">
                      →
                    </span>
                    <span className="font-semibold text-fg-primary">
                      {format(change.after, t)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ))}

      {/*
        Not decoration. `missing` means the plan names a task that no longer
        exists, so the apply will skip it — and without saying so the count above
        the button is a promise the apply cannot keep.
      */}
      {data.missing.length > 0 ? (
        <p className="px-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          {t("missing", { count: data.missing.length })}
        </p>
      ) : null}
    </div>
  );
}

function KindBadge({
  kind,
  t,
}: {
  kind: "create" | "update" | "delete";
  t: Translator;
}) {
  const tone =
    kind === "create"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : kind === "delete"
        ? "bg-red-500/15 text-red-600 dark:text-red-400"
        : "bg-sky-500/15 text-sky-600 dark:text-sky-400";

  return (
    <span
      className={`kairos-stamp shrink-0 rounded px-1.5 py-0.5 text-[9px] ${tone}`}
    >
      {t(kind)}
    </span>
  );
}

/**
 * Render one side of a change.
 *
 * `null` becomes a word rather than an empty cell: a blank on the left of an
 * arrow reads as a rendering bug, where "not set" is a fact about the row.
 * ISO timestamps are shortened to a date, since the planner only ever moves days
 * and a full timestamp buries the part that changed.
 */
function format(value: string | number | null, t: Translator): string {
  if (value === null) return t("notSet");
  if (typeof value === "number") return String(value);

  const asDate = /^\d{4}-\d{2}-\d{2}T/.exec(value);
  if (asDate) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString();
  }

  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}
