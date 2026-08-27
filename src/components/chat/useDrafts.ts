"use client";

/**
 * Per-conversation message drafts, surviving navigation and reload.
 *
 * A draft belongs to a conversation, not to the composer: switching threads and
 * coming back should return what you had typed, and so should a refresh. The
 * store is therefore keyed by conversation id and mirrored into localStorage.
 *
 * Writes are debounced because this runs on every keystroke — localStorage is
 * synchronous and shared with the whole tab, so writing per character makes
 * typing janky in long threads.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "kairos.chat.drafts";
const WRITE_DEBOUNCE_MS = 400;

/** Drafts older than this are dropped on load so the store cannot grow forever. */
const MAX_DRAFT_AGE_MS = 1000 * 60 * 60 * 24 * 30;

interface StoredDraft {
  body: string;
  updatedAt: number;
}

type DraftMap = Record<string, StoredDraft>;

function read(): DraftMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    const cutoff = Date.now() - MAX_DRAFT_AGE_MS;
    const out: DraftMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as StoredDraft).body === "string" &&
        typeof (value as StoredDraft).updatedAt === "number" &&
        (value as StoredDraft).updatedAt > cutoff &&
        (value as StoredDraft).body.trim().length > 0
      ) {
        out[key] = value as StoredDraft;
      }
    }
    return out;
  } catch {
    /* Corrupt or unavailable storage (private mode, quota) must not take the
       chat down with it — an empty draft store is a fine outcome. */
    return {};
  }
}

export function useDrafts() {
  const [drafts, setDrafts] = useState<DraftMap>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Read after mount, never during render: localStorage does not exist on the
     server, and seeding state from it directly is a hydration mismatch. */
  useEffect(() => {
    setDrafts(read());
  }, []);

  const flush = useCallback((next: DraftMap) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Quota or private mode — the in-memory drafts still work for this session.
      }
    }, WRITE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const getDraft = useCallback(
    (conversationId: number | null) =>
      conversationId === null ? "" : drafts[String(conversationId)]?.body ?? "",
    [drafts],
  );

  const setDraft = useCallback(
    (conversationId: number, body: string) => {
      setDrafts((prev) => {
        const key = String(conversationId);
        /* An emptied box clears the draft rather than storing "" — otherwise
           the rail shows a Draft marker for a conversation with nothing in it. */
        const next = { ...prev };
        if (body.trim().length === 0) delete next[key];
        else next[key] = { body, updatedAt: Date.now() };
        flush(next);
        return next;
      });
    },
    [flush],
  );

  const clearDraft = useCallback(
    (conversationId: number) => {
      setDrafts((prev) => {
        const key = String(conversationId);
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        flush(next);
        return next;
      });
    },
    [flush],
  );

  const hasDraft = useCallback(
    (conversationId: number) => Boolean(drafts[String(conversationId)]),
    [drafts],
  );

  return { getDraft, setDraft, clearDraft, hasDraft };
}
