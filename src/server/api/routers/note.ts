import { z } from "zod";
import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import { protectedProcedure, createTRPCRouter } from "~/server/api/trpc";
import { stickyNotes, users, notebooks, noteShares, notifications } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";
import { emitNotification } from "~/server/socket/emit";
import * as argon2 from "argon2";
import { encryptContent, decryptContent } from "~/server/encryption";
import {
  consumeAuthRateLimit,
  createAuthRateLimitKey,
} from "~/server/authRateLimit";
import { getClientIp } from "~/server/clientIp";
import { createLogger } from "~/server/logger";

const log = createLogger("note");

/**
 * Throttle a note-password attempt before any Argon2 work happens.
 *
 * Two reasons, both from audit finding #8. The obvious one is that an unbounded
 * number of attempts turns the note password into a guessing oracle. The less
 * obvious one is cost: every verify runs Argon2id at `memoryCost: 65536`, so a few
 * hundred concurrent attempts is 64MB each — a memory-exhaustion denial of service
 * against the app server, reachable by any signed-in user.
 *
 * Keyed on the note *and* the caller, and separately on client IP, so one user
 * hammering one note cannot deny everyone else access to their own notes.
 */
async function throttleNotePasswordAttempt(
  ctx: { session: { user: { id: string } }; headers: Headers },
  noteId: number,
): Promise<void> {
  await consumeAuthRateLimit(
    createAuthRateLimitKey("note_password", `${ctx.session.user.id}:${noteId}`),
  );
  await consumeAuthRateLimit(
    createAuthRateLimitKey("note_password_ip", getClientIp(ctx.headers)),
  );
}

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

