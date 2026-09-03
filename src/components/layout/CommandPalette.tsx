"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import {
  eventHref,
  noteHref,
  projectHref,
  projectTasksHref,
} from "~/lib/routes";

/**
 * D-2 — ⌘K / Ctrl-K.
 *
 * Type anything. If it matches somewhere to go, it navigates; if it does not, it
 * becomes a question for the assistant. That fallback is the entire idea: the
 * failure mode of every command palette is "I typed what I wanted and it found
 * nothing", and here that is precisely the case the assistant is good at.
 *
 * Two rules keep it honest:
 *
 * - **Navigation never calls the model.** Static destinations and the user's own
 *   projects are matched locally, so the common case is instant and free.
 * - **Asking is always explicit.** The AI row is something you select, never
 *   something that fires because nothing else matched. A palette that silently
 *   spends a request from a daily quota is a palette people stop trusting.
 *
 * Below the destinations sit the workspace's own contents — tasks, projects,
 * notes, events, comments — from `search.workspace`. Navigation is still local
 * and instant; the search is debounced and only runs once there is something
 * worth searching for. It is the third tier, between "somewhere to go" and
 * "ask the assistant".
 */

type Translator = (key: string, values?: Record<string, unknown>) => string;

interface Destination {
  id: string;
  label: string;
  href: string;
  hint?: string;
}

/**
 * How long the closing animation runs. Kept in step with
 * `.command-palette-panel--out` in `globals.css`: the palette stays mounted for
 * exactly this long after it is dismissed so the exit can be seen.
 */
const CLOSE_MS = 150;

/** Case- and accent-insensitive contains, so "проект" matches sensibly too. */
function matches(haystack: string, needle: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  return norm(haystack).includes(norm(needle));
}

