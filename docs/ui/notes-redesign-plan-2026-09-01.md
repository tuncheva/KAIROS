# Notes page redesign proposal — interactive HTML mockup

## Context

The KAIROS UX audit (`docs/ui/ux-audit-2026-08-31.md`) diagnoses the app as three generations of UI stacked on top of each other. Notes sits in the "recent tier", but it is a *different* recent tier from the one the dashboard and calendar now define: notes leans on `rounded-2xl` cards, gradient pill buttons, soft `kairos-menu-surface` shadows and a very granular ad-hoc type scale (`text-[9.5px]` … `text-[13px]`), while dashboard/calendar have moved to an editorial language — hairline `border-light/60` rules instead of cards, `gap-px` grids, uppercase IBM Plex Mono micro-labels at `tracking-[0.14em]`, outline-only status badges, `tabular-nums` figures with negative tracking, and `bg-accent-primary/10` active states.

Notes also has essentially **no motion**. Every animation in the feature is `transition-colors`, `animate-pulse`, `animate-spin`, plus one `.kairos-page-enter` on `<main>`. The eleven popups mount and unmount raw — no fade, no scale, no exit. The mobile rail sheet appears instantly with no slide. The list↔editor pane swap on mobile is a bare `hidden`/`block` toggle. Meanwhile the rest of the app has a rich, reduced-motion-aware keyframe vocabulary (`dash-rise`, `calendar-pop`, `kairos-modal-enter`, `command-palette-panel-in`, `projects-drawer-in/out`, `toast-in`).

The deliverable is **one self-contained HTML file** proposing the redesign: an interactive mockup where the notes page is recreated at full fidelity, every popup actually opens with its proposed animation, and every surface is annotated with rationale. It follows the precedent set by `docs/ui/ux-fix-ui-proposal.html` (KAIROS tokens ported inline, Google Fonts, light/dark toggle). No React/TSX is touched in this task.

**Decisions confirmed with the user:** editorial-tier direction · interactive mockup (not a still gallery) · full scope including `/recover`, skeletons/empty states and mobile · both themes with a toggle.

## Deliverable

**`docs/ui/notes-redesign-proposal.html`** — single file, no build step, no external assets except Google Fonts (Nunito Sans, Instrument Serif, IBM Plex Mono — the three faces `src/app/layout.tsx` loads). Opens directly in a browser.

## Structure of the document

1. **Header** — title, one-paragraph thesis, theme toggle (light/dark/system), an accent switcher exercising all six `data-accent` values, and a "reduce motion" switch so the reviewer can verify every animation degrades.
2. **Section 0 — The system** — token swatches, the type scale, the micro-label/stamp convention, the new button and chip vocabulary, and a motion legend listing every keyframe used with its duration and easing.
3. **Section 1 — The notes page, live** — a full-height, fully interactive three-pane recreation at desktop width: rail, list, editor. Rows are clickable and selection animates; the sort menu, notebook menu, note overflow menu and right-click context menu all open for real.
4. **Sections 2–12 — Every popup**, each in its own annotated panel with a "open it" button that plays the proposed enter animation, and a close that plays the exit:
   LockGate (inline, not modal) · LockNoteDialog (incl. the no-recovery-PIN warning branch) · RemoveLockDialog · PinResetDialog · NotebookDialog · ShareDialog (incl. all four suggestion popovers) · ConfirmDialog ×3 call sites (delete note, delete notebook, wrong-password → reset prompt) · sort menu · notebook actions menu · note overflow menu · row context menu.
5. **Section 13 — States** — the route skeleton, the list loading branch, and all six empty-state variants (search miss, three filter misses, shared, calendar, default/first-run, empty notebook), each animating in.
6. **Section 14 — Mobile** — a 390px frame showing the rail sheet sliding in, the list↔editor push transition, and dialogs as bottom sheets.
7. **Section 15 — `/recover`** — the off-system recovery page brought onto the system.
8. **Section 16 — Implementation notes** — the mapping table from mockup class → real Tailwind class / new `globals.css` rule, so the follow-up implementation PR is mechanical.

## Design direction (editorial tier)

Ported straight from `DashboardClient.tsx` and `CalendarClient.tsx`, which are the reference implementations:

