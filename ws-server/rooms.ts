/**
 * Room join / leave handlers for the standalone WS server.
 *
 * Rooms map to KAIROS entities:
 *   user:{userId}         — private inbox (auto-joined, server-only)
 *   org:{organizationId}  — organization-wide events
 *   project:{projectId}   — project-scoped events
 *
 * Authorization is checked against the DB.  Unauthorized attempts
 * hard-disconnect the socket to prevent room-probing.
 */

import type { Socket, DefaultEventsMap } from "socket.io";
import postgres from "postgres";

import { createLogger } from "./logger";

const log = createLogger("ws:rooms");

/**
 * Per-socket data populated by the auth middleware in `index.ts`.
 * Exported so the `Server` instance can be typed with the same shape — otherwise
 * `socket.data` is `any` and every access to it is unchecked.
 */
export interface WsSocketData {
  userId: string;
  sessionId: string;
}

export type AuthSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  WsSocketData
>;

// This process doesn't import `~/env` (it runs outside the Next build), so it
// validates for itself rather than silently falling back to a hardcoded
// localhost connection string — which would mean authorizing room joins against
// the wrong database.
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  log.error("FATAL: DATABASE_URL is not set; room joins cannot be authorized");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  max: 3,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  prepare: false,
});

// ── join:org ─────────────────────────────────────────────────────────

