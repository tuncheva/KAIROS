"use client";

/**
 * The library rail: the ways into the corpus.
 *
 * The old sidebar was three tabs (All / Notebooks / Shared) and vanished
 * entirely below `md`, taking the notebook list and the create button with it.
 * Here the notebooks are always present next to the views they filter, and the
 * whole rail slides in as a sheet on small screens rather than disappearing.
 *
 * Visually it has stopped being its own tinted panel. It sat on `bg-bg-surface`
 * while the list sat on `bg-bg-secondary` and the editor on `bg-bg-primary` —
 * three tints doing the job one `border-light/60` hairline does better, which is
 * how `DashboardClient` splits its columns. Active rows take `SideNav`'s
 * left-border language instead of a ring, and the create button is the flat
 * dashboard CTA rather than a gradient pill.
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
import {
  BTN_ACCENT_SQUARE,
  FIELD,
  FIELD_INPUT,
  ICON_BTN_BARE,
  MICRO,
  STAMP,
} from "./notesUi";

export interface RailNotebook {
  id: number;
  name: string;
  description: string | null;
  count: number;
}

/**
 * One row in the rail.
 *
 * `border-l-2` in the flow rather than a `ring-1`, so the marker lines up with
 * the pane edge and there is a single property to animate. The count is mono and
 * tabular, like every other figure on the surface.
 */
const ROW_BASE =
  "flex w-full items-center gap-2.5 border-l-2 py-2 pr-3 pl-3.5 text-left text-[13px] transition-colors duration-[300ms]";
const ROW_IDLE = "border-l-transparent text-fg-secondary hover:bg-accent-primary/[0.06] hover:text-fg-primary";
const ROW_ON = "border-l-accent-primary bg-accent-primary/[0.08] font-bold text-fg-primary";

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
    <div className="flex h-full flex-col border-r border-border-light/60 bg-bg-primary">
      <div className="flex flex-none items-center gap-2 px-4 pt-4 pb-3">
        <h1 className="flex-1 text-[15px] font-bold tracking-[-0.012em] text-fg-primary">
          {t("title")}
        </h1>
        <span className={`${STAMP} tabular-nums`}>{counts.all}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className={`${ICON_BTN_BARE} md:hidden`}
          >
            <X size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={onNewNote}
          aria-label={t("actions.create")}
          title={t("actions.create")}
          className={BTN_ACCENT_SQUARE}
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="flex-none px-4 pb-3.5">
        <div className={FIELD}>
          <Search className="flex-none text-fg-tertiary" size={14} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className={`${FIELD_INPUT} [&::-webkit-search-cancel-button]:hidden`}
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label={t("common.clearSearch")}
              className="kairos-tap grid h-5 w-5 flex-none place-items-center rounded text-fg-tertiary transition-colors hover:text-fg-primary"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pb-5" aria-label={t("title")}>
        {/* `kairos-stagger` has been in globals.css since the design system
            landed; the rail is exactly what it is for. */}
        <ul className="kairos-stagger flex flex-col">
          {views.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => onViewChange(entry.key)}
                aria-current={view === entry.key ? "true" : undefined}
                className={`${ROW_BASE} ${view === entry.key ? ROW_ON : ROW_IDLE}`}
              >
                <span className={view === entry.key ? "text-accent-primary" : "text-fg-tertiary"}>
                  {entry.icon}
                </span>
                <span className="flex-1 truncate">{entry.label}</span>
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    view === entry.key ? "text-accent-primary" : "text-fg-quaternary"
                  }`}
                >
                  {entry.count}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between px-4 pt-5 pb-1.5">
          <span className={MICRO}>{t("tabs.notebooks")}</span>
          <button
            type="button"
            onClick={onCreateNotebook}
            aria-label={t("notebooks.create")}
            title={t("notebooks.create")}
            className="kairos-tap grid h-[22px] w-[22px] place-items-center rounded-md text-accent-primary transition-colors hover:bg-accent-primary/10"
          >
            <Plus size={13} />
          </button>
        </div>

        {notebooks.length === 0 ? (
          <p className="px-4 py-2 text-[12px] text-fg-quaternary">{t("notebooks.emptyRail")}</p>
        ) : (
          <ul className="kairos-stagger flex flex-col">
            {notebooks.map((notebook) => {
              const selected = activeNotebookId === notebook.id;
              return (
                <li key={notebook.id} className="group relative flex items-center">
                  <button
                    type="button"
                    onClick={() => onViewChange(`notebook:${notebook.id}`)}
                    aria-current={selected ? "true" : undefined}
                    title={notebook.description ?? notebook.name}
                    className={`${ROW_BASE} min-w-0 flex-1 ${selected ? ROW_ON : ROW_IDLE}`}
                  >
                    <BookOpen size={15} className={selected ? "text-accent-primary" : "text-fg-tertiary"} />
                    <span className="flex-1 truncate">{notebook.name}</span>
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        selected ? "text-accent-primary" : "text-fg-quaternary"
                      }`}
                    >
                      {notebook.count}
                    </span>
                  </button>

                  <span className="absolute right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Menu
                      label={t("notebooks.actions", { name: notebook.name })}
                      icon={<MoreHorizontal size={14} />}
                      triggerClassName="kairos-tap grid h-6 w-6 place-items-center rounded-md border border-border-medium bg-bg-elevated text-fg-tertiary transition-colors hover:text-fg-primary"
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
