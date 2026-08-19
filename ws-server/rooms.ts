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

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/kairos";

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
      console.warn(
        `[ws:rooms] join:org DENIED — user=${userId} org=${organizationId}`,
      );
      socket.disconnect(true);
      return;
    }

    void socket.join(`org:${organizationId}`);
    console.log(
      `[ws:rooms] join:org OK — user=${userId} org=${organizationId}`,
    );
  } catch (err) {
    console.error("[ws:rooms] join:org DB error", err);
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
      console.warn(
        `[ws:rooms] join:project DENIED (not found) — user=${userId} project=${pid}`,
      );
      socket.disconnect(true);
      return;
    }

    const project = projectRows[0]!;

    // Project owner always has access
    if (project.createdById === userId) {
      void socket.join(`project:${pid}`);
      console.log(
        `[ws:rooms] join:project OK (owner) — user=${userId} project=${pid}`,
      );
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
      console.log(
        `[ws:rooms] join:project OK (collaborator) — user=${userId} project=${pid}`,
      );
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
        console.log(
          `[ws:rooms] join:project OK (org member) — user=${userId} project=${pid}`,
        );
        return;
      }
    }

    console.warn(
      `[ws:rooms] join:project DENIED — user=${userId} project=${pid}`,
    );
    socket.disconnect(true);
  } catch (err) {
    console.error("[ws:rooms] join:project DB error", err);
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
      console.warn(
        `[ws:rooms] join:conversation DENIED — user=${userId} conversation=${cid}`,
      );
      socket.disconnect(true);
      return;
    }

    void socket.join(`conversation:${cid}`);
    console.log(
      `[ws:rooms] join:conversation OK — user=${userId} conversation=${cid}`,
    );
  } catch (err) {
    console.error("[ws:rooms] join:conversation DB error", err);
    socket.disconnect(true);
  }
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

export function registerRoomHandlers(socket: AuthSocket) {
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