async function handleJoinOrg(socket: AuthSocket, orgId: unknown) {
  if (typeof orgId !== "string" && typeof orgId !== "number") return;
  const organizationId = String(orgId);
  const userId = socket.data.userId;

  try {
    const rows = await sql`
      SELECT 1 FROM organization_members
      WHERE "organization_id" = ${organizationId}
        AND "user_id" = ${userId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      log.warn("join:org denied", { userId, organizationId });
      socket.disconnect(true);
      return;
    }

    void socket.join(`org:${organizationId}`);
    log.debug("join:org ok", { userId, organizationId });
  } catch (err) {
    log.error("join:org failed", { err });
    socket.disconnect(true);
  }
}

// ── join:project ─────────────────────────────────────────────────────

async function handleJoinProject(socket: AuthSocket, projectId: unknown) {
  if (typeof projectId !== "string" && typeof projectId !== "number") return;
  const pid = String(projectId);
  const userId = socket.data.userId;

  try {
    // Check project exists and get its organizationId.
    // NOTE ON IDENTIFIERS: this schema mixes naming conventions — most columns
    // are snake_case, but `projects.createdById` and
    // `project_collaborators.collaboratorId` are declared in Drizzle without an
    // explicit column name, so their real column names are camelCase. Raw SQL
    // here must match exactly; a wrong identifier raises, and the catch blocks
    // below hard-disconnect the socket.
    const projectRows = await sql`
      SELECT "organization_id", "createdById" FROM projects
      WHERE id = ${pid}
      LIMIT 1
    `;

    if (projectRows.length === 0) {
      log.warn("join:project denied, project not found", { userId, projectId: pid });
      socket.disconnect(true);
      return;
    }

    const project = projectRows[0]!;

    // Project owner always has access
    if (project.createdById === userId) {
      void socket.join(`project:${pid}`);
      log.debug("join:project ok", { userId, projectId: pid, via: "owner" });
      return;
    }

    // Check if user is a project collaborator
    const collabRows = await sql`
      SELECT 1 FROM project_collaborators
      WHERE "project_id" = ${pid}
        AND "collaboratorId" = ${userId}
      LIMIT 1
    `;

    if (collabRows.length > 0) {
      void socket.join(`project:${pid}`);
      log.debug("join:project ok", { userId, projectId: pid, via: "collaborator" });
      return;
    }

    // If org-scoped project, check org membership
    if (project.organization_id) {
      const orgRows = await sql`
        SELECT 1 FROM organization_members
        WHERE "organization_id" = ${project.organization_id as string}
          AND "user_id" = ${userId}
        LIMIT 1
      `;

      if (orgRows.length > 0) {
        void socket.join(`project:${pid}`);
        log.debug("join:project ok", { userId, projectId: pid, via: "org-member" });
        return;
      }
    }

    log.warn("join:project denied", { userId, projectId: pid });
    socket.disconnect(true);
  } catch (err) {
    log.error("join:project failed", { err });
    socket.disconnect(true);
  }
}

// ── join:conversation ────────────────────────────────────────────────

async function handleJoinConversation(
  socket: AuthSocket,
  conversationId: unknown,
) {
  if (
    typeof conversationId !== "string" &&
    typeof conversationId !== "number"
  ) {
    return;
  }

  // Conversation ids are sequential identity columns, so an unauthorized join
  // is trivially enumerable — this must be checked against the DB like org and
  // project joins are, not assumed from the client's behaviour.
  const cid = Number(conversationId);
  if (!Number.isInteger(cid) || cid <= 0) return;

  const userId = socket.data.userId;

  try {
    const rows = await sql`
      SELECT 1 FROM direct_conversations
      WHERE id = ${cid}
        AND ("user_one_id" = ${userId} OR "user_two_id" = ${userId})
      LIMIT 1
    `;

    if (rows.length === 0) {
      log.warn("join:conversation denied", { userId, conversationId: cid });
      socket.disconnect(true);
      return;
    }

    void socket.join(`conversation:${cid}`);
    log.debug("join:conversation ok", { userId, conversationId: cid });
  } catch (err) {
    log.error("join:conversation failed", { err });
    socket.disconnect(true);
  }
}

// ── join:events (public feed) ────────────────────────────────────────

/**
 * The public events feed.
 *
 * No membership check, deliberately: events are public content — region-scoped,
 * with no organization — and `event.getFeed` is a `publicProcedure`. This
 * room exists for scope, not secrecy: it replaces an `io.emit` that woke every
 * connected socket in the system whenever any event changed.
 *
 * Anything carrying an authorization decision belongs in one of the handlers above,
 * which query the database before joining.
 */
function handleJoinEvents(socket: AuthSocket) {
  void socket.join(EVENTS_FEED_ROOM);
}

function handleLeaveEvents(socket: AuthSocket) {
  void socket.leave(EVENTS_FEED_ROOM);
}

// ── leave handlers ───────────────────────────────────────────────────

function handleLeaveOrg(socket: AuthSocket, orgId: unknown) {
  if (typeof orgId !== "string" && typeof orgId !== "number") return;
  void socket.leave(`org:${String(orgId)}`);
}

function handleLeaveProject(socket: AuthSocket, projectId: unknown) {
  if (typeof projectId !== "string" && typeof projectId !== "number") return;
  void socket.leave(`project:${String(projectId)}`);
}

// ── register all room handlers on a socket ───────────────────────────

/**
 * Must match the room the app publishes to — `publishEventsFeedEvent` in
 * `src/server/redis/publisher.ts` uses the "feed" scope with id "events", and the
 * subscriber maps channel `ws:feed:events` to room `feed:events`.
 */
const EVENTS_FEED_ROOM = "feed:events";

export function registerRoomHandlers(socket: AuthSocket) {
  socket.on("join:events", () => handleJoinEvents(socket));
  socket.on("leave:events", () => handleLeaveEvents(socket));
  socket.on("join:org", (orgId: unknown) => void handleJoinOrg(socket, orgId));
  socket.on("leave:org", (orgId: unknown) => handleLeaveOrg(socket, orgId));
  socket.on(
    "join:project",
    (projectId: unknown) => void handleJoinProject(socket, projectId),
  );
  socket.on("leave:project", (projectId: unknown) =>
    handleLeaveProject(socket, projectId),
  );

  // Conversation rooms — participant membership is verified against the DB,
  // exactly like org and project joins. Message bodies are broadcast to these
  // rooms, so an unchecked join leaks private direct messages.
  socket.on(
    "join:conversation",
    (conversationId: unknown) => void handleJoinConversation(socket, conversationId),
  );
  socket.on("leave:conversation", (conversationId: unknown) => {
    if (
      typeof conversationId !== "number" &&
      typeof conversationId !== "string"
    )
      return;
    void socket.leave(`conversation:${String(conversationId)}`);
  });

  // Typing indicator relay
  socket.on("message:typing", (data: unknown) => {
    if (
      typeof data !== "object" ||
      data === null ||
      typeof (data as Record<string, unknown>).conversationId === "undefined"
    )
      return;

    const { conversationId, isTyping } = data as {
      conversationId: number | string;
      isTyping: boolean;
    };

    // Only relay into rooms this socket has actually been authorized into by
    // `join:conversation`; otherwise any client could spoof presence in any
    // conversation it can name.
    const room = `conversation:${String(conversationId)}`;
    if (!socket.rooms.has(room)) return;

    socket
      .to(room)
      .emit("message:typing", {
        userId: socket.data.userId,
        isTyping: !!isTyping,
      });
  });
}
