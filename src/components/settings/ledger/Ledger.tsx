"use client";

/**
 * The /settings ledger.
 *
 * Every section on this page used to wrap each individual field in its own
 * bordered card, so a screen of eight preferences read as eight boxes with one
 * sentence each. The ledger drops the cards: a section is a stack of groups, a
 * group is a label column beside a column of hairline rows, and a row is one
 * setting. Nothing here draws a border except the hairline between rows.
 *
 * Two behaviours come with the shape:
 *
 * - **Save on change.** No section has a Save button. A control writes when you
 *   touch it and a text field writes when you stop typing; the header says which
 *   of those is happening. See `useSettingsSave`.
 * - **One filter across every section.** `SettingsFilterProvider` holds the
 *   query typed above the rail. Groups and rows are data, not children, so a
 *   group can decide for itself whether anything inside it matched and hide
 *   itself when nothing did — which is also what gives the rail its per-section
 *   match counts without a registry.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

/** `useTranslations` typed loosely, matching how the rest of settings uses it. */
type Translator = (key: string, values?: Record<string, unknown>) => string;

/** "Settings — Notifications", for a section's eyebrow. */
export function useSectionCrumb(sectionId: string): string {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("settings");
  return `${t("title")} — ${t(`nav.${sectionId}`)}`;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

const FilterContext = createContext<string>("");

export function SettingsFilterProvider({
  query,
  children,
}: {
  query: string;
  children: ReactNode;
}) {
  const normalized = useMemo(() => query.trim().toLowerCase(), [query]);
  return (
    <FilterContext.Provider value={normalized}>{children}</FilterContext.Provider>
  );
}

export function useSettingsFilter(): string {
  return useContext(FilterContext);
}

// ---------------------------------------------------------------------------
// Match counts
//
// The rail shows, per section, how many rows the current filter matched. The
// count has to come from the rows themselves — a section's row count is not
// static (Workspace grows a row per member) and a parallel manifest of labels
// would drift from the rows it claims to describe the first time one is renamed.
//
// So groups report upward: each `LedgerGroup` tells its enclosing
// `SectionMatchScope` how many rows it is showing, the scope sums its groups,
// and the workspace above collects one number per section.
// ---------------------------------------------------------------------------

type ReportFn = (key: string, count: number) => void;

const ReportContext = createContext<ReportFn | null>(null);

/** Collects `sectionId -> matching row count` for the rail. */
export function SectionMatchCollector({
  onChange,
  children,
}: {
  onChange: (counts: Record<string, number>) => void;
  children: ReactNode;
}) {
  const counts = useRef<Record<string, number>>({});
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const report = useCallback<ReportFn>((key, count) => {
    if (counts.current[key] === count) return;
    counts.current = { ...counts.current, [key]: count };
    onChangeRef.current(counts.current);
  }, []);

  return <ReportContext.Provider value={report}>{children}</ReportContext.Provider>;
}

/** True when `haystack` matches the active query, or when there is no query. */
export function matches(query: string, ...haystack: (string | undefined | null)[]) {
  if (!query) return true;
  return haystack.filter(Boolean).join(" ").toLowerCase().includes(query);
}

// ---------------------------------------------------------------------------
// Save status
// ---------------------------------------------------------------------------

export type SaveState = "idle" | "saving" | "saved" | "error";

interface SaveApi {
  state: SaveState;
  /** Wraps a mutation so the header reports it. Never throws. */
  run: <T>(work: () => Promise<T>) => Promise<T | undefined>;
}

const SaveContext = createContext<SaveApi>({
  state: "idle",
  run: async (work) => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  },
});

export function SettingsSaveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SaveState>("idle");
  // Counts in-flight writes rather than tracking a single one: touching three
  // toggles quickly must not let the first one's completion report "saved"
  // while the other two are still open.
  const inFlight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const run = useCallback(async <T,>(work: () => Promise<T>) => {
    if (timer.current) clearTimeout(timer.current);
    inFlight.current += 1;
    setState("saving");
    try {
      const result = await work();
      inFlight.current -= 1;
      if (inFlight.current === 0) setState("saved");
      return result;
    } catch {
      inFlight.current -= 1;
      if (inFlight.current === 0) setState("error");
      return undefined;
    }
  }, []);

  return (
    <SaveContext.Provider value={{ state, run }}>{children}</SaveContext.Provider>
  );
}

