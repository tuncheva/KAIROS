# WebSockets implementation (reference) — how this repo does it, and how to make another Next.js + Socket.io app match

This document explains the **exact WebSocket implementation in this repository** (Task Manager) and provides a **prescriptive checklist** to bring a different Next.js + Socket.io app in line with it.

> Key idea: WebSockets are used for **real-time invalidation** (push events trigger React Query invalidations). The **DB remains the source of truth**; WS is best-effort.

---

## 1) Component inventory (ALL WS-related pieces)

### Standalone WS server (Socket.io)

- Entry point / server bootstrap: [`ws-server/index.ts`](../../ws-server/index.ts:1)
  - HTTP server + health endpoint: [`/health`](../../ws-server/index.ts:20)
  - **Internal emit fallback** (Redis-free dev mode): [`/internal/emit`](../../ws-server/index.ts:27)
  - Socket.io server config (CORS, transports): [`new Server(..., { cors, transports })`](../../ws-server/index.ts:62)
  - Optional Redis adapter (multi-instance): [`createAdapter(pubClient, subClient)`](../../ws-server/index.ts:71)
  - App-level Redis subscriber for app->WS fanout: [`psubscribe(ws:*)`](../../ws-server/index.ts:84)
  - Socket auth middleware (ticket verification): [`io.use(...)`](../../ws-server/index.ts:121)
  - Connection handler + auto-join private room: [`socket.join(user:{userId})`](../../ws-server/index.ts:139)

### WS authentication (HMAC signed short-lived ticket)

- Ticket signing + verification: [`ws-server/auth.ts`](../../ws-server/auth.ts:1)
  - Verify: [`verifyWsTicket()`](../../ws-server/auth.ts:16)
  - Sign: [`signWsTicket()`](../../ws-server/auth.ts:70)
  - Security: constant-time compare via [`timingSafeEqual`](../../ws-server/auth.ts:33)
  - TTL default: 120s via [`ttlSeconds ?? 120`](../../ws-server/auth.ts:75)

### Room / topic model (authorization for joins)

- Join and leave handlers: [`ws-server/rooms.ts`](../../ws-server/rooms.ts:1)
  - `join:workspace` resolves workspaceId -> tenantId then joins `tenant:{tenantId}`: [`join:workspace`](../../ws-server/rooms.ts:60)
  - `join:project` verifies tenant membership + project membership then joins `project:{projectId}`: [`join:project`](../../ws-server/rooms.ts:107)
  - `join:tenant` exists (direct tenantId join): [`join:tenant`](../../ws-server/rooms.ts:29)
  - Unauthorized joins hard-disconnect the socket: [`socket.disconnect(true)`](../../ws-server/rooms.ts:95)

### Next.js API route for issuing WS tickets

- Token endpoint: [`src/app/api/ws/token/route.ts`](../../src/app/api/ws/token/route.ts:1)
  - Requires session auth: [`requireAuth()`](../../src/app/api/ws/token/route.ts:2)
  - Signs ticket with WS_SECRET: [`signWsTicket(...)`](../../src/app/api/ws/token/route.ts:27)
  - Returns `{ token, expiresAt }`: [`NextResponse.json(...)`](../../src/app/api/ws/token/route.ts:33)

### Next.js server-side publisher (app -> WS server)

- Publish helper used by API mutations / notification creators: [`src/server/redis/publisher.ts`](../../src/server/redis/publisher.ts:1)
  - **Primary path**: Redis pub/sub with channels `ws:user:{id}` / `ws:tenant:{id}` / `ws:project:{id}`: [`publish(...)`](../../src/server/redis/publisher.ts:53)
  - **Dev fallback** (no `REDIS_NATIVE_URL`): HTTP POST to WS server internal endpoint: [`/internal/emit`](../../src/server/redis/publisher.ts:71)
  - Shared event envelope: `{ event, payload }`: [`JSON.stringify({ event, payload })`](../../src/server/redis/publisher.ts:59)
  - Convenience methods:
    - [`publishUserEvent()`](../../src/server/redis/publisher.ts:97)
    - [`publishNotificationToUser()`](../../src/server/redis/publisher.ts:113) (always `notification:new`)
    - [`publishTenantEvent()`](../../src/server/redis/publisher.ts:120)
    - [`publishProjectEvent()`](../../src/server/redis/publisher.ts:128)