export function CommandPalette({
  /**
   * Whether to come up already open.
   *
   * The palette is loaded lazily (see `GlobalAIWidget`), so the ⌘K press that
   * asks for it happens before this component exists — there is no listener of
   * its own to catch it. The host arms this on that first press; every press
   * after it is handled by the listener below, which is mounted by then.
   */
  initialOpen = false,
}: {
  initialOpen?: boolean;
} = {}) {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("ai.palette");
  const router = useRouter();

  const [open, setOpen] = useState(initialOpen);
  /* Dismissed, but still on screen playing its exit. `open` stays true for
     these few frames — unmounting on the click would skip the animation. */
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only fetched once the palette is opened: a list nobody has asked to see is
  // not worth a query on every page load. Across organizations, not just the
  // active one — jumping between workspaces is exactly what a palette is for.
  const projects = api.project.getAllProjectsAcrossOrgs.useQuery(undefined, {
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
  });

  /* Debounced, because this one is a real query across five tables and the
     input fires on every keystroke. The destinations above stay instant —
     they are matched in memory and never wait for this. */
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(timer);
  }, [query]);

  const search = api.search.workspace.useQuery(
    { query: debounced, limit: 12 },
    {
      // Two characters is `searchWorkspace`'s own floor; below it the query
      // would be refused anyway.
      enabled: open && debounced.length >= 2,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  );

  const staticDestinations = useMemo<Destination[]>(
    () => [
      { id: "nav:dashboard", label: t("dashboard"), href: "/dashboard" },
      { id: "nav:projects", label: t("projects"), href: "/projects" },
      { id: "nav:tasks", label: t("tasks"), href: "/progress" },
      { id: "nav:calendar", label: t("calendar"), href: "/calendar" },
      { id: "nav:notes", label: t("notes"), href: "/notes" },
      { id: "nav:events", label: t("events"), href: "/publish" },
      { id: "nav:chat", label: t("assistant"), href: "/chat/ai" },
      { id: "nav:settings", label: t("settings"), href: "/settings" },
    ],
    [t],
  );

  const results = useMemo<Destination[]>(() => {
    const projectRows: Destination[] = (projects.data ?? []).map((p) => ({
      id: `project:${String(p.id)}`,
      label: p.title,
      href: projectHref(p.id),
      hint: t("project"),
    }));

    const all = [...staticDestinations, ...projectRows];
    if (!query.trim()) return all.slice(0, 8);

    return all.filter((d) => matches(d.label, query.trim())).slice(0, 8);
  }, [projects.data, query, staticDestinations, t]);

  /* Search hits become the same shape as a destination, so one keyboard model
     covers all three tiers rather than three overlapping ones. */
  const hits = useMemo<Destination[]>(() => {
    if (!search.data) return [];

    return search.data.map((hit) => {
      const href =
        hit.kind === "note"
          ? noteHref(hit.id)
          : hit.kind === "event"
            ? eventHref(hit.id)
            : hit.kind === "project"
              ? projectHref(hit.id)
              : /* task and comment both live on a project's board */
                projectTasksHref(hit.projectId ?? 0);

      return {
        id: `hit:${hit.kind}:${String(hit.id)}`,
        label: hit.title,
        href,
        hint: t(`kind.${hit.kind}`),
      };
    });
  }, [search.data, t]);

  /* The destinations already surface projects by name, so a project matched by
     its title would otherwise appear twice. */
  const dedupedHits = useMemo(
    () => hits.filter((hit) => !results.some((r) => r.href === hit.href)),
    [hits, results],
  );

  /** The assistant row sits at the end, and is the only row when nothing matches. */
  const rows = useMemo(() => [...results, ...dedupedHits], [results, dedupedHits]);
  const askIndex = rows.length;
  const hasQuery = query.trim().length > 0;
  const rowCount = rows.length + (hasQuery ? 1 : 0);

  const close = useCallback(() => setClosing(true), []);

  /* Re-opening mid-exit has to cancel the pending teardown, or the palette
     would open and then wipe its own query a moment later. */
  const openPalette = useCallback(() => {
    setClosing(false);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      setClosing(false);
      setOpen(false);
      setQuery("");
      setActiveIndex(0);
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  const go = useCallback(
    (index: number) => {
      if (hasQuery && index === askIndex) {
        // Hand the raw text to the assistant. `prefill` is read by the chat page
        // and sent as the first message.
        router.push(`/chat/ai?prefill=${encodeURIComponent(query.trim())}`);
        close();
        return;
      }
      const destination = rows[index];
      if (!destination) return;
      router.push(destination.href);
      close();
    },
    [askIndex, close, hasQuery, query, rows, router],
  );

  // ⌘K / Ctrl-K to open, Escape to close.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open && !closing) close();
        else openPalette();
        return;
      }
      if (e.key === "Escape") close();
    };

    /* Once armed this component stays mounted, so it — not the host — has to
       answer the TopBar's search field from the second click onwards. */
    const onOpenRequest = () => openPalette();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("kairos:openPalette", onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("kairos:openPalette", onOpenRequest);
    };
  }, [close, closing, open, openPalette]);

  useEffect(() => {
    if (open && !closing) inputRef.current?.focus();
  }, [closing, open]);

  // Keep the highlight inside the list as it shrinks under typing.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, rowCount - 1)));
  }, [rowCount]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      className={`command-palette-backdrop fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12dvh] backdrop-blur-sm ${
        closing ? "command-palette-backdrop--out" : ""
      }`}
      onClick={close}
    >
      <div
        className={`command-palette-panel w-full max-w-xl overflow-hidden rounded-xl border border-border-medium bg-bg-elevated shadow-2xl ${
          closing ? "command-palette-panel--out" : ""
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => (i + 1) % Math.max(1, rowCount));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => (i - 1 + rowCount) % Math.max(1, rowCount));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(activeIndex);
            }
          }}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          className="w-full border-b border-border-light bg-transparent px-4 py-3.5 text-base text-fg-primary outline-none placeholder:text-fg-quaternary"
        />

        <ul className="max-h-80 overflow-y-auto py-1">
          {rows.map((destination, index) => (
            <li key={destination.id}>
              {index === results.length ? (
                <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-quaternary">
                  {t("inYourWorkspace")}
                </p>
              ) : null}
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => go(index)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                  index === activeIndex
                    ? "bg-accent-primary/10 text-fg-primary"
                    : "text-fg-secondary"
                }`}
              >
                <span className="truncate">{destination.label}</span>
                {destination.hint ? (
                  <span className="shrink-0 text-xs text-fg-quaternary">
                    {destination.hint}
                  </span>
                ) : null}
              </button>
            </li>
          ))}

          {hasQuery ? (
            <li>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(askIndex)}
                onClick={() => go(askIndex)}
                className={`flex w-full items-center justify-between gap-3 border-t border-border-light px-4 py-2.5 text-left text-sm ${
                  askIndex === activeIndex
                    ? "bg-accent-primary/10 text-fg-primary"
                    : "text-fg-secondary"
                }`}
              >
                <span className="truncate">
                  {t("askAssistant", { query: query.trim() })}
                </span>
                <span className="shrink-0 text-xs text-fg-quaternary">
                  {t("enter")}
                </span>
              </button>
            </li>
          ) : null}

          {search.isFetching && debounced.length >= 2 ? (
            <li
              aria-live="polite"
              className="px-4 py-2 text-center text-xs text-fg-quaternary"
            >
              {t("searching")}
            </li>
          ) : null}

          {rowCount === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-fg-tertiary">
              {t("noResults")}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