export function useSettingsSave(): SaveApi {
  return useContext(SaveContext);
}

/**
 * A text field that writes when you stop typing.
 *
 * Returns the live value and an onChange, and calls `commit` once the value has
 * been still for `delay`. The baseline is re-synced whenever the persisted value
 * changes from elsewhere, so a value arriving from the server does not get
 * echoed straight back at it.
 */
export function useDebouncedCommit(
  persisted: string,
  commit: (next: string) => void | Promise<unknown>,
  delay = 700,
) {
  const [value, setValue] = useState(persisted);
  const baseline = useRef(persisted);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (persisted === baseline.current) return;
    baseline.current = persisted;
    setValue(persisted);
  }, [persisted]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onChange = useCallback(
    (next: string) => {
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (next === baseline.current) return;
        baseline.current = next;
        void commitRef.current(next);
      }, delay);
    },
    [delay],
  );

  /** Commit immediately — for blur, or Enter. */
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (value === baseline.current) return;
    baseline.current = value;
    void commitRef.current(value);
  }, [value]);

  return { value, onChange, flush };
}

// ---------------------------------------------------------------------------
// Rows and groups
// ---------------------------------------------------------------------------

export interface LedgerRow {
  id: string;
  title: string;
  /** Sits under the control, in the right-hand column. */
  desc?: ReactNode;
  /** Matched by the filter but never displayed — synonyms, column names. */
  keywords?: string;
  /** Plain text used for filtering when `desc` is a node rather than a string. */
  descText?: string;
  /** Left of the title. A member avatar, a status dot. */
  leading?: ReactNode;
  /** The control column: a toggle, a value, an action, an input. */
  control?: ReactNode;
  danger?: boolean;
  dim?: boolean;
  /** Dropped to 45% and made inert, e.g. while the master switch is off. */
  muted?: boolean;
}

export interface LedgerGroupProps {
  label: string;
  hint?: string;
  /** A hairline-separated closing sentence, for a caveat the rows cannot carry. */
  note?: string;
  rows?: LedgerRow[];
  /**
   * Content that will not fit a row — a members list, a permissions grid, a
   * delivery log. Rendered in the right-hand column under the rows, and hidden
   * when a filter is active unless the group's own label or hint matched.
   */
  block?: ReactNode;
}

/**
 * Lifts a node into place the first time it scrolls into view.
 *
 * A settings section is a tall stack of groups, most of them below the fold, so
 * arriving at one used to mean the whole ledger was simply *there* the instant
 * the section mounted. Revealing each group as it crosses into view instead
 * gives the scroll something to do without turning it into an effect: the
 * observer fires per element, not per scroll frame.
 *
 * The reveal is one-way — once a group is seen it is unobserved and stays put,
 * so scrolling back up does not replay anything. When `IntersectionObserver` is
 * missing the node is marked visible immediately; the un-revealed state is
 * opacity 0, and a group nobody can read is worse than one that never animated.
 */
function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // A little early and a little short: the group starts moving just before
      // its top edge arrives, and a group taller than the viewport still counts
      // as seen.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return { ref, visible };
}