### Client hooks (Socket.io client + lifecycle)

- Token fetch/cache (React Query): [`src/hooks/useWsToken.ts`](../../src/hooks/useWsToken.ts:1)
  - Fetch token: [`fetch(/api/ws/token)`](../../src/hooks/useWsToken.ts:11)
  - `staleTime: 90_000` to refetch before 120s expiry: [`staleTime`](../../src/hooks/useWsToken.ts:24)

- Socket connection + listeners: [`src/hooks/useWebSocket.ts`](../../src/hooks/useWebSocket.ts:1)
  - Creates Socket.io connection with `auth` **as a function** so reconnections always use latest token: [`auth: (cb) => cb({ token: tokenRef.current })`](../../src/hooks/useWebSocket.ts:44)
  - Reconnection policy: [`reconnectionDelay`](../../src/hooks/useWebSocket.ts:51)
  - Auto-join workspace on connect/reconnect: [`socket.emit(join:workspace)`](../../src/hooks/useWebSocket.ts:61)
  - Reconnect catch-up invalidation: [`wasConnected` branch invalidates notifications](../../src/hooks/useWebSocket.ts:68)
  - Event listeners (see event list below): [`socket.on(notification:new, ...)`](../../src/hooks/useWebSocket.ts:92)
  - Room join/leave for project-scoped events: [`useProjectRoom()`](../../src/hooks/useWebSocket.ts:205)
  - Uses a module-level singleton for cross-hook access: [`globalSocket`](../../src/hooks/useWebSocket.ts:11)

- Mount point ensuring no SSR issues: [`src/components/layout/WebSocketInitializer.tsx`](../../src/components/layout/WebSocketInitializer.tsx:1)
  - Note about `dynamic(..., { ssr: false })` lives here: [`WebSocketInitializer`](../../src/components/layout/WebSocketInitializer.tsx:5)

### Deployment / runtime wiring

- Local dev script to start WS server: [`ws:dev`](../../package.json:22)
- Docker compose runs a separate `ws-server` service on port 3001 with Redis: [`docker-compose.yml`](../../docker-compose.yml:52)
- Implementation overview doc already in repo: [`docs/websockets/README_websockets.md`](../../docs/websockets/README_websockets.md:1)

---

## 2) Runtime architecture (how the pieces talk)

### High-level flow

1. Browser fetches a short-lived WS ticket from Next.js.
2. Browser connects to standalone Socket.io server (port 3001) and authenticates using that ticket.
3. WS server verifies ticket, extracts userId and auto-joins a **private room** `user:{userId}`.
4. Browser joins broader rooms:
   - `join:workspace` -> server authorizes and joins `tenant:{tenantId}`
   - `join:project` -> server authorizes and joins `project:{projectId}`
5. Any Next.js server mutation that should trigger real-time updates calls `publish*Event()` (usually after writing DB state).
6. WS server receives events via Redis subscription (or HTTP fallback) and emits to the matching Socket.io room.
7. Browser listeners invalidate React Query caches; UI refetches via normal HTTP APIs.

### Mermaid overview

```mermaid
flowchart LR
  B[Browser Next.js client] -->|GET /api/ws/token| A[Next.js API]
  A -->|{token, expiresAt}| B

  B -->|io connect auth token| W[WS server Socket.io]
  W -->|verify ticket| W
  W -->|join user:userId| W

  B -->|emit join:workspace workspaceId| W
  W -->|db lookup + auth| D[(Postgres)]
  W -->|join tenant:tenantId| W

  A -->|publish ws:user:id event payload| R[(Redis)]
  R -->|psubscribe ws:*| W
  W -->|io.to room emit| B

  B -->|invalidateQueries| Q[React Query cache]
  Q -->|refetch REST| A
```

---

## 3) Exact implementation details (prescriptive)

### 3.1 Authentication: short-lived HMAC ticket (not cookies in WS)

**Why**: avoids putting session cookies or tokens into query strings; keeps WS auth independent and log-safe.