- **Structure over containers.** The rail, list and editor are separated by `border-border-light/60` hairlines, not by three different background tints stacked (`bg-bg-surface` / `bg-bg-secondary` / `bg-bg-primary`). Note rows become `border-b border-border-light/50` rows in the `TaskRow` mould, not `rounded-xl` cards.
- **Mono micro-labels.** Group headers ("Today", "Earlier this week"), the sort pill, the word count, the save indicator, meta chips and the notebooks section label all move to `font-mono text-[10px] uppercase tracking-[0.14em] text-fg-quaternary` — replacing today's five different sizes between `9.5px` and `11px`.
- **Outline-only status.** `MetaChip`'s four filled tones (`bg-error/12`, `bg-accent-primary/12`, `bg-info/12`, `bg-bg-tertiary`) become the dashboard's `STATE_BADGE` pattern: `rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]` with `border-error/40 text-error` etc. Locked / Shared / Dated / Notebook read as one family.
- **Selection.** Today: `bg-bg-elevated kairos-system-card ring-1 ring-accent-primary/20` plus a `w-0.5` accent bar. Proposed: `bg-accent-primary/[0.07]` with a `border-l-2 border-accent-primary` that animates in — the `SideNav` `railRowClass` and `TaskRow` hover language.
- **Buttons.** The rail's `bg-gradient-to-br from-accent-primary to-accent-secondary` pill and the recover page's `bg-gradient-to-r` CTAs are dropped for the dashboard CTA: `rounded-[10px] bg-accent-primary px-[22px] py-[15px] font-semibold text-white transition-all duration-[350ms] hover:-translate-y-0.5 hover:bg-accent-hover`. Icon buttons take the calendar's `h-[30px] w-[30px] rounded-lg border border-border-medium` form.
- **Radii collapse** from `rounded / -md / -lg / -xl / -2xl / -full` to essentially `rounded-md` (chips), `rounded-[10px]` (controls, per the dashboard), `rounded-xl` (dialogs, per the calendar popover) and `rounded-full` (avatars only).
- **One dialog chrome.** All five hand-rolled notes dialogs plus `ui/ConfirmDialog` converge on the calendar-popover surface: `rounded-xl border border-border-medium bg-bg-elevated shadow-2xl`, on a `bg-black/40 backdrop-blur-sm` scrim — the `CommandPalette` treatment. `kairos-menu-surface` vs `kairos-system-card-elevated` (currently split arbitrarily across the five) goes away.
- **Numbers** (counts, word count, timestamps) always `tabular-nums`; large figures get `tracking-[-0.02em]`.
- **Editor typography.** The title moves to `font-display` (Instrument Serif) at `tracking-[-0.02em]`, matching the calendar's `<h2 className="font-display text-[26px] …">`, giving the writing surface a distinct voice from the chrome.

## Motion spec

Every animation reuses or extends the existing house vocabulary rather than inventing curves. The four house easings: `cubic-bezier(0.22,1,0.36,1)` (enter), `cubic-bezier(0.2,0.8,0.25,1)` (rise/drawer), `cubic-bezier(0.34,1.56,0.64,1)` (overshoot pops), `cubic-bezier(0.4,0,0.2,1)` (180 ms control transitions).

| Surface | Animation | Basis |
|---|---|---|
| Page shell | `kairos-page-enter` 0.28s, kept | existing |
| Rail nav items, notebooks | `kairos-stagger-child` 0.5s, 0.05s step | existing `.kairos-stagger` |
| List rows on load / filter change | `dash-rise` 0.4s (shortened from 0.75s for a list), stagger 0.03s, capped at ~12 rows | `dash-rise` |
| Row removal (delete) | `dash-row-out` — collapse height + fade | existing |
| Row selection | accent left-border scales in from center 0.22s + background cross-fade | new, `dash-grow` transform-origin trick |
| Editor pane on note switch | `calendar-pop` 0.3s on the content column, title and meta lead by 0.04s | `calendar-pop` |
| All modal dialogs | scrim `command-palette-backdrop-in` 0.18s; card `kairos-modal-enter` 0.3s in / 0.15s reverse out | existing, exit is new |
| All menus + context menu | `kairos-scale-in` 0.16s with transform-origin set from the anchor corner | existing `kairos-scale-in` |
| Mobile rail sheet | `projects-drawer-in` 0.45s / `-out`, scrim 0.35s | existing |
| Mobile list↔editor | horizontal push, 0.3s, `cubic-bezier(0.2,0.8,0.25,1)` | new, mirrors `calendar-drawer-in` |
| Inline date picker / draft password strip | height + opacity reveal 0.24s | new, matches `kairos-ai-widget-in` |
| Save indicator state change | cross-fade 0.18s; the `Saved` check draws its stroke once | new |
| LockGate wrong password | 0.4s shake, `translateX` ±4px, 3 cycles | new |
| Lock/unlock success | badge morphs `error/10` → `success/10` with a 0.3s scale pop | new |
| Skeletons | replace `animate-pulse` with a 1.4s shimmer sweep, `dash-grow`-style | new |
| Empty states | icon circle scales in with the overshoot curve, copy follows at +0.08s | `kairos-scale-in` |
| Toasts | `toast-in` 0.22s, unchanged | existing |

