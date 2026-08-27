import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useAutosave } from "~/components/notes/useAutosave";

interface Snapshot {
  noteId: number | null;
  title: string;
  content: string;
}

const snapshot = (noteId: number | null, content: string, title = ""): Snapshot => ({
  noteId,
  title,
  content,
});

/**
 * The hook under test is what replaced the Save button, so these cover the two
 * things a person would notice if it were wrong: an edit that never lands, and
 * an edit that lands on the wrong note.
 */
describe("useAutosave", () => {
  let saved: Snapshot[];
  let onSave: (value: Snapshot) => Promise<void>;

  beforeEach(() => {
    vi.useFakeTimers();
    saved = [];
    onSave = (value) => {
      saved.push(value);
      return Promise.resolve();
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (initial: { value: Snapshot; baseline: Snapshot; enabled?: boolean }) =>
    renderHook(
      (props: { value: Snapshot; baseline: Snapshot; enabled?: boolean }) =>
        useAutosave({
          value: props.value,
          baseline: props.baseline,
          keyId: props.value.noteId,
          enabled: props.enabled ?? true,
          delay: 800,
          onSave,
        }),
      { initialProps: initial },
    );

  it("writes once typing pauses", async () => {
    const baseline = snapshot(1, "hello");
    const { result } = setup({ value: snapshot(1, "hello there"), baseline });

    expect(result.current.status).toBe("dirty");
    expect(saved).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(saved).toEqual([snapshot(1, "hello there")]);
    expect(result.current.status).toBe("saved");
  });

  it("writes nothing when the editor matches the server", async () => {
    const baseline = snapshot(1, "hello");
    const { result } = setup({ value: snapshot(1, "hello"), baseline });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(saved).toHaveLength(0);
    expect(result.current.status).toBe("idle");
  });

  it("writes nothing while disabled — a read-only or still-locked note", async () => {
    const { result } = setup({
      value: snapshot(1, "edited"),
      baseline: snapshot(1, "original"),
      enabled: false,
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(saved).toHaveLength(0);
    expect(result.current.status).toBe("idle");
  });

  it("flush writes immediately, without waiting out the debounce", async () => {
    const { result } = setup({ value: snapshot(1, "typed"), baseline: snapshot(1, "") });

    await act(async () => {
      await result.current.flush();
    });

    expect(saved).toEqual([snapshot(1, "typed")]);
  });

  it("debounces a run of keystrokes into one write", async () => {
    const baseline = snapshot(1, "");
    const { rerender } = setup({ value: snapshot(1, "a"), baseline });

    for (const text of ["ab", "abc", "abcd"]) {
      rerender({ value: snapshot(1, text), baseline });
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
    }
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(saved).toEqual([snapshot(1, "abcd")]);
  });

  it("writes a pending edit under the note it was typed into, not the one opened next", async () => {
    /* The failure this guards against: click another note mid-sentence and the
       half-typed paragraph is written over whatever you just opened. */
    const { rerender } = setup({ value: snapshot(1, "note one, edited"), baseline: snapshot(1, "note one") });

    // Straight to note 2 — no pause, so the debounce never fired for note 1.
    rerender({ value: snapshot(2, "note two"), baseline: snapshot(2, "note two") });
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(saved).toEqual([snapshot(1, "note one, edited")]);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Note 2 was untouched, so nothing more is written.
    expect(saved).toEqual([snapshot(1, "note one, edited")]);
  });

  it("rebases on the note it moves to, so an untouched note is never rewritten", async () => {
    const { rerender, result } = setup({ value: snapshot(1, "same"), baseline: snapshot(1, "same") });

    rerender({ value: snapshot(2, "other"), baseline: snapshot(2, "other") });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(saved).toHaveLength(0);
    expect(result.current.status).toBe("idle");
  });

  it("clears the saved indicator when the note changes", async () => {
    const { rerender, result } = setup({ value: snapshot(1, "typed"), baseline: snapshot(1, "") });

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.status).toBe("saved");

    rerender({ value: snapshot(2, "untouched"), baseline: snapshot(2, "untouched") });
    expect(result.current.status).toBe("idle");
    expect(result.current.savedAt).toBeNull();
  });

  it("reports a failed write instead of pretending it landed", async () => {
    onSave = () => Promise.reject(new Error("locked"));
    const { result } = setup({ value: snapshot(1, "typed"), baseline: snapshot(1, "") });

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.savedAt).toBeNull();
  });

  it("stays dirty when more is typed while the write is in flight", async () => {
    let release: (() => void) | undefined;
    onSave = (value) => {
      saved.push(value);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };

    const baseline = snapshot(1, "");
    const { rerender, result } = setup({ value: snapshot(1, "first"), baseline });

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.status).toBe("saving");

    rerender({ value: snapshot(1, "first and more"), baseline });
    await act(async () => {
      release?.();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("dirty");
  });
});
