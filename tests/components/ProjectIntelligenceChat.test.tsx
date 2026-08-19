import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectIntelligenceChat } from "~/components/projects/ProjectIntelligenceChat";

/**
 * The global next-intl mock (tests/setup.tsx) resolves keys against the real
 * en.json, so `t("emptyTitle")` renders the English copy rather than the key
 * string. The tests below assert against that English copy.
 */

describe("ProjectIntelligenceChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  /* ---- Greeting detection ---- */

  it("shows greeting response for simple greetings instead of API call", async () => {
    const user = userEvent.setup();
    render(<ProjectIntelligenceChat />);

    const input = screen.getByPlaceholderText(/Message KAIROS AI/);
    await user.type(input, "hi");
    await user.click(screen.getByText("Send"));

    // Should show user message
    expect(screen.getByText("hi")).toBeInTheDocument();
    // Should show an agent greeting
    const agentMessages = document.querySelectorAll(".kairos-chat-response");
    expect(agentMessages.length).toBeGreaterThan(0);
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
});