**Reduced motion is non-negotiable.** The mockup carries a `@media (prefers-reduced-motion: reduce)` block that zeroes every duration, plus an in-page toggle that forces the same state so the reviewer can check it without changing OS settings — matching how `globals.css` handles this today.

## Fidelity constraints

- Copy is transcribed verbatim from the current components (which read it from `src/i18n/messages/en.json` under `notes.*`) — e.g. "The password is not stored anywhere. If you forget it, only your recovery PIN can get the note back.", "{n} encrypted notes were not searched — their text only exists on the server." Where the redesign proposes a copy change, the panel shows before/after explicitly.
- Icons are inline SVG traced from the Phosphor set `src/components/ui/icons.tsx` re-exports, at the same sizes the components use.
- Tokens are the real values from `src/styles/globals.css`: light `--bg-primary: 252 253 255` … dark `--bg-primary: 8 8 12`, accent purple `168 85 247`, and all six `data-accent` palettes.
- The mockup keeps the real measurements — rail `236px`, list `318px`, topbar `4rem`, bottom nav `3.75rem` — so it reads as the actual page.

## Files

| File | Change |
|---|---|
| `docs/ui/notes-redesign-proposal.html` | **new** — the entire deliverable |
| `docs/ui/notes-redesign-plan-2026-09-01.md` | **new** — this plan, committed into the repo next to the existing `ux-fix-plan-2026-08-31.md` so the direction and motion spec are reviewable in git rather than living only in the planning session |

Nothing else is modified. Source files are read-only references:
`src/components/notes/*` (all 14), `src/app/(app)/notes/**`, `src/styles/globals.css`, `src/components/ui/{Modal,ConfirmDialog}.tsx`, `src/components/dashboard/DashboardClient.tsx`, `src/components/calendar/CalendarClient.tsx`, `src/components/layout/{TopBar,SideNav,CommandPalette}.tsx`.

## Verification

1. Open `docs/ui/notes-redesign-proposal.html` in the Browser pane (`preview_start` with a `file://` URL) and screenshot the top of the document.
2. Flip the theme toggle both ways and confirm every surface repaints — no hard-coded color survives in either theme.
3. Cycle the six accents and confirm the accent-tinted states (selection, active nav, primary buttons, focus rings) all follow.
4. Click through every popup trigger; confirm each opens and closes with its stated animation and that focus lands in the dialog.
5. Toggle the reduce-motion switch and re-open two dialogs; confirm they appear instantly with no transform.
6. Resize to 390px via `resize_window` mobile preset; confirm the rail sheet slides, the pane swap pushes, and dialogs render as bottom sheets.
7. `read_console_messages` — zero errors.
8. Confirm the file is genuinely self-contained: no `src=`/`href=` outside `fonts.googleapis.com` / `fonts.gstatic.com`.

## Explicitly out of scope

- No changes to any `.tsx` or to `globals.css` — this task ends at the proposal. Section 16 exists so the implementation PR is a separate, mechanical follow-up.
- `src/components/notes/CreateNoteForm.tsx` is dead code (zero importers) and is not redesigned; the proposal notes it should be deleted.
- The five duplicated focus traps in the notes dialogs are a real defect, but consolidating them onto `ui/Modal` is an implementation concern — flagged in Section 16, not solved here.