export function LedgerGroup({ label, hint, note, rows = [], block }: LedgerGroupProps) {
  const query = useSettingsFilter();
  const report = useContext(ReportContext);
  const groupKey = useId();
  const { ref: revealRef, visible } = useRevealOnScroll<HTMLDivElement>();

  const groupMatched = matches(query, label, hint);
  const visibleRows = groupMatched
    ? rows
    : rows.filter((r) =>
        matches(query, r.title, r.descText ?? textOf(r.desc), r.keywords),
      );

  const shown = visibleRows.length;
  useEffect(() => {
    report?.(groupKey, shown);
  }, [report, groupKey, shown]);
  useEffect(
    () => () => {
      report?.(groupKey, 0);
    },
    [report, groupKey],
  );

  if (query && !groupMatched && visibleRows.length === 0) return null;

  return (
    <div
      ref={revealRef}
      className={`settings-reveal flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-12 ${
        visible ? "is-visible" : ""
      }`}
    >
      <div className="flex w-full flex-col gap-1.5 pt-0.5 lg:w-[220px] lg:flex-none">
        <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg-primary">
          {label}
        </span>
        {hint ? (
          <span className="text-[12px] leading-[1.5] text-fg-tertiary">{hint}</span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {visibleRows.map((row) => (
          <LedgerRowView key={row.id} row={row} />
        ))}
        {block && (groupMatched || !query) ? (
          <div className="border-t border-border-light pt-4">{block}</div>
        ) : null}
        {note ? (
          <div className="max-w-[680px] border-t border-border-light pt-3.5 text-[12.5px] leading-[1.5] text-fg-tertiary">
            {note}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LedgerRowView({ row }: { row: LedgerRow }) {
  return (
    <div
      className={`flex flex-col gap-2 border-t border-border-light py-4 sm:flex-row sm:items-center sm:gap-8 ${
        row.muted ? "pointer-events-none opacity-45" : ""
      }`}
    >
      <div className="flex w-full items-center gap-3 sm:w-[300px] sm:flex-none">
        {row.leading}
        <span
          className={`text-[14px] font-medium tracking-[-0.01em] ${
            row.danger ? "text-error" : row.dim ? "text-fg-tertiary" : "text-fg-primary"
          }`}
        >
          {row.title}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {row.control ? (
          <div className="flex flex-wrap items-center gap-3">{row.control}</div>
        ) : null}
        {row.desc ? (
          <span className="max-w-[620px] text-[12.5px] leading-[1.45] text-fg-tertiary">
            {row.desc}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Best-effort plain text from a desc node, so filtering still sees literals. */
function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return "";
}

// ---------------------------------------------------------------------------
// Section frame
// ---------------------------------------------------------------------------

/**
 * One settings section.
 *
 * Doubles as the match scope for the rail's counters, because it is the only
 * component that both knows its section id and encloses every group in it.
 * While a filter is active the section drops its heading — the workspace above
 * supplies a single "Filter results" one — and keeps a small eyebrow so a row
 * pulled out of Developer is not mistaken for one from Security.
 */
export function LedgerSection({
  sectionId,
  crumb,
  title,
  subtitle,
  children,
}: {
  sectionId: string;
  crumb: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const query = useSettingsFilter();
  const parentReport = useContext(ReportContext);
  const counts = useRef(new Map<string, number>());
  const [total, setTotal] = useState(0);

  const report = useCallback<ReportFn>((key, count) => {
    counts.current.set(key, count);
    let sum = 0;
    counts.current.forEach((n) => {
      sum += n;
    });
    setTotal(sum);
  }, []);

  useEffect(() => {
    parentReport?.(sectionId, total);
  }, [parentReport, sectionId, total]);
  useEffect(
    () => () => {
      parentReport?.(sectionId, 0);
    },
    [parentReport, sectionId],
  );

  const filtering = query.length > 0;
  const hidden = filtering && total === 0;

  return (
    <ReportContext.Provider value={report}>
      <div className={`flex flex-col gap-10 ${hidden ? "hidden" : ""}`}>
        {filtering ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-primary">
            {title}
          </span>
        ) : (
          <div className="flex flex-col gap-4 border-b border-border-light pb-5 sm:flex-row sm:items-end sm:gap-5">
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-tertiary">
                {crumb}
              </span>
              <h1 className="m-0 text-[29px] font-semibold leading-none tracking-[-0.025em] text-fg-primary">
                {title}
              </h1>
            </div>
            <span className="flex-1" />
            {subtitle ? (
              <span className="max-w-[420px] text-[13.5px] text-fg-secondary sm:text-right">
                {subtitle}
              </span>
            ) : null}
          </div>
        )}
        {children}
      </div>
    </ReportContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function LedgerToggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[26px] w-[44px] flex-none rounded-full border transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50 ${
        checked ? "border-transparent bg-accent-primary" : "border-border-medium bg-bg-tertiary"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${
          checked ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function LedgerValue({
  children,
  mono,
  tone = "default",
}: {
  children: ReactNode;
  mono?: boolean;
  tone?: "default" | "good" | "dim" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-success"
      : tone === "bad"
        ? "text-error"
        : tone === "dim"
          ? "text-fg-tertiary"
          : "text-fg-secondary";
  return (
    <span
      className={`text-[13.5px] ${toneClass} ${
        mono ? "font-mono tracking-[0.08em]" : "tracking-[-0.01em]"
      }`}
    >
      {children}
    </span>
  );
}

export function LedgerAction({
  children,
  onClick,
  href,
  danger,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const className = `rounded-[7px] border px-[13px] py-1.5 text-[12.5px] font-medium transition-colors ${
    danger
      ? "border-error/35 text-error hover:bg-error/10"
      : "border-border-medium text-fg-primary hover:bg-bg-tertiary"
  } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`;

  if (href) {
    return (
      <a href={href} title={title} className={className}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );
}

export function LedgerInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  type = "text",
  mono,
  maxLength,
  disabled,
  ariaLabel,
  width = "w-[280px]",
  inputMode,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  maxLength?: number;
  disabled?: boolean;
  ariaLabel: string;
  width?: string;
  inputMode?: "text" | "numeric" | "email";
}) {
  return (
    <input
      type={type}
      value={value}
      aria-label={ariaLabel}
      inputMode={inputMode}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={`${width} max-w-full rounded-[10px] border border-border-medium bg-bg-secondary px-2.5 py-1.5 text-[13.5px] text-fg-primary outline-none transition-colors placeholder:text-fg-quaternary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 disabled:opacity-50 ${
        mono ? "font-mono tracking-[0.08em]" : ""
      }`}
    />
  );
}

export function LedgerTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength,
  disabled,
  ariaLabel,
  rows = 3,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  ariaLabel: string;
  rows?: number;
}) {
  return (
    <textarea
      rows={rows}
      value={value}
      aria-label={ariaLabel}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className="w-full max-w-[420px] resize-none rounded-[10px] border border-border-medium bg-bg-secondary px-2.5 py-1.5 text-[13.5px] leading-[1.5] text-fg-primary outline-none transition-colors placeholder:text-fg-quaternary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 disabled:opacity-50"
    />
  );
}

export function LedgerSelect<T extends string | number>({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
  width = "w-[280px]",
}: {
  value: T;
  onChange: (next: string) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  disabled?: boolean;
  ariaLabel: string;
  width?: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} max-w-full cursor-pointer rounded-[10px] border border-border-medium bg-bg-secondary px-2.5 py-1.5 text-[13.5px] text-fg-primary outline-none transition-colors focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {options.map((o) => (
        <option
          key={String(o.value)}
          value={o.value}
          disabled={o.disabled}
          className="bg-bg-elevated text-fg-primary"
        >
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A radio, as a row control.
 *
 * The mock draws this as a bare tick that is simply absent when unselected,
 * which reads as decoration rather than a control — there is nothing to aim at
 * and nothing to say the row is choosable at all. So the ring is always drawn
 * and the tick fills it.
 *
 * `label` is the accessible name. Pass `showLabel` only where the row's own
 * title is not already the option's name; on the theme rows it would print
 * "Light" twice.
 */
export function LedgerCheck({
  checked,
  onClick,
  label,
  showLabel,
  readOnly,
}: {
  checked: boolean;
  onClick?: () => void;
  label: string;
  showLabel?: boolean;
  readOnly?: boolean;
}) {
  const body = (
    <>
      <span
        aria-hidden
        className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border transition-colors ${
          checked ? "border-accent-primary bg-accent-primary" : "border-border-strong"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`h-[11px] w-[11px] text-white transition-opacity ${
            checked ? "opacity-100" : "opacity-0"
          }`}
        >
          <path
            d="M20 6 9 17l-5-5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {showLabel ? (
        <span className={`text-[13px] ${checked ? "text-fg-primary" : "text-fg-tertiary"}`}>
          {label}
        </span>
      ) : null}
    </>
  );

  if (readOnly) {
    return (
      <span className="flex items-center gap-2.5" aria-label={label}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50"
    >
      {body}
    </button>
  );
}

export function LedgerSwatches({
  options,
  current,
  onSelect,
}: {
  options: { id: string; name: string; cssVar: string }[];
  current: string;
  onSelect: (id: string) => void;
}) {
  return (
    <span className="flex items-center gap-2.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.name}
          aria-label={o.name}
          aria-pressed={current === o.id}
          onClick={() => onSelect(o.id)}
          className="h-5 w-5 cursor-pointer rounded-full border-0 p-0 outline-offset-[3px] transition-[outline-color]"
          style={{
            backgroundColor: `rgb(var(${o.cssVar}))`,
            outline: `2px solid ${current === o.id ? `rgb(var(${o.cssVar}))` : "transparent"}`,
          }}
        />
      ))}
    </span>
  );
}

/** A one-line inline error, for a control that refused. */
export function LedgerError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <span className="text-[12.5px] leading-[1.45] text-error">{children}</span>;
}
