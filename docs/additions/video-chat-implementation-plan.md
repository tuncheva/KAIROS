# Video Chat Implementation Plan for KAIROS `/chat` Page

## 1. Overview

This document outlines how to add real-time video/audio calling to the existing `/chat` page using a **free, open-source provider**. The chosen approach integrates with the existing Socket.IO infrastructure and tRPC API layer.

## 2. Provider Selection: LiveKit (Open Source)

**Recommended: [LiveKit](https://livekit.io/)**

| Criteria | LiveKit |
|----------|---------|
| License | Apache 2.0 |
| Free Tier | Self-hosted (unlimited) or LiveKit Cloud (free tier: 100 participants/month) |
| SDK | `livekit-client` (browser), `livekit-server-sdk` (Node.js) |
| Protocols | WebRTC (SFU architecture) |
| Features | Video, audio, screen share, recording, data channels |
| React Support | `@livekit/components-react` — pre-built UI components |

**Why LiveKit over alternatives:**
- **vs. Jitsi**: Lighter SDK, better React integration, native TypeScript support.
- **vs. PeerJS/simple-peer**: LiveKit uses an SFU (Selective Forwarding Unit), which scales beyond 2 participants. P2P mesh (PeerJS) degrades after 3-4 users.
- **vs. Daily/Twilio**: These are SaaS-only with no self-hosted option. LiveKit can be self-hosted for zero cost.

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (ChatClient.tsx)                                     │
│  ┌──────────────────┐   ┌──────────────────────────────────┐ │
│  │  Chat UI (text)   │   │  <LiveKitRoom> Video UI          │ │
│  │  Socket.IO msgs   │   │  @livekit/components-react        │ │
│  └──────────────────┘   └──────────────────────────────────┘ │
│          │                          │                         │
│          ▼                          ▼                         │
│   WS Server :3001           LiveKit Server :7880              │
│   (Socket.IO)               (WebRTC SFU)                     │
│          │                          │                         │
│          ▼                          ▼                         │
│   Next.js API (tRPC)        tRPC: call.createRoom             │
│   chat.sendMessage          call.getToken                     │
└──────────────────────────────────────────────────────────────┘
```

### Key Design Decisions:
1. **Signaling through tRPC** — Room creation and token generation happen via tRPC procedures (consistent with the rest of the app).
2. **Call state via Socket.IO** — Incoming call notifications, call-ended events, and ringing state are broadcast through the existing Socket.IO infrastructure (`user:{userId}` rooms).
3. **No new database tables** — Call metadata (active rooms) can be stored in Redis or in-memory on the WS server. If call history is needed later, a `call_logs` table can be added.

## 4. Dependencies to Install

```bash
pnpm add livekit-client livekit-server-sdk @livekit/components-react @livekit/components-styles
```

## 5. Implementation Steps

### 5.1 LiveKit Server Setup

**Development:** Run LiveKit locally via Docker:
```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  -e LIVEKIT_KEYS="devkey:secret" \
  livekit/livekit-server
```

**Production:** Deploy LiveKit server on the same VPS or use LiveKit Cloud free tier.

**Environment Variables** (add to `.env`):
```env
LIVEKIT_API_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

### 5.2 Server-Side: tRPC Router (`src/server/api/routers/call.ts`)

```ts
// New tRPC router for video calls
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AccessToken } from "livekit-server-sdk";

export const callRouter = createTRPCRouter({
  getToken: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const roomName = `conversation-${input.conversationId}`;
      const participantName = ctx.session.user.name ?? ctx.session.user.email ?? "User";
      const participantIdentity = ctx.session.user.id;

      const token = new AccessToken(
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET,
        { identity: participantIdentity, name: participantName }
      );

      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
      });

      return {
        token: await token.toJwt(),
        roomName,
        wsUrl: process.env.LIVEKIT_API_URL,
      };
    }),
});
```

Register in `src/server/api/root.ts`:
```ts
call: callRouter,
```

### 5.3 Socket.IO Events for Call Signaling

Add to `ws-server/index.ts` event handlers:
- `call:initiate` — Sender broadcasts to the conversation room that a call has started.
- `call:ring` — Relayed to the target user's room (`user:{userId}`).
- `call:accept` — Target user accepted; both parties open LiveKit.
- `call:reject` — Target user declined.
- `call:end` — Either party ended the call.

Add to `src/server/ws/emit.ts`:
```ts
export function emitCallEvent(userIds: string[], payload: CallEventPayload) {
  for (const uid of userIds) {
    publishUserEvent(uid, "call:event", payload);
  }
}
```

### 5.4 Client-Side: Video Call UI Component

Create `src/components/chat/VideoCallOverlay.tsx`:

```tsx
"use client";

import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";

interface VideoCallOverlayProps {
  token: string;
  wsUrl: string;
  roomName: string;
  onDisconnect: () => void;
}

export function VideoCallOverlay({ token, wsUrl, roomName, onDisconnect }: VideoCallOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90">
      <LiveKitRoom
        serverUrl={wsUrl}
        token={token}
        connect={true}
        onDisconnected={onDisconnect}
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
```

### 5.5 Integration in ChatClient.tsx

Add a call button in the chat header (next to conversation info):

```tsx
// In ChatClient.tsx — add to the conversation header area
<button
  onClick={() => initiateCall(selectedConversationId)}
  className="p-2 rounded-lg text-fg-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition"
  title="Start video call"
>
  <Video size={18} />
</button>
```

Call flow in ChatClient:
1. User clicks the video call button.
2. `api.call.getToken.mutate({ conversationId })` → receives `{ token, wsUrl, roomName }`.
3. Emit `call:ring` via Socket.IO to the other user.
4. Show `<VideoCallOverlay>` full-screen.
5. Other user receives `call:ring` event → shows incoming call UI.
6. On accept: other user also calls `getToken` and opens `<VideoCallOverlay>`.
7. On disconnect/hang-up: emit `call:end`, unmount overlay.

### 5.6 Incoming Call Notification Component

Create `src/components/chat/IncomingCallBanner.tsx`:
- Listens for `call:ring` Socket.IO events.
- Shows a non-blocking banner with caller name, Accept/Decline buttons.
- On accept: fetches token and opens `VideoCallOverlay`.
- Auto-dismiss after 30 seconds if no response.

## 6. File Changes Summary

| Action | File |
|--------|------|
| **Create** | `src/server/api/routers/call.ts` — tRPC router for tokens |
| **Create** | `src/components/chat/VideoCallOverlay.tsx` — LiveKit room UI |
| **Create** | `src/components/chat/IncomingCallBanner.tsx` — Incoming call notification |
| **Modify** | `src/server/api/root.ts` — Register `callRouter` |
| **Modify** | `src/server/ws/emit.ts` — Add `emitCallEvent` |
| **Modify** | `ws-server/index.ts` — Handle `call:*` events |
| **Modify** | `src/components/chat/ChatClient.tsx` — Add call button + call state |
| **Modify** | `src/hooks/useWebSocket.ts` — Listen to `call:*` events |
| **Modify** | `src/env.js` — Add `LIVEKIT_*` env vars |
| **Modify** | `.env` — Add LiveKit credentials |

## 7. Security Considerations

- **Token scoping**: Each LiveKit token is scoped to a specific room and user identity. Tokens are short-lived (default 6h, configurable).
- **Room naming**: Room names are derived from `conversationId`, ensuring only users with access to that conversation can request tokens (enforced in tRPC via `protectedProcedure` + conversation membership check).
- **No direct client-to-LiveKit auth**: Clients never see the API key/secret — only server-generated JWT tokens.
- **TURN/STUN**: LiveKit server includes built-in TURN for NAT traversal. No external TURN server needed.

## 8. Testing Strategy

1. **Unit tests**: Mock `livekit-server-sdk` in `call.ts` router tests, verify token generation and authorization.
2. **Integration test**: Use LiveKit's local server in Docker for CI, verify room creation and participant join.
3. **E2E test**: Two browser tabs, verify video/audio connection established.
4. **Network resilience**: Test with throttled connections (Chrome DevTools) to verify reconnection behavior.

## 9. Future Enhancements

- **Screen sharing**: Already supported by LiveKit's `<VideoConference>` component.
- **Group calls**: SFU architecture supports N participants — extend to project-scoped group calls.
- **Call recording**: LiveKit supports server-side recording via Egress API.
- **Call history**: Add `call_logs` table to track call duration, participants, timestamp.
