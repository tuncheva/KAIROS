import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * P0-7 — project chat.
 *
 * A conversation in this schema holds exactly two people plus an optional
 * `project_id`, so "project chat" means a DM scoped to a project rather than a
 * group thread. The modal dropped that scope: every row called
 * `onSelect(person.id)`, so a teammate picked under a project heading produced
 * an untagged DM, nothing in the app ever wrote `project_id`, and the rail's
 * "Projects" filter could never match a row.
 *
 * These tests pin the distinction: project rows carry their project, other rows
 * do not.
 */

const suggestions = {
  organizationMembers: [{ id: "u-org", name: "Maria Dimitrova", email: "maria@ustrem.bg", image: null }],
  recentContacts: [],
  projectSuggestions: [
    {
      projectId: 41,
      projectTitle: "Kapana Rebuild",
      members: [{ id: "u-kalina", name: "Kalina Petrova", email: "kalina@ustrem.bg", image: null }],
    },
  ],
};

vi.mock("~/trpc/react", () => ({
  api: {
    chat: {
      getParticipantSuggestions: {
        useQuery: () => ({ data: suggestions, isLoading: false }),
      },
    },
    user: {
      searchByEmail: { useQuery: () => ({ data: undefined, isError: false }) },
    },
  },
}));

const { NewChatModal } = await import("~/components/chat/NewChatModal");

describe("NewChatModal", () => {
  let onSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelect = vi.fn();
  });

  const open = () =>
    render(
      <NewChatModal
        onClose={vi.fn()}
        onSelect={onSelect}
        isCreating={false}
        currentUserId="u-me"
      />
    );

  it("tags a conversation with the project when the person is picked under one", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByText("Kalina Petrova"));

    expect(onSelect).toHaveBeenCalledWith("u-kalina", 41);
  });

  it("leaves a workspace member untagged", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByText("Maria Dimitrova"));

    // undefined projectId — a plain DM, not scoped to any project.
    expect(onSelect).toHaveBeenCalledWith("u-org", undefined);
  });

  it("shows the project as its own heading so the scope is visible before clicking", () => {
    open();
    expect(screen.getByText("Kapana Rebuild")).toBeTruthy();
  });
});