- Ticket format is:
  - `base64url(JSON payload) + '.' + HMAC-SHA256(base64url(payload), WS_SECRET)`
  - See verification logic in [`verifyWsTicket()`](../../ws-server/auth.ts:16)
- Ticket payload: `{ userId, sessionId, iat, exp }` defined in [`WsTicketPayload`](../../ws-server/auth.ts:3)
- Expiry enforced in verifier: [`Date.now() > payload.exp * 1000`](../../ws-server/auth.ts:60)

**Where it’s issued**:

- Token endpoint: [`GET /api/ws/token`](../../src/app/api/ws/token/route.ts:6)
  - Rejects if `WS_SECRET` missing/too short: [`503 WebSocket service unavailable`](../../src/app/api/ws/token/route.ts:17)

**Where it’s checked**:

- Socket.io middleware reads from handshake auth (frame body), not URL: [`socket.handshake.auth.token`](../../ws-server/index.ts:123)
- On failure, connection is rejected with `WS_UNAUTHORIZED`: [`next(new Error('WS_UNAUTHORIZED'))`](../../ws-server/index.ts:125)

### 3.2 Rooms/topics and authorization

Rooms are the core fanout mechanism. This repo uses three scopes:

- `user:{userId}` private inbox (server-side join only)
- `tenant:{tenantId}` workspace-wide (joined via `join:workspace`)
- `project:{projectId}` project-scoped (joined via `join:project`)

Authorization rules:

- Tenant join requires active tenant membership: [`tenantMembership.status = active`](../../ws-server/rooms.ts:43)
- Workspace join first resolves workspace -> tenant: [`workspace.tenantId`](../../ws-server/rooms.ts:70)
- Project join requires:
  - project exists and yields tenantId: [`select project.tenantId`](../../ws-server/rooms.ts:116)
  - active tenant membership: [`tenantMembership`](../../ws-server/rooms.ts:129)
  - project membership: [`projectMembership`](../../ws-server/rooms.ts:147)

Security posture:

- Unauthorized join attempts cause immediate disconnect, not silent ignore: [`socket.disconnect(true)`](../../ws-server/rooms.ts:99)
  - This prevents room probing / enumeration patterns.

### 3.3 Publishing messages: Redis pub/sub + HTTP fallback

**Message envelope**

- Messages are transported as JSON `{ event, payload }`:
  - Publisher: [`JSON.stringify({ event, payload })`](../../src/server/redis/publisher.ts:59)
  - Subscriber parses the same and emits to Socket.io: [`io.to(room).emit(parsed.event, parsed.payload)`](../../ws-server/index.ts:111)

**Channel naming**

- Redis channel is `ws:{scope}:{id}` (scope in `{ user, tenant, project }`):
  - e.g. `ws:user:123`

**Routing step**

- WS server subscribes to `ws:*` and converts channel -> room:
  - Extracts `scope` and `id`: [`const [, scope, id] = channel.split(':')`](../../ws-server/index.ts:101)
  - Builds room `${scope}:${id}`: [`const room = `${scope}:${id}``](../../ws-server/index.ts:111)

**Dev fallback (no Redis)**

- If `REDIS_NATIVE_URL` is unset, publisher uses HTTP POST:
  - [`fetch(${WS_INTERNAL_URL}/internal/emit, ...)`](../../src/server/redis/publisher.ts:80)
- WS server exposes `/internal/emit` and guards it with `x-ws-secret` header = WS_SECRET:
  - Guard: [`req.headers['x-ws-secret'] !== WS_SECRET`](../../ws-server/index.ts:30)
  - Emit: [`io.to(room).emit(event, payload)`](../../ws-server/index.ts:46)

This is intentionally **not callable by the browser**.

### 3.4 Client connection lifecycle: token refresh + reconnect catch-up

**Token caching**

- `useWsToken` uses React Query with `staleTime: 90s` so it refreshes before the server’s 120s TTL: [`staleTime: 90_000`](../../src/hooks/useWsToken.ts:27)

**Socket creation**

- Socket connects only after a token is present (`hasToken` gate): [`if (!enabled || !hasToken) return`](../../src/hooks/useWebSocket.ts:35)

