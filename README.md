# KAIROS

<div align="center">
  <img src="public/logo_white.png" width="150" />
</div>

<div align="center">
  <strong>One workspace for coordinating teams, running projects, publishing events — with an AI agent suite built in</strong>
</div>

## About

KAIROS is a web platform that keeps the whole arc of a piece of work in one place: open a workspace, plan and track the work, then publish the public event that comes out of it. On top of that sits a multi-agent AI layer that can answer questions about your workspace and draft real changes to it — every write goes through draft, confirmation, and apply, so nothing lands without your approval.

## Workspaces

Three ways to work, one system underneath. Roles, access codes and progress tracking behave the same everywhere.

- **Organizations** — dedicated spaces with roles (moderator, member, individual), per-member permissions, custom org roles, invites and join codes.
- **Teams** — project-level collaborators, real-time chat and timelines against the same project.
- **Personal** — private notes and deadlines that never reach a team feed.

## What it does

### Projects and tasks
- Interactive timelines and milestones
- Tasks with status, priority, assignee, due date, acceptance criteria
- Task comments and a full activity log
- Progress dashboards and charts

### Notes
- Sticky notes grouped into notebooks, with sharing
- Password-locked notes — content is encrypted with AES-256-GCM under a key derived from the password, and a locked note is never sent to the AI layer
- Full-text search across the workspace

### Events
- Public event pages with images and details
- Region targeting across the Bulgarian regions, picked on a map
- RSVPs (going / maybe / not going), comments and likes
- Reminder notifications for upcoming events

### Communication
- Direct messages and project chat over a standalone WebSocket server
- Live notifications for tasks, projects, events, likes, comments and replies
- Calendar view unifying tasks, events and dated notes

### AI agent suite
Five conversational agents, routed automatically — the user never has to pick one. A1 is the front door and is strictly read-only; anything that changes data is handed to the specialist that owns it.

| Agent | Domain | Writes |
|-------|--------|--------|
| A1 Workspace Concierge | Questions, summaries, next actions, routing | No |
| A2 Task Planner | Turns goals (or an uploaded PDF) into a backlog | Yes |
| A3 Notes Vault | Creates, edits and deletes notes | Yes |
| A4 Events Publisher | Events, comments, RSVPs and likes | Yes |
| A5 Organization Admin | Membership, roles and permissions | Yes |

Two scheduled agents run on the clock, opt-in per user under Settings:

- **Daily Brief** — a summary of what needs attention.
- **Risk Radar** — overdue work and stalled projects. Detection is a database query rather than a model call, so findings are reproducible and still appear when the AI budget is spent.

Supporting machinery: per-user memory with agent scoping, conversation history with rolling summaries, an undo window on applied plans, a tool inspector, per-user rate limits (interactive and scheduled budgets are separate), and structured observability on every model call.

## Built with

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, GSAP, Framer Motion
- **API:** tRPC v11
- **Auth:** NextAuth.js v5 — credentials with argon2, Google and Microsoft Entra ID, email verification, password reset, login lockout
- **Database:** PostgreSQL (Supabase) with Drizzle ORM
- **Real-time:** Socket.IO in a standalone server process, optional Redis fan-out for multi-instance
- **AI:** any OpenAI-compatible endpoint with native tool calling, configured per environment
- **Services:** Resend (email), UploadThing (uploads), Google Maps (region picker)
- **i18n:** next-intl — English and Bulgarian offered; German, Spanish and French message files exist but are incomplete and not exposed
- **Testing:** Vitest, Testing Library, plus a separate integration suite

## Project structure

```
KAIROS/
├── docs/                   # Design docs, agent specs, research
├── public/                 # Static assets
├── scripts/                # llm-probe, SQL helpers (search indexes)
├── src/
│   ├── app/                # App Router: (app), (auth), (marketing), api
│   ├── components/         # Feature-based React components
│   ├── hooks/              # Shared client hooks
│   ├── i18n/               # Locale config and message files
│   ├── lib/                # Utilities
│   ├── server/
│   │   ├── api/            # tRPC routers
│   │   ├── auth/           # NextAuth configuration
│   │   ├── billing/        # Entitlement seam (no payments yet)
│   │   ├── db/             # Drizzle schema and migrations
│   │   ├── llm/            # Agents: orchestrator, prompts, context, tools
│   │   ├── security/       # Rate limiting, encryption
│   │   └── ws/             # WebSocket emit and signing
│   ├── styles/             # Global styles
│   └── trpc/               # tRPC client setup
├── tests/                  # Unit, component and integration tests
├── ws-server/              # Standalone WebSocket server and scheduler
├── .env.example            # Environment template
├── drizzle.config.ts       # Database/ORM configuration
├── next.config.ts          # Next.js configuration
└── server.ts               # Custom HTTP server entry
```

## Getting started

Requires Node 20+, pnpm 10, and a PostgreSQL database.

1. Clone the repository.
2. Copy `.env.example` to `.env` and fill in the values. `AUTH_SECRET`, `DATABASE_URL` and `WS_SECRET` are required and validated at startup; OAuth, uploads, email, maps and Redis are optional and their features stay off until set.
3. Install dependencies: `pnpm install`
4. Push the database schema: `pnpm db:push`
5. Start the app: `pnpm dev`
6. Start the WebSocket server in a second terminal: `pnpm ws:dev`

Optional:

- Verify your AI endpoint supports native tool calling: `pnpm llm:probe`
- Add search indexes: `psql "$DATABASE_DIRECT_URL" -f scripts/sql/search-indexes.sql`

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Next.js dev server |
| `pnpm ws:dev` | WebSocket server and AI scheduler |
| `pnpm build` / `pnpm start` | Production build and serve |
| `pnpm check` | Lint and typecheck |
| `pnpm test` | Unit and component tests |
| `pnpm test:integration` | Integration suite (needs a real database) |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle workflows |
| `pnpm format:write` | Prettier |
| `pnpm llm:probe` | Check the configured model for tool-calling support |

## Developer

**Tina Tuncheva** — Full-stack developer  
Email: tinatuncheva27@itpg-varna.bg

---

<div align="center">
  <em>KAIROS. For the perfect timing.</em>
</div>
