# KAIROS — UX Remediation Plan

**Source:** [ux-audit-2026-08-31.md](ux-audit-2026-08-31.md) · **Branch:** `development` @ `9535b5f` · **Date:** 2026-08-31
**Companion:** [ux-fix-ui-proposal.html](ux-fix-ui-proposal.html) — rendered mockups for every item that needs a surface built.

---

## How this plan is organised

The audit lists 45 items. They are not 45 pieces of work. Grouped by *what actually has to be built*, they collapse into **12 new or rebuilt surfaces** and **~20 local edits**, sequenced into six waves. Two further items (§6.7, §6.8) are new scope requested on top of the audit and are marked as such.

Each wave is independently shippable and leaves the app in a better state than it found it. Waves 1–3 are the ones that change the felt quality of the product; waves 4–6 are parity and hygiene.

| Wave | Theme | Audit items | Est. | New UI? |
|---|---|---|---|---|
| **1** | Make the app speak | P0-1, P1-25, P2-45 | 0.5 d | Toast viewport |
| **2** | Close the dead ends | P0-2, P0-3, P0-5, P0-6, P1-29, P1-30 | 1.5 d | Org empty state, event page, onboarding modal |
| **3** | One shell, one nav | P1-14, P1-15, P1-23, P1-31, P1-32, P2-38 | 2 d | TopBar slot, rail tooltips |
| **4** | Wire the promised features | P0-4, P0-7, P0-8, P1-9, P1-10, P1-21, P2-42 | 3 d | Project chat, AI undo, recovery, project detail |
| **5** | Mobile parity | P1-16, P1-17, P1-18, P1-19 | 2 d | Bottom bar, mobile region filter |
| **6** | Trust and polish | P1-11 … P1-37, P2-39 … P2-44 | 3–4 d | Search, notifications, ConfirmDialog |
| **6+** | Notification position · no button glow *(new scope)* | NEW-1, NEW-2 | 1 d | Settings position picker |

**Total: ~13–14 working days**, of which one day is the new scope in §6.7–6.8. Waves 1 and 2 alone are two days and remove every "this product is broken" signal in the audit.

### Cross-cutting conventions this plan establishes

Four decisions apply to many items at once. Making them once, up front, is what keeps the item count from exploding:

1. **`components/ui/ConfirmDialog.tsx`** — one destructive-confirm component, promoted from `notes/ConfirmDialog`. Replaces five patterns (P1-26).
2. **`components/ui/Modal.tsx`** — one dialog shell providing `role="dialog"`, `aria-modal`, Escape, focus trap, `activeElement` restore and body-scroll lock. Every modal in P1-27 and P1-28 adopts it rather than each growing its own copy.
3. **`src/app/(app)/layout.tsx`** — one shell. Auth check, `SideNav`, `TopBar`, `OnboardingGate`, `error.tsx`. Fixes P1-14, P1-15, P0-6 and half of P1-32 in one change.
4. **No new hardcoded English.** Every string added by this plan lands in `en` *and* `bg` in the same commit. The existing 1,635/1,635 parity is a property worth not breaking.

---

## Wave 1 — Make the app speak *(0.5 day)*

The single highest-leverage change in the plan. 126 call sites in 23 files currently produce nothing.

### 1.1 — Render the toasts · **P0-1**

**File:** [ToastProvider.tsx](../../src/components/providers/ToastProvider.tsx)

Confirmed: `const [, setToasts] = useState<Toast[]>([])` discards the value and the provider returns bare `children`. The `ToastManager` class, TTL timers and dismiss logic are all already correct — **only the viewport is missing.**

**Do:**
- Keep the value: `const [toasts, setToasts] = useState<Toast[]>([])`.
- Render a fixed viewport as the provider's sibling to `children`.
- **Position bottom-left by default, and read the position from a token, not a hardcoded class.** Top-right is occupied by the floating notification stack (P1-20-5); bottom-right by `AskKairosLauncher`. Bottom-left is the only free corner *today* — but §6.7 makes position a user preference, so build the viewport to take its anchor from a CSS custom property from the start rather than retrofitting it later. On mobile it must sit above the bottom nav (`bottom-24 lg:bottom-6`).
- Two live regions, not one: `role="status" aria-live="polite"` for success/info, `role="alert" aria-live="assertive"` for errors. A save confirmation should not interrupt a screen reader; a failure should.
- Dismiss on click, an explicit × for pointer users, `focus-visible` ring on both.
- Cap the stack at 3 visible; older toasts drop off the top. Unbounded stacks are the exact failure mode P1-20-5 documents in the notification popups — do not repeat it here.
- Honour `prefers-reduced-motion` (the codebase does this in 11 places already; match).

