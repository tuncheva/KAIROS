"use client";

import { api } from "~/trpc/react";

/**
 * What a workspace switch has to do to the client cache.
 *
 * Org-scoped queries — projects, tasks, notes, chat, members, analytics — are
 * keyed by procedure alone and never by organisation, because the server reads
 * the active workspace off the user row rather than taking it as an input. "My
 * projects" is therefore the *same* cache entry before and after a switch, and
 * every switcher was invalidating only the two or three queries that render the
 * workspace name. The topbar changed; the page underneath kept serving the
 * previous workspace's data until something else happened to refetch it, which
 * reads as "switching does nothing" — or, once you switch back, as "it won't
 * let me return to the old one".
 *
 * So the whole tRPC cache is the right blast radius here, not a lazy shortcut:
 * after a switch there is no cached answer left that is still trustworthy.
 * Active queries refetch straight away, the rest are marked stale and refetch
 * when they next mount.
 */
export type SwitchWorkspaceOptions = {
  /** Runs the moment the switch is committed, before the refetches land. */
  onSwitched?: () => void;
  onError?: (message: string) => void;
};

/** Switch into an organisation, and make the rest of the app follow. */
export function useSwitchOrganization(options?: SwitchWorkspaceOptions) {
  const utils = api.useUtils();

  return api.organization.setActive.useMutation({
    onSuccess: () => {
      options?.onSwitched?.();

      // Deliberately not awaited. The switch itself is already committed, and
      // holding the mutation's `isPending` open until every refetch lands would
      // keep the switcher's own buttons disabled while the app catches up.
      void utils.invalidate();
    },
    onError: (error) => {
      // Without this a rejected switch was a silent no-op: the menu sat there
      // showing the old workspace and nothing said why.
      options?.onError?.(error.message);
    },
  });
}

/**
 * Switch back out to the personal workspace.
 *
 * The counterpart to {@link useSwitchOrganization}, and it needs exactly the
 * same cache treatment: leaving an organisation for your own space changes the
 * answer to every scoped query just as much as moving between two organisations
 * does.
 */
export function useSwitchToPersonal(options?: SwitchWorkspaceOptions) {
  const utils = api.useUtils();

  return api.user.setPersonalMode.useMutation({
    onSuccess: () => {
      options?.onSwitched?.();
      void utils.invalidate();
    },
    onError: (error) => {
      options?.onError?.(error.message);
    },
  });
}
