import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

/**
 * The drawer's exit.
 *
 * Closing used to unmount on the next frame, which reads as a crash rather than
 * a dismissal. The panel now holds itself on screen for the length of the exit
 * animation, and these tests pin the three things that made that non-trivial:
 * it keeps rendering the person it was showing, it swaps to the exit class
 * rather than simply vanishing, and reopening mid-exit cancels the pending
 * unmount instead of letting a stale timer blank the reopened drawer.
 *
 * `~/trpc/react` is stubbed rather than exercised: none of this is about data,
 * and a real query client would make the timing assertions depend on fetch
 * scheduling.
 */

const profile = {
  id: "u1",
  name: "Ada Lovelace",
  image: null,
  isSelf: false,
  restricted: false as const,
  email: "ada@example.com",
  bio: "Analytical engines.",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  timezone: "UTC",
  online: true,
  organization: { id: 1, name: "Kairos" },
  role: "member",
  joinedOrgAt: new Date("2024-01-01T00:00:00Z"),
  followerCount: 2,
  followingCount: 1,
  isFollowing: false,
  followsYou: false,
  canFollow: true,
  showsActivity: true,
};

vi.mock("~/trpc/react", () => {
  const invalidate = (): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: () => invalidate(),
      apply: () => Promise.resolve(),
    });

  const query = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, isError: false }),
  });

  return {
    api: {
      useUtils: () => new Proxy({}, { get: () => invalidate() }),
      profile: {
        getPublicProfile: query(profile),
        getSharedContext: query({ projects: [], events: [], organizations: [] }),
        getActivity: query([]),
        listFollows: query([]),
        follow: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        unfollow: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      chat: {
        getOrCreateDirectConversation: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    },
  };
});

const { ProfileDrawer, PROFILE_DRAWER_EXIT_MS } = await import(
  "~/components/profile/ProfileDrawer"
);

const panel = () => document.querySelector("aside");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProfileDrawer — closing", () => {
  it("renders the open drawer with the entrance class, not the exit one", () => {
    render(<ProfileDrawer userId="u1" onClose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(panel()?.className).toContain("projects-drawer");
    expect(panel()?.className).not.toContain("projects-drawer-out");
  });

  it("stays mounted and swaps to the exit class when asked to close", () => {
    const view = render(<ProfileDrawer userId="u1" onClose={vi.fn()} />);

    view.rerender(<ProfileDrawer userId={null} onClose={vi.fn()} />);

    // Still on screen, and still showing Ada rather than an empty panel —
    // this is the whole point of latching the id.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(panel()?.className).toContain("projects-drawer-out");
  });

  it("unmounts once the exit has run", () => {
    const view = render(<ProfileDrawer userId="u1" onClose={vi.fn()} />);
    view.rerender(<ProfileDrawer userId={null} onClose={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(PROFILE_DRAWER_EXIT_MS + 20);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stops swallowing clicks the moment it starts leaving", () => {
    const view = render(<ProfileDrawer userId="u1" onClose={vi.fn()} />);
    view.rerender(<ProfileDrawer userId={null} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog").className).toContain("pointer-events-none");
  });

  it("cancels the exit when reopened mid-animation", () => {
    const view = render(<ProfileDrawer userId="u1" onClose={vi.fn()} />);
    view.rerender(<ProfileDrawer userId={null} onClose={vi.fn()} />);

    // Reopen before the exit finishes.
    act(() => {
      vi.advanceTimersByTime(PROFILE_DRAWER_EXIT_MS / 2);
    });
    view.rerender(<ProfileDrawer userId="u1" onClose={vi.fn()} />);

    // Past the point the original timer would have fired.
    act(() => {
      vi.advanceTimersByTime(PROFILE_DRAWER_EXIT_MS);
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(panel()?.className).not.toContain("projects-drawer-out");
  });
});
