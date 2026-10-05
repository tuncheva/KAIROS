"use client";

import { useTranslations } from "next-intl";

/**
 * An agent's persona name and role in the viewer's language.
 *
 * The roster from `agent.agents` carries only the untranslated English, so the
 * locale's spelling (Мнемозина, Mnémosyne) comes from `agents.names.<id>`. An id
 * the message files do not know — a newly added agent — falls back to whatever
 * the roster sent rather than rendering a raw key.
 */
export function useAgentLabel() {
  const t = useTranslations("agents");

  const lookup = (group: "names" | "roles", id: string, fallback?: string) => {
    const key = `${group}.${id}`;
    return t.has(key) ? t(key) : (fallback ?? id);
  };

  return {
    name: (id: string, fallback?: string) => lookup("names", id, fallback),
    role: (id: string, fallback?: string) => lookup("roles", id, fallback),
  };
}