**Critical detail: auth function**

- Socket.io client auth is provided as a function so reconnections always use latest token:
  - [`auth: (cb) => cb({ token: tokenRef.current })`](../../src/hooks/useWebSocket.ts:44)

**Reconnect catch-up**

Redis pub/sub does not queue missed messages. On reconnect, this repo forces a refresh:

- On reconnect (not initial connect), invalidate notifications queries: [`if (wasConnected) ... invalidateQueries`](../../src/hooks/useWebSocket.ts:68)

### 3.5 Heartbeat / keepalive

This implementation relies on **Socket.io’s built-in ping/pong heartbeat** (no custom heartbeat messages are defined in this repo).

No explicit `ping`/`pong` events are implemented; stability is achieved via:

- Socket.io transport handling (websocket + polling): [`transports`](../../ws-server/index.ts:68)
- Reconnect policy on the client: [`reconnectionDelay` settings](../../src/hooks/useWebSocket.ts:51)

### 3.6 Scaling and multi-instance behavior

Two layers are used in production-like setups:

1. **Socket.io Redis adapter** for multi-instance socket routing:
   - Enabled when `REDIS_NATIVE_URL` is set: [`if (REDIS_NATIVE_URL) ... io.adapter(createAdapter(...))`](../../ws-server/index.ts:72)
2. **App->WS publish bus** for routing app events to rooms:
   - WS server `psubscribe(ws:*)` and emits to rooms: [`appSubClient.psubscribe`](../../ws-server/index.ts:92)

If `REDIS_NATIVE_URL` is not set, the system runs in **single-instance mode** (dev) with the publisher HTTP fallback:

- Warning: [`running in single-instance mode`](../../ws-server/index.ts:115)

### 3.7 Event catalog (what the client listens for)

All listeners live in [`useWebSocket()`](../../src/hooks/useWebSocket.ts:14). They do **React Query invalidations**, not direct UI state updates.

#### Universal bell refresh

- `notification:new` (generic)
  - Listener: [`socket.on('notification:new', ...)`](../../src/hooks/useWebSocket.ts:98)
  - Published via server helper: [`publishNotificationToUser()` emits notification:new](../../src/server/redis/publisher.ts:105)

This is the key simplification: adding a new notification type generally only requires server-side DB write + `publishNotificationToUser`.

#### Invite events (legacy + invites list)

- `notification:invite`, `notification:invite-accepted`, `notification:invite-declined`, `notification:invite-revoked`
  - Listeners: [`notification:invite*`](../../src/hooks/useWebSocket.ts:107)
  - Example publisher usage: [`notifyTenantInviteReceived()` publishes notification:invite](../../src/server/notifications/invites.ts:28)

#### Project room events

- `task:created`, `task:updated`, `task:deleted`
  - Listeners: [`task:* listeners`](../../src/hooks/useWebSocket.ts:135)
- `comment:added`
  - Listener: [`socket.on('comment:added', ...)`](../../src/hooks/useWebSocket.ts:179)

#### User room events

- `task:assigned`
  - Listener: [`socket.on('task:assigned')`](../../src/hooks/useWebSocket.ts:172)

#### Tenant room events

- `workspace:member_joined`
  - Listener: [`socket.on('workspace:member_joined')`](../../src/hooks/useWebSocket.ts:187)

---

## 4) How to fix another Next.js + Socket.io app to match this repo

This is the **prescriptive alignment checklist**. Treat each item as required unless you intentionally deviate.

### A. Topology and process model

- [ ] Run a **separate Socket.io server process** (not in Next.js routes) similar to [`ws-server/index.ts`](../../ws-server/index.ts:1).
- [ ] Expose `GET /health` on the WS server for liveness checks: [`/health`](../../ws-server/index.ts:21).
- [ ] Ensure WS server and Next.js share the same `WS_SECRET` value.

### B. Authentication (must match semantics)

