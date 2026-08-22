import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectIntelligenceChat } from "~/components/projects/ProjectIntelligenceChat";

/**
 * The global next-intl mock (tests/setup.tsx) resolves keys against the real
 * en.json, so `t("emptyTitle")` renders the English copy rather than the key
 * string. The tests below assert against that English copy.
 */

/**
 * Build a fake SSE response for `POST /api/ai/chat`.
 *
 * `events: null` leaves the stream open forever, which is how the in-flight
 * (thinking) state is exercised.
 */
function mockAgentStream(events: Array<[string, unknown]> | null) {
  return vi.fn().mockImplementation(() => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (events === null) return; // never closes
        const encoder = new TextEncoder();
        for (const [event, data] of events) {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        }
        controller.close();
      },
    });
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  });
}

describe("ProjectIntelligenceChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a turn that never completes, so nothing races the assertions.
    vi.stubGlobal("fetch", mockAgentStream(null));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* ---- Basic rendering ---- */

  it("renders without crashing", () => {
    render(<ProjectIntelligenceChat />);
    expect(
      screen.getByText("Ask a question about your workspace or projects."),
    ).toBeInTheDocument();
  });

  it("renders with a projectId prop", () => {
    render(<ProjectIntelligenceChat projectId={1} />);
    expect(
      screen.getByText("Ask a question about your workspace or projects."),
    ).toBeInTheDocument();
  });

  it("renders the message input", () => {
    render(<ProjectIntelligenceChat />);
    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    expect(input).toBeInTheDocument();
  });

  it("renders the send button", () => {
    render(<ProjectIntelligenceChat />);
    const sendBtn = screen.getByText("Send");
    expect(sendBtn).toBeInTheDocument();
  });

  it("send button is disabled when input is empty", () => {
    render(<ProjectIntelligenceChat />);
    const sendBtn = screen.getByText("Send");
    expect(sendBtn).toBeDisabled();
  });

  /* ---- Text input & sending ---- */

  it("enables send button when text is typed", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "Hello");

    const sendBtn = screen.getByText("Send");
    expect(sendBtn).not.toBeDisabled();
  });

  it("clears input after sending", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "Hello");
    await user.click(screen.getByText("Send"));

    expect(input).toHaveValue("");
  });

  it("shows user message after sending", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "Hello");
    await user.click(screen.getByText("Send"));

    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  /* ---- Routing ---- */

  /**
   * Greetings used to be answered locally from a random pick of four English
   * strings, and any message containing "note" or "event" was routed straight to
   * a write agent on a substring match. Every message now goes to the server,
   * where A1 decides — which is what makes routing work in Bulgarian too.
   */
  it("sends greetings to the server rather than answering locally", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "hi");
    await user.click(screen.getByText("Send"));

    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/ai/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends messages mentioning notes or events through the same endpoint", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "what events are coming up?");
    await user.click(screen.getByText("Send"));

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      message: "what events are coming up?",
    });
  });

  it("renders the answer from a completed turn", async () => {
    vi.stubGlobal(
      "fetch",
      mockAgentStream([
        ["start", { conversationId: "conv_1" }],
        [
          "result",
          {
            draftId: "draft_1",
            conversationId: "conv_1",
            latencyMs: 10,
            a1: {
              intent: { type: "answer" },
              answer: { summary: "Theatre is on track.", details: ["10 tasks"] },
            },
          },
        ],
      ]),
    );

    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "status?");
    await user.click(screen.getByText("Send"));

    expect(await screen.findByText(/Theatre is on track/)).toBeInTheDocument();
  });

  /* ---- Thinking indicator ---- */

  it("shows thinking dots for non-greeting non-task messages", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "What is my project status?");
    await user.click(screen.getByText("Send"));

    // Thinking dots should appear
    const thinkingIndicator = screen.getByTestId("thinking-indicator");
    expect(thinkingIndicator).toBeInTheDocument();
    expect(thinkingIndicator.className).toContain("kairos-thinking-dots");
  });

  /* ---- Static UI ---- */

  it("renders the disclaimer text", () => {
    render(<ProjectIntelligenceChat />);
    expect(
      screen.getByText(
        "AI-powered workspace assistant. Verify critical decisions independently.",
      ),
    ).toBeInTheDocument();
  });

  it("input has proper styling classes", () => {
    render(<ProjectIntelligenceChat />);
    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    expect(input.className).toContain("bg-transparent");
  });

  it("form has border-top styling", () => {
    render(<ProjectIntelligenceChat />);
    const form = document.querySelector("form");
    expect(form).toBeInTheDocument();
    expect(form?.className).toContain("border-t");
  });

  /* ---- Message alignment & classes ---- */

  it("message bubbles have correct alignment", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "hi");
    await user.click(screen.getByText("Send"));

    // User message should be right-aligned
    const userMsg = screen.getByText("hi").closest(".kairos-msg-enter");
    expect(userMsg?.className).toContain("justify-end");

    // Agent message should be left-aligned
    const agentMessages = document.querySelectorAll(
      ".kairos-msg-enter.flex.justify-start",
    );
    expect(agentMessages.length).toBeGreaterThan(0);
  });

  it("agent messages use kairos-chat-response class", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "hi");
    await user.click(screen.getByText("Send"));

    const agentBubbles = document.querySelectorAll(".kairos-chat-response");
    expect(agentBubbles.length).toBeGreaterThan(0);
  });

  it("user messages use whitespace-pre-wrap class", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "User msg");
    await user.click(screen.getByText("Send"));

    const userBubble = screen.getByText("User msg");
    expect(userBubble.className).toContain("whitespace-pre-wrap");
  });

  it("messages have click-to-copy functionality", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "Copy me");
    await user.click(screen.getByText("Send"));

    const copyButton = screen.getByText("Copy me").closest("button");
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toHaveAttribute("title", "Click to copy");
  });

  /* ---- Suggested questions ---- */

  it("renders suggested questions in empty state", () => {
    render(<ProjectIntelligenceChat />);
    expect(screen.getByText(/status of my projects/)).toBeInTheDocument();
    expect(screen.getByText("Show me overdue tasks")).toBeInTheDocument();
    expect(screen.getByText("What are the biggest risks?")).toBeInTheDocument();
    expect(screen.getByText(/Summarize this week/)).toBeInTheDocument();
  });

  /* ---- Header ---- */

  it("renders header with KAIROS AI title", () => {
    render(<ProjectIntelligenceChat />);
    expect(screen.getByText("KAIROS AI")).toBeInTheDocument();
    expect(screen.getByText("Workspace Concierge")).toBeInTheDocument();
  });

  it("info button toggles info panel", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const infoBtn = screen.getByText("Info");
    expect(infoBtn).toBeInTheDocument();

    await user.click(infoBtn);
    expect(screen.getByText("Hide")).toBeInTheDocument();
    expect(screen.getByText(/Project-scoped AI assistant/)).toBeInTheDocument();
    expect(screen.getByText(/Capabilities: workspace Q&A/)).toBeInTheDocument();
  });

  /* ---- Delete chat & start over ---- */

  /**
   * The control is opt-in. Every other mount of this chat — the compact floating
   * widget, the project panels — should look exactly as it did, because a
   * destructive one-click control does not belong on a 340px quick-ask surface.
   */
  it("hides the start-over control unless asked for", () => {
    render(<ProjectIntelligenceChat />);
    expect(screen.queryByTestId("new-chat")).not.toBeInTheDocument();
  });

  it("offers start-over but disables it on an empty thread", () => {
    render(<ProjectIntelligenceChat showNewChat />);
    expect(screen.getByTestId("new-chat")).toBeDisabled();
  });

  it("confirms before deleting, and clears the thread once confirmed", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat showNewChat />);

    await user.type(
      screen.getByPlaceholderText(/Message KAIROS AI/),
      "how are my projects?",
    );
    await user.click(screen.getByText("Send"));
    expect(screen.getByText("how are my projects?")).toBeInTheDocument();

    // Nothing is deleted on the first click: this cannot be undone.
    await user.click(screen.getByTestId("new-chat"));
    expect(screen.getByText("Delete this chat?")).toBeInTheDocument();
    expect(screen.getByText("how are my projects?")).toBeInTheDocument();

    await user.click(screen.getByTestId("new-chat-confirm"));

    // Back to the empty state, dialog gone, and the message with it.
    expect(
      await screen.findByText("Ask a question about your workspace or projects."),
    ).toBeInTheDocument();
    expect(screen.queryByText("how are my projects?")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete this chat?")).not.toBeInTheDocument();
  });

  it("keeps the thread when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat showNewChat />);

    await user.type(
      screen.getByPlaceholderText(/Message KAIROS AI/),
      "keep this",
    );
    await user.click(screen.getByText("Send"));

    await user.click(screen.getByTestId("new-chat"));
    await user.click(screen.getByText("Cancel"));

    expect(screen.queryByText("Delete this chat?")).not.toBeInTheDocument();
    expect(screen.getByText("keep this")).toBeInTheDocument();
  });

  /**
   * The next turn must open a new conversation. If the deleted id were still in
   * the ref, the server would be asked to continue a thread that no longer
   * exists — the visible chat would be empty while the model replayed history
   * the user believed they had thrown away.
   */
  it("does not send the deleted conversation id on the next turn", async () => {
    vi.stubGlobal(
      "fetch",
      mockAgentStream([
        ["start", { conversationId: "conv_1" }],
        [
          "result",
          {
            draftId: "draft_1",
            conversationId: "conv_1",
            latencyMs: 10,
            a1: { intent: { type: "answer" }, answer: { summary: "All good." } },
          },
        ],
      ]),
    );

    const user = userEvent.setup();
    render(<ProjectIntelligenceChat showNewChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "first");
    await user.click(screen.getByText("Send"));
    expect(await screen.findByText("All good.")).toBeInTheDocument();

    await user.click(screen.getByTestId("new-chat"));
    await user.click(screen.getByTestId("new-chat-confirm"));
    await screen.findByText("Ask a question about your workspace or projects.");

    await user.type(
      screen.getByPlaceholderText(/Message KAIROS AI/),
      "second",
    );
    await user.click(screen.getByText("Send"));

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, RequestInit]>;
    const last = JSON.parse(calls[calls.length - 1]![1].body as string) as {
      message: string;
      conversationId?: string;
    };
    expect(last.message).toBe("second");
    expect(last.conversationId).toBeUndefined();
  });
});
