"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

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
 */

type Translator = (key: string, values?: Record<string, unknown>) => string;

interface Destination {
  id: string;
  label: string;
  href: string;
  hint?: string;
}

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

  const staticDestinations = useMemo<Destination[]>(
    () => [
      { id: "nav:dashboard", label: t("dashboard"), href: "/dashboard" },
      { id: "nav:projects", label: t("projects"), href: "/projects" },
      { id: "nav:tasks", label: t("tasks"), href: "/tasks" },
      { id: "nav:calendar", label: t("calendar"), href: "/calendar" },
      { id: "nav:notes", label: t("notes"), href: "/notes" },
      { id: "nav:events", label: t("events"), href: "/events" },
      { id: "nav:chat", label: t("assistant"), href: "/chat/ai" },
      { id: "nav:settings", label: t("settings"), href: "/settings" },
    ],
    [t],
  );

  const results = useMemo<Destination[]>(() => {
    const projectRows: Destination[] = (projects.data ?? []).map((p) => ({
      id: `project:${String(p.id)}`,
      label: p.title,
      href: `/projects/${String(p.id)}`,
      hint: t("project"),
    }));

    const all = [...staticDestinations, ...projectRows];
    if (!query.trim()) return all.slice(0, 8);

    return all.filter((d) => matches(d.label, query.trim())).slice(0, 8);
  }, [projects.data, query, staticDestinations, t]);

  /** The assistant row sits at the end, and is the only row when nothing matches. */
  const askIndex = results.length;
  const hasQuery = query.trim().length > 0;
  const rowCount = results.length + (hasQuery ? 1 : 0);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const go = useCallback(
    (index: number) => {
      if (hasQuery && index === askIndex) {
        // Hand the raw text to the assistant. `prefill` is read by the chat page
        // and sent as the first message.
        router.push(`/chat/ai?prefill=${encodeURIComponent(query.trim())}`);
        close();
        return;
      }
      const destination = results[index];
      if (!destination) return;
      router.push(destination.href);
      close();
    },
    [askIndex, close, hasQuery, query, results, router],
  );

  // ⌘K / Ctrl-K to open, Escape to close.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === "Escape") close();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border-medium bg-bg-elevated shadow-2xl"
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
          {results.map((destination, index) => (
            <li key={destination.id}>
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