- [ ] Implement `GET /api/ws/token` in Next.js that:
  - [ ] Requires logged-in user session: [`requireAuth()`](../../src/app/api/ws/token/route.ts:2)
  - [ ] Creates **short-lived** HMAC ticket (120s): [`ttlSeconds = 120`](../../src/app/api/ws/token/route.ts:26)
  - [ ] Returns `{ token, expiresAt }`: [`NextResponse.json`](../../src/app/api/ws/token/route.ts:33)
- [ ] Implement WS server middleware that:
  - [ ] Reads token from `socket.handshake.auth.token`, not URL: [`handshake.auth`](../../ws-server/index.ts:123)
  - [ ] Rejects with error `WS_UNAUTHORIZED` when missing/invalid: [`next(new Error('WS_UNAUTHORIZED'))`](../../ws-server/index.ts:125)

### C. Client connection behavior

- [ ] Fetch and cache token using React Query with refresh-before-expiry:
  - [ ] `staleTime` < token TTL, match `90s` vs `120s`: [`staleTime: 90_000`](../../src/hooks/useWsToken.ts:27)
- [ ] Create Socket.io client with `auth` as a function:
  - [ ] [`auth: (cb) => cb({ token: tokenRef.current })`](../../src/hooks/useWebSocket.ts:44)
  - This prevents stale tokens on reconnection.
- [ ] On connect, always join the workspace room (see rooms section): [`socket.emit('join:workspace', workspaceId)`](../../src/hooks/useWebSocket.ts:64)
- [ ] On reconnect, invalidate notifications to catch up: [`if (wasConnected) invalidateQueries`](../../src/hooks/useWebSocket.ts:68)

### D. Rooms and authorization

- [ ] Server auto-joins `user:{userId}` for every connection: [`socket.join(user:${userId})`](../../ws-server/index.ts:145)
- [ ] Implement `join:workspace` that resolves workspaceId -> tenantId and authorizes by active membership: [`join:workspace`](../../ws-server/rooms.ts:60)
- [ ] Implement `join:project` that validates tenant membership and project membership: [`join:project`](../../ws-server/rooms.ts:107)
- [ ] Disconnect sockets on unauthorized room join attempts: [`socket.disconnect(true)`](../../ws-server/rooms.ts:99)

### E. Publishing and scaling

- [ ] Prefer Redis pub/sub with channel pattern `ws:{scope}:{id}`:
  - [ ] Publisher uses `redis.publish(channel, JSON.stringify({ event, payload }))`: [`publish()`](../../src/server/redis/publisher.ts:53)
  - [ ] WS server subscribes `ws:*` and emits to `${scope}:${id}` room: [`pmessage handler`](../../ws-server/index.ts:97)
- [ ] For multi-instance WS servers, enable Socket.io Redis adapter:
  - [ ] [`io.adapter(createAdapter(pubClient, subClient))`](../../ws-server/index.ts:82)
- [ ] In dev, support Redis-free fallback via internal HTTP emit endpoint:
  - [ ] Next.js publisher calls WS server [`/internal/emit`](../../src/server/redis/publisher.ts:80)
  - [ ] WS server endpoint validates `x-ws-secret`: [`x-ws-secret` check](../../ws-server/index.ts:30)

### F. Event schema and client behavior

- [ ] Standardize on event envelope `{ event, payload }` for app->WS transport: [`{ event, payload }`](../../src/server/redis/publisher.ts:59)
- [ ] Implement `notification:new` universally for bell refresh:
  - [ ] Server publishes via [`publishNotificationToUser()`](../../src/server/redis/publisher.ts:113)
  - [ ] Client listens and invalidates notification queries: [`notification:new listener`](../../src/hooks/useWebSocket.ts:98)

---

## 5) Common failure modes (and how to diagnose)

### 5.1 WS connects but no events arrive

Likely causes:

- Client never joined the right room:
  - Workspace-scoped events require `join:workspace`: [`socket.emit('join:workspace', workspaceId)`](../../src/hooks/useWebSocket.ts:64)
  - Project-scoped events require calling [`useProjectRoom()`](../../src/hooks/useWebSocket.ts:205)
- Server disconnected the socket due to failed auth or unauthorized join:
  - Unauthorized join triggers disconnect: [`socket.disconnect(true)`](../../ws-server/rooms.ts:99)
  - Token issues surface as `connect_error` with `WS_UNAUTHORIZED`: [`connect_error handler`](../../src/hooks/useWebSocket.ts:88)

