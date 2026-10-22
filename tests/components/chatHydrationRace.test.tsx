/**
 * A question sent on open must survive the old thread arriving.
 *
 * The AI button remounts the widget's thread with a question to send at once.
 * The send fired on mount, before the most recent conversation had loaded, and
 * when that conversation arrived a moment later it was poured over the screen —
 * the question and its thinking dots vanished, the user was left looking at an
 * old chat, and the answer, landing in a different conversation, was never seen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** What `agent.latestConversation` currently returns; tests flip it mid-run. */
const latest: { data: unknown } = { data: undefined };

const OLD_THREAD = {
  conversationId: "old-thread",
  messages: [
    { role: "user", content: "An old question", createdAt: new Date("2026-10-01") },
    {
      role: "assistant",
      content: JSON.stringify({ answer: { summary: "An old answer" } }),
      createdAt: new Date("2026-10-01"),
    },
  ],
};

vi.mock("~/trpc/react", () => {
  const query = (data: () => unknown) => ({
    useQuery: () => ({ data: data(), isLoading: false, error: null, refetch: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false }),
  });
  const invalidate = (): unknown =>
    new Proxy(() => Promise.resolve(), { get: () => invalidate(), apply: () => Promise.resolve() });

  return {
    api: new Proxy(
      {},
      {
        get: (_t, ns) => {
          if (ns === "useUtils") return () => new Proxy({}, { get: () => invalidate() });
          return new Proxy(
            {},
            {
              get: (_t2, proc) =>
                query(() => (ns === "agent" && proc === "latestConversation" ? latest.data : null)),
            },
          );
        },
      },
    ),
  };
});

const { ProjectIntelligenceChat } = await import(
  "~/components/projects/ProjectIntelligenceChat"
);

/** A turn that never finishes, so the thinking state stays on screen. */
const fetchMock = vi.fn(() =>
  Promise.resolve(
    new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
  ),
);

function sentBody(): Record<string, unknown> {
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("a question sent on open", () => {
  beforeEach(() => {
    latest.data = undefined;
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is not wiped when the old thread loads after it", () => {
    const { rerender } = render(<ProjectIntelligenceChat prefill="Look at this note" />);
    expect(screen.getByText("Look at this note")).toBeInTheDocument();

    // The most recent conversation arrives after the send went out.
    latest.data = OLD_THREAD;
    rerender(<ProjectIntelligenceChat prefill="Look at this note" />);

    expect(screen.getByText("Look at this note")).toBeInTheDocument();
    expect(screen.queryByText("An old answer")).not.toBeInTheDocument();
  });

  it("starts its own thread rather than landing in an old one", () => {
    // Even when the old thread is already cached on mount.
    latest.data = OLD_THREAD;
    render(<ProjectIntelligenceChat prefill="Look at this note" />);

    expect(screen.getByText("Look at this note")).toBeInTheDocument();
    expect(screen.queryByText("An old answer")).not.toBeInTheDocument();
    expect(sentBody().conversationId).toBeUndefined();
  });
});

describe("a message typed before the history loads", () => {
  beforeEach(() => {
    latest.data = undefined;
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stays on screen when the history arrives", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProjectIntelligenceChat />);

    await user.type(screen.getByPlaceholderText(/Message KAIROS AI/), "Quick one");
    await user.click(screen.getByText("Send"));

    latest.data = OLD_THREAD;
    act(() => {
      rerender(<ProjectIntelligenceChat />);
    });

    expect(screen.getByText("Quick one")).toBeInTheDocument();
  });

  it("still restores the history when nothing was sent first", () => {
    latest.data = OLD_THREAD;
    render(<ProjectIntelligenceChat />);
    expect(screen.getByText("An old answer")).toBeInTheDocument();
  });
});
