"use client";

import { useTranslations } from "next-intl";

import { isAgentId } from "~/lib/agentNames";
import { api } from "~/trpc/react";

/**
 * An agent's name and role in the viewer's language.
 *
 * A name the workspace chose wins, verbatim, in every locale. Otherwise the
 * locale's spelling of the default (Мнемозина, Mnémosyne) comes from
 * `agents.names.<id>`. An id the message files do not know — a newly added
 * agent — falls back to whatever the roster sent rather than rendering a raw key.
 */
export function useAgentLabel() {
  const t = useTranslations("agents");
  // Names change rarely and only by an admin's hand; the settings form
  // invalidates this after a save, so a long stale time costs nothing.
  const names = api.agent.names.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: false,
  });
  const overrides = names.data?.overrides;

  const lookup = (group: "names" | "roles", id: string, fallback?: string) => {
    const key = `${group}.${id}`;
    return t.has(key) ? t(key) : (fallback ?? id);
  };

  return {
    name: (id: string, fallback?: string) =>
      (isAgentId(id) ? overrides?.[id] : undefined) ?? lookup("names", id, fallback),
    role: (id: string, fallback?: string) => lookup("roles", id, fallback),
  };
}
