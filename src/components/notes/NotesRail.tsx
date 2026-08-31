"use client";

/**
 * The library rail: the ways into the corpus.
 *
 * The old sidebar was three tabs (All / Notebooks / Shared) and vanished
 * entirely below `md`, taking the notebook list and the create button with it.
 * Here the notebooks are always present next to the views they filter, and the
 * whole rail slides in as a sheet on small screens rather than disappearing.
 */

import { useTranslations } from "next-intl";
import {
  BookOpen,
  CalendarDays,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "~/components/ui/icons";

import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { notebookIdOfView, type NoteView } from "./notesData";

export interface RailNotebook {
  id: number;
  name: string;
  description: string | null;
  count: number;
}

export function NotesRail({
  view,
  onViewChange,
  counts,
  notebooks,
  query,
  onQueryChange,
  searchRef,
  onNewNote,
  onCreateNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onClose,
}: {
  view: NoteView;
  onViewChange: (next: NoteView) => void;
  counts: { all: number; shared: number; calendar: number };
  notebooks: RailNotebook[];
  query: string;
  onQueryChange: (next: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onNewNote: () => void;
  onCreateNotebook: () => void;
  onRenameNotebook: (notebook: RailNotebook) => void;
  onDeleteNotebook: (notebook: RailNotebook) => void;
  /** Present only when the rail is a mobile sheet. */
  onClose?: () => void;
}) {
  const t = useTranslations("notes");
  const activeNotebookId = notebookIdOfView(view);

  const views: Array<{ key: NoteView; label: string; icon: React.ReactNode; count: number }> = [
    { key: "all", label: t("tabs.allNotes"), icon: <FileText size={15} />, count: counts.all },
    { key: "shared", label: t("views.sharedWithMe"), icon: <Users size={15} />, count: counts.shared },
    { key: "calendar", label: t("views.onCalendar"), icon: <CalendarDays size={15} />, count: counts.calendar },
  ];

  return (
    <div className="flex flex-col h-full bg-bg-surface border-r border-border-light/40">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 flex-none">
        <h1 className="flex-1 text-xl font-bold text-fg-primary">{t("title")}</h1>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-2 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors md:hidden"
          >
            <X size={17} />
          </button>
        )}
        <button
          type="button"
          onClick={onNewNote}
          aria-label={t("actions.create")}
          title={t("actions.create")}
          className="p-2.5 rounded-xl bg-gradient-to-br from-accent-primary to-accent-secondary text-white shadow-lg hover:brightness-110 transition-all"
        >
          <Plus size={17} />
        </button>
      </div>

      <div className="px-4 pb-3 flex-none">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary pointer-events-none"
            size={15}
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="w-full pl-9 pr-9 py-2.5 text-sm bg-bg-secondary rounded-xl text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label={t("common.clearSearch")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-fg-tertiary hover:text-fg-primary transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-2 pb-4" aria-label={t("title")}>
        <ul className="flex flex-col gap-0.5">
          {views.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => onViewChange(entry.key)}
                aria-current={view === entry.key ? "true" : undefined}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-left transition-colors ${
                  view === entry.key
                    ? "bg-accent-primary/10 text-accent-primary font-semibold ring-1 ring-accent-primary/25"
                    : "text-fg-secondary hover:bg-bg-secondary"
                }`}
              >
                <span className={view === entry.key ? "text-accent-primary" : "text-fg-tertiary"}>
                  {entry.icon}
                </span>
                <span className="flex-1 truncate">{entry.label}</span>
                <span className="text-[10px] tabular-nums text-fg-quaternary">{entry.count}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between px-2.5 pt-5 pb-1.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-widest text-fg-quaternary">
            {t("tabs.notebooks")}
          </span>
          <button
            type="button"
            onClick={onCreateNotebook}
            aria-label={t("notebooks.create")}
            title={t("notebooks.create")}
            className="kairos-tap p-1 rounded-md text-accent-primary hover:bg-accent-primary/10 transition-colors"
          >
            <Plus size={13} />
          </button>
        </div>

        {notebooks.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-fg-quaternary">{t("notebooks.emptyRail")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {notebooks.map((notebook) => {
              const selected = activeNotebookId === notebook.id;
              return (
                <li key={notebook.id} className="group relative flex items-center">
                  <button
                    type="button"
                    onClick={() => onViewChange(`notebook:${notebook.id}`)}
                    aria-current={selected ? "true" : undefined}
                    title={notebook.description ?? notebook.name}
                    className={`flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-left transition-colors ${
                      selected
                        ? "bg-accent-primary/10 text-accent-primary font-semibold ring-1 ring-accent-primary/25"
                        : "text-fg-secondary hover:bg-bg-secondary"
                    }`}
                  >
                    <BookOpen size={15} className={selected ? "text-accent-primary" : "text-fg-tertiary"} />
                    <span className="flex-1 truncate">{notebook.name}</span>
                    <span className="text-[10px] tabular-nums text-fg-quaternary">{notebook.count}</span>
                  </button>

                  <span className="absolute right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <Menu
                      label={t("notebooks.actions", { name: notebook.name })}
                      icon={<MoreHorizontal size={14} />}
                      triggerClassName="p-1 rounded-md bg-bg-elevated text-fg-tertiary hover:text-fg-primary transition-colors"
                    >
                      {(close) => (
                        <>
                          <MenuItem
                            icon={<Pencil size={13} />}
                            onClick={() => {
                              close();
                              onRenameNotebook(notebook);
                            }}
                          >
                            {t("notebooks.rename")}
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem
                            icon={<Trash2 size={13} />}
                            destructive
                            onClick={() => {
                              close();
                              onDeleteNotebook(notebook);
                            }}
                          >
                            {t("actions.delete")}
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