export const noteRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      content: z.string().min(1),
      title: z.string().optional(),
      password: z.string().optional(),
      notebookId: z.number().optional(),
      calendarDate: z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let passwordHash: string | null = null;
      let passwordSalt: string | null = null;

      if (input.password && input.password.length > 0) {
        try { 
          // Generate a random salt for AES-256-GCM encryption (Argon2 embeds its own salt)
          passwordSalt = crypto.randomBytes(32).toString("hex");
          passwordHash = await argon2.hash(input.password, ARGON2_OPTS);
          if (process.env.NODE_ENV !== "production") {
            log.debug("Password Hashed Successfully.");
          }
        } catch (hashError) {
          log.error("failed to hash note password", { err: hashError });
          throw new TRPCError({ 
            code: "INTERNAL_SERVER_ERROR", 
            message: "Failed to secure note password." 
          });
        }
      }
      
      try {
        // Encrypt content if password-protected (AES-256-GCM)
        const storedContent = (passwordSalt && input.password)
          ? encryptContent(input.content, input.password, passwordSalt)
          : input.content;

        const [newNote] = await ctx.db.insert(stickyNotes).values({
          content: storedContent,
          title: input.title ?? null,
          createdById: ctx.session.user.id,
          notebookId: input.notebookId ?? null,
          calendarDate: input.calendarDate ?? null,
          passwordHash: passwordHash,
          passwordSalt: passwordSalt,
          shareStatus: 'private',
        }).returning();

        if (!newNote) {
          log.error("❌ Insertion failed, returned no note.");
          throw new TRPCError({ 
            code: "INTERNAL_SERVER_ERROR", 
            message: "Note creation failed unexpectedly." 
          });
        }

        if (process.env.NODE_ENV !== "production") {
          log.debug("note created", { noteId: newNote.id });
        }
        return newNote;

      } catch (dbError) {
        log.error("note insert failed", { err: dbError });
        throw new TRPCError({ 
          code: "INTERNAL_SERVER_ERROR", 
          message: "Database insertion failed. Check your schema and database logs." 
        });
      }
    }),

  getAll: protectedProcedure
    .query(async ({ ctx }) => {
      const notes = await ctx.db.query.stickyNotes.findMany({
        where: eq(stickyNotes.createdById, ctx.session.user.id),
        orderBy: (notes, { desc }) => [desc(notes.createdAt)],
        with: {
          shares: {
            with: {
              sharedWith: {
                columns: { id: true, name: true, email: true, image: true },
              },
            },
          },
        },
      });

      // IMPORTANT: never ship plaintext content for password-protected notes.
      // The client must unlock via password before fetching content.
      return notes.map((n) => {
        const sharedWith = n.shares?.map((s) => ({
          id: s.sharedWith.id,
          name: s.sharedWith.name,
          email: s.sharedWith.email,
          image: s.sharedWith.image,
          permission: s.permission,
        })) ?? [];

        if (n.passwordHash) {
          return {
            id: n.id,
            title: n.title,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
            notebookId: n.notebookId,
            // Only the boolean, never the hash: the client needs to know a note
            // is locked, and shipping the Argon2 hash to the browser hands out
            // material for offline cracking.
            isPasswordProtected: true,
            shareStatus: n.shareStatus,
            sharedWith,
            // content intentionally omitted
            content: null,
          };
        }

        // Drop the credential columns even on unprotected notes, so this
        // endpoint can never return them regardless of the branch taken.
        const { passwordHash, passwordSalt, ...rest } = n;
        void passwordHash;
        void passwordSalt;
        return { ...rest, isPasswordProtected: false, sharedWith };
      });
    }),

  getSharedWithMe: protectedProcedure
    .query(async ({ ctx }) => {
      const shares = await ctx.db
        .select({
          id: stickyNotes.id,
          title: stickyNotes.title,
          content: stickyNotes.content,
          createdAt: stickyNotes.createdAt,
          updatedAt: stickyNotes.updatedAt,
          shareStatus: stickyNotes.shareStatus,
          passwordHash: stickyNotes.passwordHash,
          notebookId: stickyNotes.notebookId,
          permission: noteShares.permission,
          sharedById: noteShares.sharedById,
          ownerName: users.name,
          ownerEmail: users.email,
        })
        .from(noteShares)
        .innerJoin(stickyNotes, eq(noteShares.noteId, stickyNotes.id))
        .innerJoin(users, eq(stickyNotes.createdById, users.id))
        .where(eq(noteShares.sharedWithId, ctx.session.user.id));

      // Strip the hash before it leaves the server — this endpoint previously
      // shipped the owner's note-password hash to every user it was shared with.
      return shares.map(({ passwordHash, ...s }) => ({
        ...s,
        isPasswordProtected: !!passwordHash,
        content: passwordHash ? null : s.content,
      }));
    }),

  shareNote: protectedProcedure
    .input(z.object({
      noteId: z.number(),
      email: z.string().email(),
      permission: z.enum(["read", "write"]).default("read"),
    }))
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.db.query.stickyNotes.findFirst({
        where: eq(stickyNotes.id, input.noteId),
      });

      if (!note || note.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this note." });
      }

      const [targetUser] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found with that email." });
      }

      if (targetUser.id === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot share with yourself." });
      }

      // Check if already shared
      const [existing] = await ctx.db
        .select()
        .from(noteShares)
        .where(and(
          eq(noteShares.noteId, input.noteId),
          eq(noteShares.sharedWithId, targetUser.id),
        ))
        .limit(1);

      if (existing) {
        // Update permission
        await ctx.db
          .update(noteShares)
          .set({ permission: input.permission })
          .where(eq(noteShares.id, existing.id));
        return { success: true, updated: true };
      }

      await ctx.db.insert(noteShares).values({
        noteId: input.noteId,
        sharedWithId: targetUser.id,
        sharedById: ctx.session.user.id,
        permission: input.permission,
      });

      // Create notification for the target user
      const sharerName = ctx.session.user.name ?? ctx.session.user.email ?? "Someone";
      const noteTitle = note.title ?? "Untitled note";
      await ctx.db.insert(notifications).values({
        userId: targetUser.id,
        type: "system",
        title: "Note shared with you",
        message: `${sharerName} shared "${noteTitle}" with you (${input.permission === "write" ? "can edit" : "view only"}).`,
        link: `/notes?noteId=${input.noteId}&tab=shared`,
        read: false,
      });
      emitNotification(targetUser.id, {
        id: `note-share-${input.noteId}-${Date.now()}`,
        type: "system",
        title: "Note shared with you",
        message: `${sharerName} shared "${noteTitle}" with you (${input.permission === "write" ? "can edit" : "view only"}).`,
        link: `/notes?noteId=${input.noteId}&tab=shared`,
      });

      // Update note share status
      await ctx.db
        .update(stickyNotes)
        .set({ shareStatus: input.permission === "write" ? "shared_write" : "shared_read" })
        .where(eq(stickyNotes.id, input.noteId));

      return { success: true, updated: false };
    }),

  unshareNote: protectedProcedure
    .input(z.object({
      noteId: z.number(),
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.db.query.stickyNotes.findFirst({
        where: eq(stickyNotes.id, input.noteId),
      });

      if (!note || note.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this note." });
      }

      await ctx.db
        .delete(noteShares)
        .where(and(
          eq(noteShares.noteId, input.noteId),
          eq(noteShares.sharedWithId, input.userId),
        ));

      // Check if any shares remain
      const remaining = await ctx.db
        .select()
        .from(noteShares)
        .where(eq(noteShares.noteId, input.noteId))
        .limit(1);

      if (remaining.length === 0) {
        await ctx.db
          .update(stickyNotes)
          .set({ shareStatus: "private" })
          .where(eq(stickyNotes.id, input.noteId));
      }

      return { success: true };
    }),

  getNoteShares: protectedProcedure
    .input(z.object({ noteId: z.number() }))
    .query(async ({ ctx, input }) => {
      const note = await ctx.db.query.stickyNotes.findFirst({
        where: eq(stickyNotes.id, input.noteId),
      });

      if (!note || note.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this note." });
      }

      return ctx.db
        .select({
          id: noteShares.id,
          userId: noteShares.sharedWithId,
          permission: noteShares.permission,
          userName: users.name,
          userEmail: users.email,
          userImage: users.image,
          createdAt: noteShares.createdAt,
        })
        .from(noteShares)
        .innerJoin(users, eq(noteShares.sharedWithId, users.id))
        .where(eq(noteShares.noteId, input.noteId));
    }),

  // ---- Notebooks ----
  getNotebooks: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.db.query.notebooks.findMany({
        where: eq(notebooks.createdById, ctx.session.user.id),
        orderBy: (nb, { desc }) => [desc(nb.updatedAt)],
      });
    }),

  createNotebook: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(256),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [nb] = await ctx.db.insert(notebooks).values({
        name: input.name,
        description: input.description ?? null,
        createdById: ctx.session.user.id,
      }).returning();
      return nb;
    }),

  updateNotebook: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(256).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const nb = await ctx.db.query.notebooks.findFirst({
        where: eq(notebooks.id, input.id),
      });
      if (!nb || nb.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your notebook." });
      }
      await ctx.db.update(notebooks).set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        updatedAt: new Date(),
      }).where(eq(notebooks.id, input.id));
      return { success: true };
    }),

  deleteNotebook: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const nb = await ctx.db.query.notebooks.findFirst({
        where: eq(notebooks.id, input.id),
      });
      if (!nb || nb.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your notebook." });
      }
      // Unlink notes from notebook (don't delete them)
      await ctx.db.update(stickyNotes)
        .set({ notebookId: null })
        .where(eq(stickyNotes.notebookId, input.id));
      await ctx.db.delete(notebooks).where(eq(notebooks.id, input.id));
      return { success: true };
    }),

  moveToNotebook: protectedProcedure
    .input(z.object({
      noteId: z.number(),
      notebookId: z.number().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.db.query.stickyNotes.findFirst({
        where: eq(stickyNotes.id, input.noteId),
      });
      if (!note || note.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your note." });
      }
      await ctx.db.update(stickyNotes)
        .set({ notebookId: input.notebookId, updatedAt: new Date() })
        .where(eq(stickyNotes.id, input.noteId));
      return { success: true };
    }),
    
  getOne: protectedProcedure 
    .input(z.object({
      id: z.number(),
      attemptedPassword: z.string().optional(), 
    }))
    .query(async ({ ctx, input }) => {
      const note = await ctx.db.query.stickyNotes.findFirst({
        where: eq(stickyNotes.id, input.id),
      });

      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
      }

      if (note.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this note." });
      }

      if (note.passwordHash) {
        if (!input.attemptedPassword) {
          return {
            id: note.id,
            content: null, 
            isPasswordProtected: true, 
          };
        }

        await throttleNotePasswordAttempt(ctx, input.id);

        const isMatch = await argon2.verify(
          note.passwordHash,
          input.attemptedPassword
        );

        if (!isMatch) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect password." });
        }
      }

      // Decrypt content if it was encrypted (password-protected note after successful auth)
      let content = note.content;
      if (note.passwordHash && note.passwordSalt && input.attemptedPassword) {
        try {
          content = decryptContent(note.content, input.attemptedPassword, note.passwordSalt);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to decrypt note content. The note may need to be re-saved.",
          });
        }
      }

      return {
        id: note.id,
        content,
        isPasswordProtected: false, 
      };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      content: z.string().min(1),
      title: z.string().optional(),
      password: z.string().optional(),
      calendarDate: z.date().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.db.query.stickyNotes.findFirst({
        where: eq(stickyNotes.id, input.id),
      });

      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
      }

      if (note.createdById !== ctx.session.user.id) {
        // Check if user has write permission via share
        const [share] = await ctx.db
          .select()
          .from(noteShares)
          .where(and(
            eq(noteShares.noteId, input.id),
            eq(noteShares.sharedWithId, ctx.session.user.id),
            eq(noteShares.permission, "write"),
          ))
          .limit(1);
        if (!share) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You don't have write access to this note." });
        }
      }

      let storedContent = input.content;

      if (note.passwordHash) {
        // A password-protected note must never be written as plaintext.
        //
        // Previously, omitting `password` fell through and stored the new content
        // unencrypted into a row that still had passwordHash/passwordSalt set.
        // That both silently removed the encryption and bricked the note: every
        // read path then ran decryptContent() over plaintext and threw, so the
        // note became permanently unreadable through the UI. Anyone holding a
        // write share could trigger it too, without ever knowing the password.
        if (!input.password) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This note is password protected. Unlock it with its password before saving changes.",
          });
        }

        if (!note.passwordSalt) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Note is password protected but has no salt; it needs to be re-saved.",
          });
        }

        const isMatch = await argon2.verify(note.passwordHash, input.password);
        if (!isMatch) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect note password." });
        }

        storedContent = encryptContent(input.content, input.password, note.passwordSalt);
      }

      await ctx.db.update(stickyNotes)
        .set({
          content: storedContent,
          updatedAt: new Date(),
          ...(input.title !== undefined ? { title: input.title || null } : {}),
          ...(input.calendarDate !== undefined ? { calendarDate: input.calendarDate ?? null } : {}),
        })
        .where(eq(stickyNotes.id, input.id));

      return { success: true, message: "Note updated successfully" };
    }),

  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.db.query.stickyNotes.findFirst({
        where: eq(stickyNotes.id, input.id),
      });

      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
      }

      if (note.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this note." });
      }

      await ctx.db.delete(stickyNotes).where(eq(stickyNotes.id, input.id));

      return { success: true };
    }),

  verifyPassword: protectedProcedure
    .input(z.object({
      noteId: z.number(),
      password: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.db.query.stickyNotes.findFirst({
        where: eq(stickyNotes.id, input.noteId),
      });

      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
      }

      if (note.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this note." });
      }

      if (!note.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Note is not password protected."
        });
      }

      await throttleNotePasswordAttempt(ctx, input.noteId);

      const isMatch = await argon2.verify(note.passwordHash, input.password);

      if (!isMatch) {
        return { valid: false };
      }

      // Decrypt content if encrypted
      let content = note.content;
      if (note.passwordSalt) {
        try {
          content = decryptContent(note.content, input.password, note.passwordSalt);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to decrypt note content. The note may need to be re-saved.",
          });
        }
      }

      return {
        valid: true,
        content
      };
    }),

  /**
   * Reset a note password using the user's secret reset PIN.
   */
  resetPasswordWithPin: protectedProcedure
    .input(
      z.object({
        noteId: z.number(),
        newPassword: z.string().min(1),
        resetPin: z.string().regex(/^\d{4,}$/ , "PIN must be at least 4 digits"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
      });

      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found" });
      }

      if (!user.resetPinHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No reset PIN configured",
        });
      }

      if (user.resetPinLockedUntil && now < user.resetPinLockedUntil) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Reset PIN temporarily locked due to too many failed attempts",
        });
      }

      const pinValid = await argon2.verify(user.resetPinHash, input.resetPin);

      const MAX_ATTEMPTS = 5;
      const LOCKOUT_MINUTES = 15;

      if (!pinValid) {
        const failedAttempts = (user.resetPinFailedAttempts ?? 0) + 1;
        const updates: Partial<typeof users.$inferInsert> = {
          resetPinFailedAttempts: failedAttempts,
          resetPinLastFailedAt: now,
        };

        if (failedAttempts >= MAX_ATTEMPTS) {
          updates.resetPinLockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
        }

        await ctx.db.update(users)
          .set(updates)
          .where(eq(users.id, ctx.session.user.id));

        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Incorrect reset PIN",
        });
      }

      // PIN is valid – reset lockout state
      await ctx.db.update(users)
        .set({
          resetPinFailedAttempts: 0,
          resetPinLockedUntil: null,
          resetPinLastFailedAt: null,
        })
        .where(eq(users.id, ctx.session.user.id));

      const note = await ctx.db.query.stickyNotes.findFirst({
        where: eq(stickyNotes.id, input.noteId),
      });

      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
      }

      if (note.createdById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this note." });
      }

      const salt = crypto.randomBytes(32).toString("hex");
      const newPasswordHash = await argon2.hash(input.newPassword, ARGON2_OPTS);

      // When resetting via PIN we don't have the old password, so we cannot
      // decrypt the existing content. Store it as plain encrypted blob and
      // re-encrypt with the new password+salt. The user will need to re-save
      // content after resetting. We strip encryption so the note content
      // becomes the raw (possibly garbled) ciphertext — the user should
      // re-enter or paste content after a PIN reset.
      // Best-effort: mark content as needing re-entry.
      const resetPlaceholder = "[Content reset — please re-enter your note content]";

      await ctx.db
        .update(stickyNotes)
        .set({
          passwordHash: newPasswordHash,
          passwordSalt: salt,
          content: encryptContent(resetPlaceholder, input.newPassword, salt),
        })
        .where(eq(stickyNotes.id, input.noteId));

      return { success: true, message: "Password reset successfully" };
    }),
});