Diagnostics:

- Browser DevTools -> WS frames: confirm `notification:new` frames appear.
- Check WS server logs for `[ws:rooms] ... DENIED` entries: [`join:workspace DENIED`](../../ws-server/rooms.ts:95)

### 5.2 Works locally but fails in production

Likely causes:

- Missing `WS_SECRET` or too short:
  - WS server exits fatally: [`FATAL: WS_SECRET missing`](../../ws-server/index.ts:14)
  - Token endpoint returns 503: [`WS_SECRET missing or too short`](../../src/app/api/ws/token/route.ts:18)
- CORS origin mismatch:
  - WS server uses `NEXT_PUBLIC_APP_URL` or defaults: [`cors.origin`](../../ws-server/index.ts:63)
- Not using Redis in a multi-instance environment:
  - Without `REDIS_NATIVE_URL`, WS server is single-instance only: [`single-instance mode`](../../ws-server/index.ts:115)

Diagnostics:

- Curl `GET /health` to ensure WS server is reachable.
- Ensure `REDIS_NATIVE_URL` is set in production (or ensure only one WS instance exists).

### 5.3 Reconnect loops / intermittent unauthorized

Likely causes:

- Client uses static `auth: { token }` instead of auth callback; token expires and reconnects keep failing.
  - Required pattern: [`auth: (cb) => cb({ token: tokenRef.current })`](../../src/hooks/useWebSocket.ts:44)
- Token cache not refreshing before expiry.
  - Required: [`staleTime: 90_000`](../../src/hooks/useWsToken.ts:27)

Diagnostics:

- Observe `connect_error` messages: [`console.warn('[ws] connect_error', err.message)`](../../src/hooks/useWebSocket.ts:88)

### 5.4 Notifications appear only after clicking the bell

Cause:

- Server writes DB notification but never publishes `notification:new`.

Fix:

- Ensure every notification insert calls [`publishNotificationToUser()`](../../src/server/redis/publisher.ts:113).
  - Example best-effort pattern: [`notifyTenantInviteReceived()`](../../src/server/notifications/invites.ts:130)

### 5.5 Events fire but UI does not update

Cause:

- Client listener does not invalidate the relevant query keys.

Fix:

- Add or correct invalidations in [`useWebSocket()`](../../src/hooks/useWebSocket.ts:92).

---

## 6) Minimal reproduction steps (for comparing two apps)

1. Start Next.js and WS server separately:
   - Next.js: [`pnpm dev`](../../package.json:21)
   - WS server: [`pnpm ws:dev`](../../package.json:22)
2. Ensure env vars are set (see repo doc): [`docs/websockets/README_websockets.md`](../../docs/websockets/README_websockets.md:47)
3. Load a workspace page; confirm in console you see connection log: [`[ws] connected`](../../src/hooks/useWebSocket.ts:61)
4. Trigger an action that creates a notification and confirm `notification:new` invalidates notification queries: [`notification:new listener`](../../src/hooks/useWebSocket.ts:98)

---

## Appendix: environment variables (what matters)

- `WS_SECRET` (required; min length 32)
  - Enforced by WS server fatal exit: [`WS_SECRET missing`](../../ws-server/index.ts:14)
  - Enforced by token endpoint 503: [`WS_SECRET missing or too short`](../../src/app/api/ws/token/route.ts:18)
- `WS_PORT` (WS server listens here): [`WS_PORT`](../../ws-server/index.ts:10)
- `NEXT_PUBLIC_WS_URL` (client connects here): [`WS_URL`](../../src/hooks/useWebSocket.ts:9)
- `REDIS_NATIVE_URL` (enables multi-instance, redis adapter, pub/sub): [`REDIS_NATIVE_URL`](../../ws-server/index.ts:12)
- `WS_INTERNAL_URL` (publisher fallback target): [`WS_INTERNAL_URL`](../../src/server/redis/publisher.ts:5)

Docker reference for production-like wiring: [`ws-server` service](../../docker-compose.yml:52)