**Acceptance:** join the dashboard with a wrong code → a red toast says so. Join with a right code → a green toast, and the workspace switches.

### 1.2 — The one mutation with no user-facing error branch · **P1-25**

**File:** [TaskTimelineClient.tsx:1348](../../src/components/progress/TaskTimelineClient.tsx#L1348)

`onError: (err) => { setDeletingId(null); console.error(...) }`. Add the `toast.error` call the other 125 sites already have. Once 1.1 lands this is a one-line fix.

### 1.3 — Give the errors a voice · **P2-45**

Sign-up and several mutations surface raw tRPC `error.message`. Until wave 1, nobody saw them; after wave 1 they *are* the app's error voice. Sweep the `toast.error(err.message)` sites and map known codes to localized copy, falling back to a generic localized message rather than the raw string. Pair this with P1-13 (wave 6) which needs the same code-discrimination in `SignInModal`.

---

## Wave 2 — Close the dead ends *(1.5 days)*

Nothing here is hard. Every item is a button that currently lies.

### 2.1 — Let an invited user accept their invitation · **P0-2** *(new UI)*

**File:** [OrgDashboardClient.tsx:88](../../src/components/orgs/OrgDashboardClient.tsx#L88)

Confirmed: the `if (!items.length)` early return sits above the pending-invitations block, so the invite is fetched, polled every 30 s, and never rendered — for precisely the user who needs it.

**Do:**
- Hoist the pending-invitations block **above** both the empty state and the list. It must never be gated on `items.length`.
- Replace the empty state's single sentence with the real thing: heading, one line of explanation, and two CTAs — **Create an organization** and **Join with a code** (the code input inline, not a link elsewhere).
- The same empty state component serves `WorkspaceMenu` (P1-30), which today renders `t("noOrgs")` with no action. Build it once in `components/orgs/OrgEmptyState.tsx`.

*Mockup: proposal §2.*

### 2.2 — Stop the command palette 404ing · **P0-3**

**File:** [CommandPalette.tsx:66–76](../../src/components/layout/CommandPalette.tsx#L66)

Confirmed: `/tasks` and `/events` do not exist, and every project row points at `/projects/{id}` which does not exist either.

**Interim (this wave, ~20 min):**
- `/tasks` → `/progress` (the route that actually renders the task timeline)
- `/events` → `/publish`
- project rows → the same href `ProjectsWorkspace` uses, and the identical dead link at [ConversationDetails.tsx:158](../../src/components/chat/ConversationDetails.tsx#L158)

**Permanent (wave 4):** `/projects/[projectId]` exists (4.4), and the palette points at it. Keep the interim change anyway — it costs nothing and holds until then.

**Guard:** add a test that asserts every static palette `href` resolves to a file under `src/app`. This class of bug should not be able to return.

### 2.3 — Make an event addressable · **P0-5** *(new UI)*

**File:** [EventFeed.tsx:523](../../src/components/events/EventFeed.tsx#L523)

Confirmed: shares `?event={id}`, nothing reads it, and `/publish` is not in `PUBLIC_PATHS` so the recipient is bounced to the landing page first.

**Do:**
- Build `src/app/(marketing)/events/[eventId]/page.tsx` — a **server** component: hero image, title, date/time, region, venue, description, organiser, RSVP count, and a sign-in-gated RSVP button.
- `generateMetadata` with real Open Graph and Twitter card tags. This is the point of the page: a shared link that unfurls.
- Add `/events/` to `PUBLIC_PATHS` in [proxy.ts:34](../../src/proxy.ts#L34).
- Point the Share button at it.
- Interim if the page slips: have `/publish` read `?event=` and scroll to + highlight the card. Do this only if wave 2 is running late; the real page is a day's work and is what the README promises.

*Mockup: proposal §3.*

### 2.4 — Onboard everyone, and let them join · **P0-6 + P1-29** *(new UI)*

**Files:** [OnboardingGate.tsx](../../src/components/auth/OnboardingGate.tsx), `RoleSelectionModal`

Three defects, one fix:
- The gate is mounted on `/create` and `/notes/*` only; sign-in lands on `/dashboard`. Most users never see it. → **Move the gate into `(app)/layout.tsx`** (wave 3's 3.1; if wave 3 has not landed, mount it on `dashboard/page.tsx` in the interim).
- `if (isLoading) return <>{children}</>` paints the dashboard, then slams the modal over it. → Return `null` while loading.
- `dismissed` is local state, so the gate re-arms on every navigation until the mutation lands. → Lift to the query cache / an optimistic `usageMode` write.

And the missing option: `RoleSelectionModal` offers *Create an organization* or *Personal*. An invited user's only paths are a redundant org or Personal-and-hunt-later. Add a **third card: Join an existing organization**, with the code input inline — the same input as 2.1. While in the file, give the modal a close button (P1-27 notes a keyboard user is otherwise trapped) and adopt `components/ui/Modal.tsx`.

*Mockup: proposal §4.*

---

## Wave 3 — One shell, one nav *(2 days)*

The audit's judgement here is right: this single change fixes four separate symptoms.

### 3.1 — Build `(app)/layout.tsx` · **P1-15, P1-14, P0-6**

Confirmed: `src/app/layout.tsx` is the **only** layout in the tree. All 15 pages under `(app)` hand-roll `<SideNav />` + `<TopBar />` + `rail-offset`.

**The layout holds:** the session check (once, not 15 times), `SideNav`, `TopBar` with a `pageActions` slot, `OnboardingGate`, and a sibling `(app)/error.tsx`.

**What it fixes:**
- **Shell remount on every navigation.** Today `SideNav` reads its pin state from `localStorage` in a `useEffect`, so pinned users watch `--rail-w` snap 4rem → 14.75rem and the content jump sideways on every page load.
- **The missing TopBar on 6 of 15 pages** — `notes` (×3) and `chat` (×3) have no notification bell, no workspace switcher, no user menu, no sign-out. Pages that need the full width take it via the slot rather than by dropping the bar.
- **Session expiry (P1-14).** Replace all 15 `redirect("/api/auth/signin")` calls with one `redirect("/?callbackUrl=" + encodeURIComponent(pathname) + "&reason=expired")`, and have `HomeClient` read `reason` and show "your session expired" above the sign-in modal. (`notes/*` currently redirect to `/` with no callbackUrl at all.)
- **No `(app)/error.tsx`** — today any app error escapes to the global boundary and the user loses the entire navigation.

**Migration order:** build the layout → strip the shell from one page (`dashboard`) → verify → strip the remaining 14 mechanically.

### 3.2 — Pre-paint the rail state · **P1-15, P1-23**

**File:** [themeInitScript.ts](../../src/server/http/themeInitScript.ts)

Two edits to the same script, plus its CSP hash test:
- Add `railPinned` to the pre-paint script so the rail width is correct on first paint (this is what actually kills the sideways jump; 3.1 alone stops the remount but not the initial read).
- **Line 35 reads `sessionStorage.getItem('user-accent')`**, and [UserPreferencesProvider.tsx:74](../../src/components/providers/UserPreferencesProvider.tsx#L74) writes it there. `sessionStorage` is per-tab, so every new tab paints default purple then corrects. Move both to `localStorage` — it is a durable preference, not session state.
- While there: `UserPreferencesProvider` lines 49–56 are a no-op effect that reads a variable and returns. Delete.
- The CSP hash test will fail on any script edit; update the hash in the same commit (the test exists precisely to force this).

### 3.3 — Settings routing · **P1-32, P1-31**

- `settings/page.tsx` is a chain of `activeSection === "…" && <Component />` with no fallback, so an unrecognised `?section=` renders a blank panel. Add a default to `profile`.
- Section changes are full `<Link>` navigations. Convert to client state with `history.replaceState`, or real nested routes. The shell should not re-render on a settings tab click.
- Its `<main>` is missing `id="main-content"`, so the root skip link is broken here and on all three `(auth)` pages. Add the id to all four.

### 3.4 — Label the collapsed rail · **P2-38**

`RailLink` renders labels at `opacity-0` inside `overflow-hidden` and sets no `title`. Unpinned is the default, so a new user sees eight unlabelled icons. Add a proper tooltip on hover **and** `focus-visible` (a `title` attribute alone is useless on touch and slow for everyone).

---

## Wave 4 — Wire the promised features *(3 days)*

Everything here already exists on the server. This wave is entirely about giving it a front door.

### 4.1 — Project chat · **P0-7** *(new UI)*

Confirmed: `ProjectChat.tsx` (14 KB) has **zero importers**, and it is the sole caller of `chat.getOrCreateProjectConversation`, `chat.listProjectConversations` and `chat.listProjectUsers`. The new `ChatShell` is 1:1 DM only — project members appear as *suggestions for a DM*, never as a group. There is no way to create any group conversation.

**Do:**
- Add a **Projects** section to `ConversationRail`, backed by `listProjectConversations`, above or below Direct Messages with its own collapsible header.
- Add a **group** mode to `NewChatModal`: a Direct/Project toggle, project picker, member multi-select, then `getOrCreateProjectConversation`.
- Route `ConversationDetails`' "open project" link at the real project page once 4.4 lands.
- **Then delete `ProjectChat.tsx`.** Do not port it — `ChatShell` is the better surface and already has focus traps, `aria-live`, drafts, presence, reactions, edit, pin and search.

*Mockup: proposal §5.*

### 4.2 — The AI undo window · **P0-8** *(new UI)*

Confirmed: [agent.ts:893–908](../../src/server/api/routers/agent.ts#L893) exposes `undoAvailability` and `undoApply`; the only references anywhere else are the entitlement flags in `src/lib/entitlements.ts`. Zero callers in `src/components`.

This is the README's central trust claim for the agent suite, and four of the five agents write real data.

**Do:**
- After any apply, render a persistent **"Applied · Undo"** bar inside the chat turn — not a toast. A toast at 3 s cannot carry a several-minute window.
- Poll `undoAvailability` for that `draftId` and show a live countdown; collapse the bar to a quiet "Applied" line when the window closes.
- On undo: confirm via `ConfirmDialog` if the apply touched more than N records, call `undoApply`, then toast the result.
- Respect the `undoApply` entitlement — when the plan does not include it, say so in the bar rather than showing a control that will fail.

*Mockup: proposal §6.*

### 4.3 — Note recovery, and the warning that should precede it · **P0-4 + P1-21** *(new UI)*

Four compounding defects, and the combination can permanently destroy a user's data. Content is AES-256-GCM under a key derived from the password; a forgotten password with no PIN is unrecoverable.

**Do, in this order (the warning matters more than the recovery page):**

1. **Warn at lock time (P1-21).** Today the entire copy is `notes.password.protect` = "Protect with a password". Replace the lock dialog with one that states plainly: the note is encrypted, KAIROS cannot recover it, and *here is the recovery PIN field* — inline, in the same dialog, if none is set. Never let a user encrypt a note without having seen this sentence.
2. **Rename `/reset-password` → `/notes/[noteId]/recover`.** The current name promises account password reset, which actually lives inside `SignInModal`, so users arrive with the wrong expectation.
3. **Honour the emailed token.** [email.ts:302](../../src/server/email/email.ts#L302) builds `?noteId=…&token=…`; the page never reads `token` and asks for a PIN instead. Accept the token as the credential; keep the PIN as the fallback.
4. **Fix the auth mismatch.** The route is in `PUBLIC_PATHS` but calls a `protectedProcedure` — an unauthenticated visitor following the email link gets a raw `UNAUTHORIZED`. Require a session, or show `SignInModal` with `callbackUrl`.
5. **Redirect to `/notes/{noteId}`** on success, not to `/create?action=new_note` (the deprecated surface).
6. Localize the page (it is on the P2-39 hardcoded-English list).

*Mockup: proposal §7.*

### 4.4 — A project is a place · **P1-9** *(new UI)*

[ProjectsWorkspace.tsx:51](../../src/components/projects/ProjectsWorkspace.tsx#L51) says it outright:

```ts
/** Tasks and the board still live behind the create flow. */
const projectHref = (id: number) => `/create?action=new_project&projectId=${id}`;
```

Opening a project navigates to a URL that says *create a new project*. You cannot share a link to a project; the palette and chat have to link somewhere that 404s; and back-button behaviour is unpredictable because project, board and timeline are one route with different query params.

**Do:** create `src/app/(app)/projects/[projectId]/page.tsx` with `overview` / `tasks` / `timeline` as real sub-routes. Move `ProjectManagement`, the board and `InteractiveTimeline` under it. Point `ProjectsWorkspace`, `CommandPalette` and `ConversationDetails` at it.

*Mockup: proposal §8.*

### 4.5 — One notes UI, and a `/create` that creates · **P1-10, P2-42**

- The nav item labelled **Create** with no `action` renders `TaskTimelineClient` — a task timeline. Rename the nav item, or make the page a create surface. (Recommend the latter, after 4.4 moves the task board to the project route.)
- `?action=new_note` renders the **old** 32 KB `NotesList` beside `CreateNoteForm`, while `/notes` renders the entirely different `NotesWorkspace`. Two notes products, both reachable, both linked. Redirect `?action=new_note` → `/notes/new` and **delete `NotesList.tsx`.**
- Delete the rest of the dead code (P2-42): `ProjectsListWorkspace.tsx` (15 KB), `A1ChatFloating.tsx`, `ProjectChat.tsx` (after 4.1). **Correction to the audit:** `ConversationsRail.tsx` is *not* orphaned — `AIChatPageClient.tsx` still imports it. Migrate that caller to `ConversationRail` first, then delete.

---

## Wave 5 — Mobile parity *(2 days)*

### 5.1 — Fix the bottom bar IA · **P1-16** *(new UI)*

Confirmed at [SideNav.tsx:136](../../src/components/layout/SideNav.tsx#L136). The bar is Events · Progress · **New** · Calendar · Settings, while Dashboard, Projects, Chat and Notes — four of the five most-used destinations — are buried in the hamburger drawer. Every item is icon-only with a `title`, which does nothing on touch.

**Proposed bar:** Dashboard · Projects · **New** · Chat · Notes, with **visible text labels** under each icon. Events, Progress, Calendar, Orgs and Settings move to the drawer, which is where secondary destinations belong.

*Mockup: proposal §9.*

### 5.2 — Un-cover the nav · **P1-17**

[AskKairosLauncher.tsx:41](../../src/components/chat/AskKairosLauncher.tsx#L41) is `fixed right-4 bottom-4 z-40`; the bottom nav is `fixed bottom-0 … z-40`. Same stacking level, launcher renders later, launcher wins — covering Settings and Calendar on every phone. Set the launcher to `bottom-24 lg:bottom-6` and raise the nav to `z-50`. Ten minutes.

### 5.3 — Region filter on mobile · **P1-18** *(new UI)*

[publish/page.tsx](<../../src/app/(app)/publish/page.tsx>) puts the region `<select>` inside `FeedLeftSidebar` (`hidden lg:block`) *and* passes `hideRegionFilter={true}` to `EventFeed`. Below 1024 px there is no region control at all — for a product whose event model is built around Bulgarian regions.

**Do:** a sticky filter chip row above the feed on `< lg`, opening a bottom sheet with the region list. Stop passing `hideRegionFilter` unconditionally.

### 5.4 — The desktop-only work surfaces · **P1-19**

| File | Lines | Responsive utilities |
|---|---|---|
| `ProjectManagement.tsx` | 786 | **0** |
| `InteractiveTimeline.tsx` | 763 | 2 |
| `MilestoneTimeline.tsx` | 641 | 2 |

`ProjectManagement` is the project workspace *and* the collaborator manager, and has not one breakpoint. This is the largest single chunk of work in the plan and the least well-defined.

**Sequence it after 4.4** — the project detail route rehouses these components anyway, and rewriting their layout twice is waste. Scope: stack the multi-column layouts below `lg`, make the timelines horizontally scrollable with a sticky first column, and give the collaborator table a card layout on narrow screens.

---

## Wave 6 — Trust and polish *(3–4 days)*

Ordered by value, not by audit number.

### 6.1 — Search, and a place to put it · **P1-11 + P1-12** *(new UI)*

Two halves of one problem. The command palette is genuinely good — local matching, explicit AI fallback, accent-insensitive — and **nothing in the UI mentions it**. Meanwhile the README promises "full-text search across the workspace" and `scripts/sql/search-indexes.sql` is a **zero-byte file**.

**Do:**
- Put a real search input in the TopBar that opens the palette on focus, with `⌘K` rendered inside it. This is the whole of P1-12 and it gives P1-11 a home.
- Add a `search.workspace` tRPC procedure across notes, tasks, events and projects, and render its results as a grouped section in the palette below the destinations.
- Write the SQL indexes the empty file was a placeholder for.

*Mockup: proposal §10.*

### 6.2 — Rebuild the notification centre · **P1-20** *(new UI)*

Six problems in one component, and it is visible on nearly every page:

1. **Entirely unlocalized** — "Notifications", "unread", "Clear All", "No notifications", "You are all caught up!", both `aria-label`s. In a Bulgarian-first product with exact `bg` parity everywhere else.
2. **"Clear All" permanently deletes everything on one click** — no confirmation. → route through `ConfirmDialog` (6.3).
3. **Per-item delete is unreachable on touch** — `opacity-0 group-hover:opacity-100`, no hover on a phone, no `focus-visible` variant.
4. **No "mark all as read"**, and clicking an item to mark it read *also navigates away*. There is no way to clear the badge without leaving the page, 50 times.
5. **The floating popup stack is unbounded** — `setFloatingNotifs(prev => [...prev, notif])`. A burst stacks cards over the TopBar. Cap it at 3.
6. **No keyboard or a11y story** — Escape does not close, focus is not managed, the bell has no `aria-expanded`/`aria-haspopup`. Relative times use bare `formatDistanceToNow` instead of the project's `useDateFormat`, so they stay English even in Bulgarian.

*Mockup: proposal §11.*

### 6.3 — One way to confirm a destructive action · **P1-26** *(new UI)*

Five patterns today:

| Pattern | Where |
|---|---|
| Native `confirm()` | `WorkspaceSettingsClient` — leave org, remove member, delete role |
| Custom accessible modal | `notes/ConfirmDialog`, `chat/ConfirmDialog` |
| Two-click "arm" with a 4 s timeout | `EventFeed` — delete event |
| Inline confirm/cancel swap | `TaskTimelineClient` — delete task |
| Overlay with `role="dialog"` | `ProjectsWorkspace` — delete project |

The three highest-stakes actions in the product use the unstyled, unthemed native dialog. The 4-second arming window is its own hazard — the confirmation silently disarms while the user reads it.

Promote `notes/ConfirmDialog` to `components/ui/ConfirmDialog.tsx` (danger variant, optional type-to-confirm for the irreversible ones) and route all five through it, plus notification Clear All (6.2-2).

*Mockup: proposal §12.*

### 6.4 — Modal accessibility · **P1-27, P1-28**

`SignInModal` (the front door) and `RoleSelectionModal` (onboarding) have no `role="dialog"`, no `aria-modal`, no Escape, no focus trap or restore — and the two a *first-time* user must get through are exactly the two that have none of it. Same for `EventFeed`'s create/edit modal, `TaskTimelineClient`, `MilestoneTimeline`, `NotesList`.

The newer surfaces (`notes/*`, `chat/*`, `CalendarDrawer`, `NewProjectDrawer`, `CommandPalette`) do all of it properly including `activeElement` restore and Tab cycling — **extract that implementation** into `components/ui/Modal.tsx` and retrofit the six older ones. Add the body-scroll lock (P1-28) there too; no modal in the app currently has one, which is particularly bad on iOS.

### 6.5 — Stop overwriting the user's theme · **P1-22, P1-24, P2-44**

[HomeClient.tsx:41](../../src/components/homepage/HomeClient.tsx#L41) calls `setTheme("dark")` in an effect. `next-themes` `setTheme` **writes to localStorage** — so any visit to `/`, including landing there after sign-out (`signOut({ callbackUrl: "/" })`), overwrites the saved preference. Next sign-in paints dark, then flips to light when the server preference resolves: a visible flash *and* a setting the user must keep re-applying.

- Scope dark to the landing page with a `dark` class on its own root — it already sets `className="dark"` — and **never call `setTheme`**.
- Same fix for the marketing and legal pages (P2-44): a light-mode user clicking Privacy should not get a dark page.
- P1-24: `themeInitScript` sets `dataset.kairosIntro = 'play'` unconditionally, so the full intro curtain replays on every load — including right after sign-out. Stamp `'seen'` in `localStorage` after the first play. (Folds into the 3.2 script edit; do it in the same commit as the CSP hash bump.)

### 6.6 — Auth dead ends · **P1-13**

[SignInModal.tsx:151](../../src/components/auth/SignInModal.tsx#L151) collapses every failure to `invalidCredentials`. But sign-in is also refused for **unverified email** and blocked by **login lockout**, and "resend verification" exists only on the `verifyEmailSent` view, reachable solely in the seconds after signup. A user who signs up, misses the email and returns tomorrow is told their password is wrong — forever, with no path out.

Discriminate: on `EMAIL_UNVERIFIED` show "Confirm your email" + a resend button; on lockout say how long; keep the generic message for genuine mismatches only.

### 6.7 — Let the user choose where notifications appear · **NEW-1** *(new UI)*

> **New scope.** This is not an audit finding — it is a feature requested on top of the remediation. It is placed here because it depends on 1.1 (the toast viewport) and 6.2 (the notification rebuild) both existing; building it earlier means building it twice.

**Files:** `NotificationSettingsClient.tsx`, `settings.ts` router, `users` table, `ToastProvider`, `NotificationSystem`, `themeInitScript.ts`

The section already exists — `settings.notifications` with five toggles wired through `settings.updateNotifications`. Every one of those answers *what to notify about*. This adds the first *where* control, as a second group in the same panel.

**The design decision that has to be made first.** KAIROS has **two** independent on-screen surfaces: the toast viewport (1.1) and the floating notification popups (6.2-5). The reason 1.1 specifies bottom-left is that top-right and bottom-right were already taken. The moment position becomes user-chosen, that static reasoning collapses — two surfaces cannot both own the corner the user picked.

**Resolution: one preference, not two.** `notificationPosition` positions the *notification popups*; the toast stack automatically takes the **diagonally opposite** corner. The user makes one decision, a collision is structurally impossible, and nobody has to reason about two dropdowns interacting. Rejected alternatives: two independent pickers (invites the exact collision this plan is fixing), and a free-form corner grid (nine cells for six valid answers).

**Do:**

1. **Schema.** Add `notificationPosition` to `users`, defaulting to `'top-right'` (today's behaviour — an existing user must see no change until they ask for one). Enum: `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`. Six values rather than four edges, because "top" and "bottom" alone leave the horizontal anchor undefined and the corners are what people actually point at.
2. **Router.** Extend `updateNotifications`'s Zod input with the enum — the mutation already spreads `input` into the update, so no new procedure is needed.
3. **Settings UI.** A picker rendered as a miniature screen with six selectable slots, plus a **Preview** button that fires a real sample toast into the chosen slot. A position control the user cannot see the result of is a guess; the preview is what makes it a choice. *Mockup: proposal §13.*
4. **Drive both surfaces from CSS custom properties** — `--notif-anchor-*` set once on the document root — rather than conditional class strings in two components. The toast viewport derives its own anchor by inverting the value.
5. **Derive the animation direction from the edge.** A toast anchored top slides down, bottom slides up, and both are suppressed under `prefers-reduced-motion` (the codebase honours it in 11 places; match).
6. **Mobile collapses to two options.** Corners are meaningless at 375 px. Below `lg`, `*-left`/`*-center`/`*-right` all resolve to full-width top or bottom, and bottom keeps the `bottom-24` offset that clears the nav (5.1, 5.2). Say so in the settings UI rather than letting the choice silently not apply.
7. **Pre-paint it.** Add the value to `themeInitScript` alongside `railPinned` and the accent (3.2), so a toast firing early in the page lifecycle does not appear in the default corner and jump. Same CSP-hash bump, ideally the same commit.
8. **Localize** the six labels and the section heading into `en` and `bg` together.

**Acceptance:** set position to bottom-left, press Preview, see the sample toast bottom-left; reload and it is still bottom-left with no flash from the top-right default; the notification popups occupy bottom-left and the toast stack top-right, never both.

### 6.8 — Remove the glow from buttons · **NEW-2**

> **New scope**, and a design-system decision rather than a defect. Bundled into wave 6 because it touches many of the same files as 6.1–6.4 and should land as one visual change, not scattered across six PRs.

Accent-coloured drop shadows are used as a glow on interactive elements throughout the app: **41 uses of `shadow-accent`**, plus `shadow-accent-primary/20`–`/30`, ad-hoc `shadow-[0_0_15px_rgb(var(--accent-primary)/0.3)]`, and the `.purple-glow` / `.purple-glow-soft` / `.progress-bar-glow` utilities in `globals.css`.

**Do:**

- Remove the glow from every **button and interactive control**. A primary button is identified by its accent fill; the halo adds no information and is the single strongest "different generation of UI" tell between the older tier (`TaskTimelineClient`, `RoleSelectionModal`, `CreateEventForm`) and the newer one.
- Keep depth where depth is doing real work — a neutral `--shadow-md`/`--shadow-lg` on cards, modals, popovers and the toast viewport. This is a rule about **coloured** glow on controls, not about elevation.
- Retire `--shadow-accent` from `@theme inline`, or redefine it as a neutral elevation shadow so the 41 call sites degrade correctly in one edit rather than 41. **Prefer redefining first, then removing the class in a follow-up** — a single token change is reviewable, and a 41-file find-and-replace is not.
- Drop `.purple-glow`, `.purple-glow-soft` and `.progress-bar-glow` from `globals.css` once their call sites are clear.
- Replace glow-on-hover with something that survives greyscale and reduced-motion: a border-colour step, a brightness change (`hover:brightness-110` is already the newer tier's idiom), or a neutral elevation bump.
- **Leave `:focus-visible` rings alone.** They are an accessibility affordance, not decoration, and the audit lists them under what is already good.

*Applied throughout the mockups in [ux-fix-ui-proposal.html](ux-fix-ui-proposal.html) — no button in that document carries a coloured shadow.*

### 6.9 — Remaining items

| Item | Fix |
|---|---|
| **P1-30** workspace menu dead-ends with no orgs | Use `OrgEmptyState` from 2.1 |
| **P1-33** AI budget invisible on `/chat/ai` | Render `agent.rateLimitStatus` on the console, not only in the floating widget |
| **P1-34** consent links to unwritten policies | Write `privacyBody` / `termsBody` / `securityBody`, or remove the checkbox. **Needs a decision — likely legal input.** |
| **P1-35** no `Accept-Language` detection | [i18n/config.ts](../../src/i18n/config.ts) reads only `NEXT_LOCALE`, falls back to `en`. Read the header; a Bulgarian visitor to a Bulgarian-market product should not land in English |
| **P1-36** calendar state not in the URL | Move `view` and `anchor` into search params. Drag-to-reschedule and arrow-key navigation are separate features — track, do not bundle |
| **P1-37** ICS is one-shot, export is buried | Add a subscribable token URL; surface both under Settings → Data as well as Security |
| **P2-39** remaining hardcoded English | `"Kairos AI"` ×2 in `SideNav`, `A1ChatWidgetOverlay` aria-labels, `"RSVPs"` / `"No event data yet."` in `publish`, `"Organization name…"` in `OrgSwitcher`, `MemoryPanel` / `AiTaskPlannerPanel` / `ProjectIntelligenceChat` placeholders, `verify-email`, `reset-password`, and the root `error.tsx` / `not-found.tsx` / `loading.tsx` — the pages shown precisely when something has gone wrong |
| **P2-40** meaningless "Event Progress" % | `(likes + comments) / max(...)` makes the top event always 100 %. Replace with something actionable (RSVPs vs. capacity, or days remaining) and drop the sidebar's duplicate `getPublicEvents({ limit: 50 })` — two requests, two sources of truth |
| **P2-41** menu ARIA without menu behaviour | `WorkspaceMenu` uses `role="menu"`/`menuitem` with no roving tabindex or arrow keys. `notes/Menu.tsx` does it correctly — copy it |
| **P2-43** `ProjectIntelligenceChat.tsx` is 105 KB | Split. It is embedded across the app, so it is a real first-load cost and effectively unreviewable |

---

## Guardrails to add along the way

Cheap tests that stop these specific defects recurring:

- **Route assertion:** every static `href` in `CommandPalette` and `SideNav` resolves to a page file. (P0-3)
- **i18n parity** already exists and blocks incomplete locales — extend it to fail on new literal strings in `src/components/layout` and `src/components/notifications`, the two worst offenders. (P1-20-1, P2-39)
- **CSP hash test** already exists; it will catch the 3.2 and 6.5 script edits. Nothing to add.
- **Orphan check:** a lint rule or script flagging component files with zero importers. This is what let a 14 KB project-chat implementation and a 32 KB notes list sit in the bundle. (P0-7, P2-42)

## Open questions

1. **P1-34** — do the privacy, terms and security pages have content pending, or does the consent checkbox need to come out until they do? This is the one item that cannot be closed from inside the codebase.
2. **P1-10** — should `/create` become a genuine creation surface, or should the nav item be renamed to match the task timeline it renders? The plan assumes the former; the latter is an hour instead of a day.
3. **P1-36** — drag-to-reschedule and calendar keyboard navigation are new features, not fixes. In or out of this effort?

## Corrections to the audit

Two small things found while verifying, neither of which changes the priorities:

- **`ConversationsRail.tsx` is not orphaned** (P2-42) — `AIChatPageClient.tsx` imports it. It still wants deleting, but a caller has to be migrated first.
- **P0-2's fix note points at "P1-31"** for the empty-state CTAs; P1-31 is the skip link. The intended reference is the org empty state, handled here in 2.1.
