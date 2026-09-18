# The KAIROS theme

One token layer, one radius scale, one control scale, four status families and
one typography rule. This file is what the three guardrail rules in
`scripts/check-theme.ts` point at.

Tailwind v4 is configured **entirely from `src/styles/globals.css`**. There is no
`tailwind.config.js`, and v4 will not load one without an `@config` directive —
so every token lives in that file's `@theme inline` block plus `:root` (light)
and `.dark` (dark). Dark mode is class-based via next-themes:
`@custom-variant dark (&:where(.dark, .dark *))`. Colour values are stored as
space-separated RGB triples and consumed as `rgb(var(--x))`, which is what lets
`bg-status-danger-surface/60` work.

---

## 1. The token layer

### Surfaces — `bg-bg-*`

| Token | Use |
| --- | --- |
| `--bg-primary` | the page |
| `--bg-secondary` | inset wells, fields, rails |
| `--bg-tertiary` | pressed and selected states, progress tracks |
| `--bg-elevated` | cards, panels, menus, popovers |
| `--bg-surface` | rails and wells inside an elevated pane |
| `--bg-overlay` | dialog and drawer shells |

### Ink — `text-fg-*`

`--fg-primary` headings and body · `--fg-secondary` supporting copy ·
`--fg-tertiary` labels and meta · `--fg-quaternary` stamps and disabled text.

### Hairlines — `border-border-*`

`--border-light` the quiet rule inside a card · `--border-medium` the edge of a
card or control · `--border-strong` a dashed placeholder or an emphasised edge.

### Accent — `*-accent-*`

`--accent-primary` / `-secondary` / `-tertiary` / `-hover`, switchable across six
themes with `[data-accent]` on `<html>`. **Accent is flat ink on a hairline.**
It is not a gradient: no `bg-gradient-to-*` from accent stops anywhere in the
app. A neutral or in-progress state ("draft") takes the accent so it follows the
theme rather than picking a colour of its own.

### Brand ramp

purple `168 85 247` · pink `213 145 145` · caramel `233 168 108` ·
mint `95 180 156` · sky `39 111 191` · strawberry `240 58 71`.

These are the categorical ramp — the chart palette in
`src/components/charts/themeColors.ts` reads them and rotates so the hue nearest
the active accent leads.

---

## 2. The four status families

Four families, each with three steps, defined in `:root` and `.dark` and
registered in `@theme inline`:

| Family | Drawn from | Surface | Border | Ink |
| --- | --- | --- | --- | --- |
| success | mint | `--status-success-surface` | `--status-success-border` | `--status-success-ink` |
| warning | caramel | `--status-warning-surface` | `--status-warning-border` | `--status-warning-ink` |
| danger | strawberry | `--status-danger-surface` | `--status-danger-border` | `--status-danger-ink` |
| info | sky | `--status-info-surface` | `--status-info-border` | `--status-info-ink` |

Used as `bg-status-danger-surface`, `border-status-danger-border`,
`text-status-danger-ink`.

**Which step goes where.** Text and solid marks (dots, bars, fills) take `-ink`.
Tinted backgrounds take `-surface`. Hairlines take `-border`.

**Contrast.** Every ink-on-surface pair clears WCAG AA at 4.5:1 and every border
clears 3:1, in both modes, against all six app surfaces. Light-mode danger ink on
danger surface is 4.53:1; dark is 4.51:1 — the tightest pairs in the set. If you
change a value, re-check it; move the step, never the token name.

The older `--success` / `--warning` / `--error` / `--info` scalars are still
defined and still read by other code. They are not the semantic families and
should not be used for new work.

---

## 3. The radius scale

Four steps, tied to the **element class**, not to taste:

| Step | Value | Element |
| --- | --- | --- |
| `--radius-sm` → `rounded-sm` | 8px | chips, badges, inputs |
| `--radius-md` → `rounded-md` | 10px | buttons, fields |
| `--radius-lg` → `rounded-lg` | 12px | cards, panels, menus, bubbles |
| `--radius-xl` → `rounded-xl` | 16px | dialogs, drawers |

`rounded-2xl`, `rounded-3xl` and every arbitrary `rounded-[Npx]` are gone. Do not
reintroduce them.

`rounded-full` is **reserved for the marketing pages** — `components/homepage/*`,
`components/marketing/*` and `app/(marketing)/*` — where the pill is the house
style. Elsewhere it is allowed only where the shape is circular or capsular by
geometry: avatars, dots, spinners, toggle tracks, progress bars and round icon
buttons. A text-bearing pill anywhere else takes its element's step.

