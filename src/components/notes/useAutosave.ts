"use client";

/**
 * Debounced autosave.
 *
 * The old editor kept every edit in a `Record<number, string>` until you pressed
 * Save, and dismissing the dialog threw the lot away without asking. Saving is
 * not a decision a person should have to remember to make, so it happens on a
 * short idle timer instead — and the one thing this hook owes the user in
 * return is an honest status, because a save they cannot see is a save they
 * cannot trust.
 *
 * Two rules make the difference between this and a naive debounce:
 *
 *  - `baseline` is what the server holds, straight from props. Dirtiness is
 *    measured against it rather than against a ref the hook mutates, so
 *    switching notes cannot leave the comparison pointing at the wrong note.
 *  - When `keyId` changes with an edit still pending, that edit is handed off
 *    and written under the note it was typed into. Nothing about "the note that
 *    is open now" is allowed to decide where older text lands.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface Autosave {
  status: SaveStatus;
  savedAt: Date | null;
  /** Write now if there is anything to write. Awaitable, never throws. */
  flush: () => Promise<void>;
}

export function useAutosave<T>({
  value,
  baseline,
  keyId,
  enabled,
  delay = 800,
  onSave,
}: {
  /** What the editor currently holds. */
  value: T;
  /** What the server holds. Straight from props, never derived from state. */
  baseline: T;
  /** Identity of the thing being edited. A change rebases and hands off. */
  keyId: string | number | null;
  enabled: boolean;
  delay?: number;
  /**
   * Writes one snapshot. It must take its target from the snapshot itself: a
   * handed-off edit is written after the editor has already moved on, so
   * "whichever note is open now" is the wrong place to look.
   */
  onSave: (value: T) => Promise<void>;
}): Autosave {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const valueRef = useRef(value);
  const savedRef = useRef(JSON.stringify(baseline));
  const onSaveRef = useRef(onSave);
  const enabledRef = useRef(enabled);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  /* The previous render's snapshot, so a note switch can still see what was
     typed into the note being left behind. */
  const lastRef = useRef<{ keyId: string | number | null; value: T; enabled: boolean }>({
    keyId,
    value,
    enabled,
  });
  const handoffRef = useRef<{ snapshot: T } | null>(null);

  const previous = lastRef.current;
  if (previous.keyId !== keyId) {
    if (previous.enabled && JSON.stringify(previous.value) !== savedRef.current) {
      handoffRef.current = { snapshot: previous.value };
    }
    /* Rebase onto the incoming note's server copy. It comes from `baseline`,
       which is props, so it is already right even though the editor's own state
       has not caught up yet. */
    savedRef.current = JSON.stringify(baseline);
    /* Adjusting state during render rather than in an effect, so the indicator
       never shows the previous note's "Saved" against this one. */
    setStatus("idle");
    setSavedAt(null);
  }
  lastRef.current = { keyId, value, enabled };

  valueRef.current = value;
  onSaveRef.current = onSave;
  enabledRef.current = enabled;

  const save = useCallback(async (handoff?: T) => {
    const handed = handoff !== undefined;
    const target = handed ? handoff : valueRef.current;
    const serialized = JSON.stringify(target);

    if (!handed && (!enabledRef.current || serialized === savedRef.current)) return;

    /* Two writes must not overlap: a password-protected note is re-encrypted
       server-side every time, and interleaving them would let the older content
       land last. */
    if (inFlightRef.current) await inFlightRef.current;
    if (!handed && JSON.stringify(valueRef.current) === savedRef.current) return;

    if (!handed) setStatus("saving");
    const run = onSaveRef
      .current(target)
      .then(() => {
        if (handed) return;
        savedRef.current = serialized;
        setSavedAt(new Date());
        /* Anything typed while the request was in flight is still unsaved, so
           the status has to say so rather than claim a clean slate. */
        setStatus(JSON.stringify(valueRef.current) === serialized ? "saved" : "dirty");
      })
      .catch(() => {
        if (!handed) setStatus("error");
      })
      .finally(() => {
        inFlightRef.current = null;
      });

    inFlightRef.current = run;
    await run;
  }, []);

  // Write the edit a note switch left behind, under the note it was typed into.
  useEffect(() => {
    const handoff = handoffRef.current;
    if (!handoff) return;
    handoffRef.current = null;
    void save(handoff.snapshot);
  });

  // Schedule a write once typing pauses.
  useEffect(() => {
    if (!enabled) return;
    if (JSON.stringify(value) === savedRef.current) return;

    setStatus((current) => (current === "saving" ? current : "dirty"));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, enabled, delay, save]);

  // A pending edit must not be lost to a reload or a closed tab.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!enabledRef.current) return;
      if (JSON.stringify(valueRef.current) === savedRef.current) return;
      void save();
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [save]);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await save();
  }, [save]);

  return { status, savedAt, flush };
}