Hand-written CSS in `globals.css` uses `var(--radius-*)` for the same four steps.

---

## 4. The control scale

Registered in the spacing namespace, so `h-control-md`, `min-h-control-lg`,
`w-control-lg`, `p-pad-card` and `p-pad-dialog` all resolve.

| Token | Value | Element |
| --- | --- | --- |
| `control-sm` | 32px | chips, inputs |
| `control-md` | 40px | buttons, fields |
| `control-lg` | 48px | cards, panels |
| `control-xl` | 56px | dialogs, drawers |
| `pad-card` | 16px | card and panel padding |
| `pad-dialog` | 22px | dialog and drawer padding |

`h-8` / `h-10` / `h-12` / `h-14` are the same pixels and still appear; the
`h-control-*` spelling is the canonical one for new work.

---

## 5. Typography

Three faces, three jobs:

- **Display serif** (`font-display`, Instrument Serif, Playfair Display for `bg`)
  — page and section headings, dialog and drawer titles. Set at
  `font-normal`; the serif carries the weight.
- **Geist / Nunito Sans** (`font-sans`) — body copy, controls, everything else.
- **Mono** (`font-mono`, IBM Plex Mono, or the `kairos-stamp` / `kairos-mono`
  classes) — labels, eyebrows, stamps, timestamps, codes, key names.

No bold-sans headings. A heading at `text-lg` and above is serif; a 13px panel
title is a UI label and stays sans.

Icons come from `src/components/ui/icons.tsx` (or `icons.server.tsx` in a server
component). Never a text glyph or an emoji standing in for an icon — it renders
in whatever font the OS supplies and takes no colour from the theme.

---

## 6. The shared shells

| Piece | Where | What it is |
| --- | --- | --- |
| `Modal`, `useModalBehavior` | `ui/Modal.tsx` | focus trap, Escape, scroll lock, portal |
| `MODAL_SHELL`, `MODAL_SCRIM` | `ui/Modal.tsx` | 16px radius on `bg-overlay`, hairline, blurred scrim |
| `ModalHeader` | `ui/Modal.tsx` | serif title, optional mono eyebrow, mono `ESC` affordance |
| `ModalBody`, `ModalActions`, `ModalAction` | `ui/Modal.tsx` | dialog padding; actions right-aligned; tones `quiet` / `primary` / `danger` |
| `ConfirmDialog` | `ui/ConfirmDialog.tsx` | the one "are you sure" — there is no second copy |
| `Panel`, `TitledPanel` | `ui/Panel.tsx` | the card shell; `publishUi` and `chatUi` re-export it |
| `Stamp` | `ui/Stamp.tsx` | the mono label |
| `SystemScreen` | `ui/SystemScreen.tsx` | 404, both error boundaries, root loading |
| `ErrorDigest` | `ui/ErrorDigest.tsx` | the mono digest line that copies itself |
| `Skeleton`, `SkeletonTopBar`, `SkeletonCards` | `ui/Skeleton.tsx` | every `loading.tsx` |

A destructive action is **danger ink on a danger hairline**, never a solid red
fill. A dialog closes with the mono `ESC` affordance, not a glyph cross.

---

## 7. The three prohibitions

Enforced by `scripts/check-theme.ts`, which runs in `pnpm check` and in the test
suite (`tests/styles/theme-guardrail.test.ts`). Run it alone with
`pnpm check:theme`.

1. **`no-raw-hex-surface`** — no `#rrggbb` anywhere in `src/`. Six files are
   allowed, each because a CSS custom property cannot reach them: the
   `themeColor` meta in `app/layout.tsx`, the Google brand SVG in `SignInModal`,
   `server/http/themeInitScript.ts` (runs before the stylesheet exists),
   `lib/avatarGradient.ts`, `server/email/email.ts` (mail clients have no custom
   properties) and `server/orgs/joinCodes.ts` (a QR bitmap). Adding a seventh
   means editing the allowlist in the script, with the reason.
2. **`no-slate-or-gray`** — no `slate-*` or `gray-*` utilities. Slate is cooler
   and a step darker than the light tokens, so a slate pane reads bluer than the
   app around it, and a token change reaches none of it. The tokens already
   carry both modes: a `dark:` twin beside a token is a sign something is wrong.
3. **`no-tailwind-status`** — no Tailwind status families (`red-*`, `amber-*`,
   `emerald-*`, `sky-*`, `cyan-*` and the rest). Use the four semantic families;
   they are the only shades checked against the light background.

Prose in comments is not scanned, so a rule can name the class it forbids.
