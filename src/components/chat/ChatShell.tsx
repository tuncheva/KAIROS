"use client";

/**
 * The chat surface: rail, thread, details.
 *
 * This replaces the single 1000-line `ChatClient`. The pieces that were already
 * right are kept and moved rather than rewritten — the optimistic-send cache
 * surgery in `messageCache`, the backwards pagination, the conversation-room
 * re-join on reconnect, the typing indicator. What is new is everything that
 * exposes state the system already knew: read pointers, presence, delivery
 * status, mute, drafts.
 *
 * Selection is a route (`/chat/[conversationId]`), not component state. That is
 * what makes the browser back button work on mobile, lets a notification deep
 * link land on the right thread, and keeps the URL shareable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Info, Loader2, MessageSquare, Search } from "~/components/ui/icons";

import { api, type RouterOutputs } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { useSocket } from "~/components/providers/SocketProvider";
import { useSocketEvent } from "~/hooks/useSocketEvent";
import { useUploadThing } from "~/lib/uploadthing";

import {
  appendMessage,
  dropMessage,
  hasMessage,
  nextOptimisticId,
  patchMessage,
  peerReadId,
  replaceMessage,
  seedPage,
  setPeerRead,
  type ChatMessage,
} from "./messageCache";
import { useTypingIndicator } from "./useTypingIndicator";
import { usePresence } from "./usePresence";
import { useDrafts } from "./useDrafts";
import { Avatar, displayName, type ChatUser } from "./chatUi";
import { ConversationRail, type RailFilter } from "./ConversationRail";
import { ConversationDetails } from "./ConversationDetails";
import { MessageThread } from "./MessageThread";
import { MessageBubble, type SendStatus, type ThreadMessage } from "./MessageBubble";
import { Composer, type PendingAttachment } from "./Composer";
import { NewChatModal } from "./NewChatModal";
import { ConfirmDialog } from "./ConfirmDialog";

const PAGE_SIZE = 50;
/** Debounce before a typed query is sent to the server. */
const SEARCH_DEBOUNCE_MS = 300;
/** How long a jumped-to message stays highlighted. */
const HIGHLIGHT_MS = 2000;

type SearchHit = RouterOutputs["chat"]["searchMessages"][number];

/** What a failed send needs in order to be retried unchanged. */
interface FailedSend {
  body: string;
  replyToId: number | undefined;
  attachments: ThreadMessage["attachments"];
}

export function ChatShell({
  userId,
  conversationId,
}: {
  userId: string;
  conversationId: number | null;
}) {
  const t = useTranslations("chat.direct");
  const locale = useLocale();
  const timeLocale = locale === "bg" ? "bg-BG" : "en-US";
  const router = useRouter();
  const toast = useToast();
  const utils = api.useUtils();
  const socket = useSocket();
  const { isOnline } = usePresence();
  const { getDraft, setDraft, clearDraft, hasDraft } = useDrafts();
  const { startUpload } = useUploadThing("chatAttachment");

  const [railQuery, setRailQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<RailFilter>("all");
  const [showNewChat, setShowNewChat] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ThreadMessage | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [failedSends, setFailedSends] = useState<Map<number, FailedSend>>(new Map());
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [typingConversations, setTypingConversations] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<null | "clear" | "leave">(null);

  /* Frozen at open so the unread divider does not travel while it is being
     read. Reset whenever the conversation changes. */
  const [unreadAfterId, setUnreadAfterId] = useState<number | null>(null);
  const unreadFrozenFor = useRef<number | null>(null);

  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── data ────────────────────────────────────────────────────────────
  const conversationsQuery = api.chat.listAllConversations.useQuery();
  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === conversationId) ?? null,
    [conversations, conversationId],
  );

  const otherUser: ChatUser | null = useMemo(() => {
    if (!activeConversation) return null;
    return activeConversation.userOne.id === userId
      ? activeConversation.userTwo
      : activeConversation.userOne;
  }, [activeConversation, userId]);

  const messagesQuery = api.chat.listMessages.useInfiniteQuery(
    { conversationId: conversationId ?? -1, limit: PAGE_SIZE },
    {
      enabled: conversationId !== null,
      /* Messages arrive over the socket, so there is no poll. This is the net
         for the one case the socket cannot cover: a frame dropped while the
         connection was nominally up. */
      refetchOnWindowFocus: true,
      getPreviousPageParam: (firstPage) => firstPage.prevCursor,
      /* Never used — history only goes backwards — but react-query requires the
         option to exist before `pages` can grow in either direction. */
      getNextPageParam: () => undefined,
    },
  );

  const messages = useMemo(
    () => messagesQuery.data?.pages.flatMap((p) => p.messages) ?? [],
    [messagesQuery.data],
  );

  const peerLastReadId = useMemo(
    () => peerReadId(messagesQuery.data),
    [messagesQuery.data],
  );

  const detailsQuery = api.chat.getConversationDetails.useQuery(
    { conversationId: conversationId ?? -1 },
    { enabled: conversationId !== null && showDetails },
  );

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(railQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [railQuery]);

  const searchQuery = api.chat.searchMessages.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 },
  );

  const participants = useMemo(() => {
    const map = new Map<string, ChatUser>();
    for (const convo of conversations) {
      map.set(convo.userOne.id, convo.userOne);
      map.set(convo.userTwo.id, convo.userTwo);
    }
    return map;
  }, [conversations]);

  // ── read pointer ────────────────────────────────────────────────────
  const markRead = api.chat.markRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.chat.listAllConversations.invalidate(),
        utils.chat.getUnreadTotal.invalidate(),
      ]);
    },
  });

  /* Freeze the divider the first time this conversation's messages land. */
  useEffect(() => {
    if (conversationId === null) {
      unreadFrozenFor.current = null;
      setUnreadAfterId(null);
      return;
    }
    if (unreadFrozenFor.current === conversationId) return;
    if (messagesQuery.isLoading || !activeConversation) return;

    unreadFrozenFor.current = conversationId;

    if (activeConversation.unreadCount === 0) {
      setUnreadAfterId(null);
      return;
    }

    /* Walk back from the newest message counting the ones that are unread — the
       other person's, not deleted — until the server's count is accounted for.
       Whatever sits immediately before that is the last thing the user had
       read, and the divider goes after it.

       Counting backwards rather than slicing `length - unreadCount` off the
       tail matters because the tail is interleaved: the user's own replies sit
       between the other person's messages and are never unread. */
    let remaining = activeConversation.unreadCount;
    let anchorIndex: number | null = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]!;
      if (message.senderId !== userId && message.deletedAt === null) {
        remaining -= 1;
        if (remaining === 0) {
          anchorIndex = i - 1;
          break;
        }
      }
    }

    /* A null anchor means every loaded message is unread, so there is no read
       side to divide from and the divider is suppressed. */
    setUnreadAfterId(
      anchorIndex !== null && anchorIndex >= 0 ? messages[anchorIndex]!.id : null,
    );
  }, [conversationId, messagesQuery.isLoading, activeConversation, messages, userId]);

  /**
   * The newest id already sent to `markRead`, so scrolling at the bottom of a
   * thread does not fire a mutation per scroll frame.
   *
   * A ref rather than `markRead.isPending`: pending only covers a request that
   * is still open, so a burst of scroll events between requests would still send
   * duplicates — and gating on it can drop the *last* mark, leaving the thread
   * permanently one message unread.
   */
  const lastMarkedRef = useRef<{ conversationId: number; messageId: number } | null>(null);

  const handleVisibleNewest = useCallback(
    (messageId: number) => {
      if (conversationId === null || messageId <= 0) return;

      const marked = lastMarkedRef.current;
      if (marked?.conversationId === conversationId && marked.messageId >= messageId) return;

      lastMarkedRef.current = { conversationId, messageId };
      markRead.mutate({ conversationId, messageId });
    },
    [conversationId, markRead],
  );

  // ── sending ─────────────────────────────────────────────────────────
  const sendMessage = api.chat.sendMessage.useMutation({
    onMutate: async (variables) => {
      const cid = variables.conversationId;
      await utils.chat.listMessages.cancel({ conversationId: cid, limit: PAGE_SIZE });

      /* This send's own placeholder id, carried to `onSuccess` so it can swap
         out exactly this one. Clearing every negative id there instead meant a
         second message sent before the first resolved had its placeholder
         deleted, and it vanished from the thread until the next refetch. */
      const optimisticId = nextOptimisticId();

      const optimistic: ChatMessage = {
        id: optimisticId,
        body: variables.body,
        createdAt: new Date(),
        senderId: userId,
        senderName: null,
        senderImage: null,
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        attachments: (variables.attachments ?? []).map((a, i) => ({
          id: -(i + 1),
          url: a.url,
          name: a.name,
          mime: a.mime,
          sizeBytes: a.sizeBytes,
          width: a.width ?? null,
          height: a.height ?? null,
        })),
        reactions: [],
        replyTo: replyingTo
          ? {
              id: replyingTo.id,
              body: replyingTo.body,
              senderName: replyingTo.senderName,
              deleted: replyingTo.deletedAt !== null,
            }
          : null,
      };

      utils.chat.listMessages.setInfiniteData(
        { conversationId: cid, limit: PAGE_SIZE },
        (old) => (old ? appendMessage(old, optimistic) : seedPage(optimistic)),
      );

      return { optimisticId, cid };
    },
    onError: (_err, variables, context) => {
      if (!context) return;
      /* Keep the bubble on screen in a failed state rather than dropping it
         behind a toast — the text is right there to retry, and nothing the user
         typed is lost. */
      setFailedSends((prev) => {
        const next = new Map(prev);
        next.set(context.optimisticId, {
          body: variables.body,
          replyToId: variables.replyToId,
          attachments: (variables.attachments ?? []).map((a, i) => ({
            id: -(i + 1),
            url: a.url,
            name: a.name,
            mime: a.mime,
            sizeBytes: a.sizeBytes,
            width: a.width ?? null,
            height: a.height ?? null,
          })),
        });
        return next;
      });
    },
    onSuccess: async (msg, _variables, context) => {
      if (!context) return;
      const { cid, optimisticId } = context;

      const stored: ChatMessage = {
        id: msg.id,
        body: msg.body,
        createdAt: msg.createdAt,
        senderId: msg.senderId,
        senderName: msg.senderName,
        senderImage: msg.senderImage,
        editedAt: msg.editedAt,
        deletedAt: msg.deletedAt,
        pinnedAt: msg.pinnedAt,
        attachments: msg.attachments,
        reactions: msg.reactions,
        replyTo: msg.replyTo,
      };

      utils.chat.listMessages.setInfiniteData(
        { conversationId: cid, limit: PAGE_SIZE },
        (old) => {
          if (!old) return old;
          /* The socket may have echoed this message back already. */
          if (hasMessage(old, stored.id)) return dropMessage(old, optimisticId);
          return replaceMessage(old, optimisticId, stored);
        },
      );

      await utils.chat.listAllConversations.invalidate();
    },
  });

  const doSend = useCallback(
    async (override?: { body: string; replyToId?: number; attachments?: ThreadMessage["attachments"] }) => {
      if (conversationId === null) return;

      const body = (override?.body ?? getDraft(conversationId)).trim();
      const pending = override ? [] : attachments;

      if (body.length === 0 && pending.length === 0 && !override?.attachments?.length) return;

      let uploaded = override?.attachments ?? [];

      if (pending.length > 0) {
        setIsUploading(true);
        try {
          const result = await startUpload(pending.map((p) => p.file));
          if (!result) throw new Error("upload returned nothing");
          uploaded = result.map((file, i) => ({
            id: -(i + 1),
            url: file.url,
            name: file.name,
            mime: pending[i]?.file.type ?? "application/octet-stream",
            sizeBytes: pending[i]?.file.size ?? 0,
            width: null,
            height: null,
          }));
        } catch (err) {
          console.error("[ChatShell] upload failed:", err);
          toast.error(t("failedToUploadAttachments"));
          setIsUploading(false);
          /* Keep the draft and the picked files so nothing has to be redone. */
          return;
        }
        setIsUploading(false);
      }

      const replyToId = override ? override.replyToId : replyingTo?.id;

      sendMessage.mutate({
        conversationId,
        body,
        replyToId,
        attachments: uploaded.map((a) => ({
          url: a.url,
          name: a.name,
          mime: a.mime,
          sizeBytes: a.sizeBytes,
          ...(a.width !== null ? { width: a.width } : {}),
          ...(a.height !== null ? { height: a.height } : {}),
        })),
      });

      if (!override) {
        stopTyping();
        clearDraft(conversationId);
        setReplyingTo(null);
        for (const item of attachments) {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        }
        setAttachments([]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId, attachments, replyingTo, getDraft, clearDraft, startUpload, sendMessage, t, toast],
  );

  const retrySend = useCallback(
    (optimisticId: number) => {
      const payload = failedSends.get(optimisticId);
      if (!payload || conversationId === null) return;

      /* Drop the failed placeholder first: the retry creates a fresh one, and
         leaving both would show the message twice. */
      utils.chat.listMessages.setInfiniteData(
        { conversationId, limit: PAGE_SIZE },
        (old) => (old ? dropMessage(old, optimisticId) : old),
      );
      setFailedSends((prev) => {
        const next = new Map(prev);
        next.delete(optimisticId);
        return next;
      });

      void doSend({
        body: payload.body,
        replyToId: payload.replyToId,
        attachments: payload.attachments,
      });
    },
    [failedSends, conversationId, utils.chat.listMessages, doSend],
  );

  const discardSend = useCallback(
    (optimisticId: number) => {
      if (conversationId === null) return;
      utils.chat.listMessages.setInfiniteData(
        { conversationId, limit: PAGE_SIZE },
        (old) => (old ? dropMessage(old, optimisticId) : old),
      );
      setFailedSends((prev) => {
        const next = new Map(prev);
        next.delete(optimisticId);
        return next;
      });
    },
    [conversationId, utils.chat.listMessages],
  );

  // ── message mutations ───────────────────────────────────────────────
  const toggleReaction = api.chat.toggleReaction.useMutation({
    onSuccess: (data) => {
      if (conversationId === null) return;
      utils.chat.listMessages.setInfiniteData(
        { conversationId, limit: PAGE_SIZE },
        (old) => (old ? patchMessage(old, data.messageId, { reactions: data.reactions }) : old),
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const editMessage = api.chat.editMessage.useMutation({
    onSuccess: (data) => {
      if (conversationId === null) return;
      utils.chat.listMessages.setInfiniteData(
        { conversationId, limit: PAGE_SIZE },
        (old) => (old ? patchMessage(old, data.id, { body: data.body, editedAt: data.editedAt }) : old),
      );
      void utils.chat.listAllConversations.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMessage = api.chat.deleteMessage.useMutation({
    onSuccess: (data) => {
      if (conversationId === null) return;
      utils.chat.listMessages.setInfiniteData(
        { conversationId, limit: PAGE_SIZE },
        (old) =>
          old
            ? patchMessage(old, data.id, {
                body: "",
                deletedAt: data.deletedAt,
                attachments: [],
                reactions: [],
                pinnedAt: null,
              })
            : old,
      );
      void utils.chat.listAllConversations.invalidate();
      void utils.chat.getConversationDetails.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const togglePin = api.chat.togglePin.useMutation({
    onSuccess: (data) => {
      if (conversationId === null) return;
      utils.chat.listMessages.setInfiniteData(
        { conversationId, limit: PAGE_SIZE },
        (old) => (old ? patchMessage(old, data.id, { pinnedAt: data.pinnedAt }) : old),
      );
      void utils.chat.getConversationDetails.invalidate();
      toast.success(data.pinnedAt ? t("messagePinned") : t("messageUnpinned"));
    },
    onError: (error) => toast.error(error.message),
  });

  // ── conversation mutations ──────────────────────────────────────────
  const setPrefs = api.chat.setConversationPrefs.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.chat.listAllConversations.invalidate(),
        utils.chat.getUnreadTotal.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const clearHistory = api.chat.clearHistory.useMutation({
    onSuccess: async () => {
      setConfirm(null);
      await Promise.all([
        utils.chat.listMessages.invalidate(),
        utils.chat.listAllConversations.invalidate(),
        utils.chat.getConversationDetails.invalidate(),
      ]);
      toast.success(t("historyCleared"));
    },
    onError: (error) => toast.error(error.message),
  });

  const leaveConversation = api.chat.leaveConversation.useMutation({
    onSuccess: async () => {
      setConfirm(null);
      setShowDetails(false);
      await Promise.all([
        utils.chat.listAllConversations.invalidate(),
        utils.chat.getUnreadTotal.invalidate(),
      ]);
      toast.success(t("conversationLeft"));
      router.push("/chat");
    },
    onError: (error) => toast.error(error.message),
  });

  const createConversation = api.chat.getOrCreateDirectConversation.useMutation({
    onSuccess: async (data) => {
      await utils.chat.listAllConversations.invalidate();
      setShowNewChat(false);
      router.push(`/chat/${data.conversationId}`);
    },
    onError: (error) => toast.error(error.message),
  });

  // ── sockets ─────────────────────────────────────────────────────────
  /* Join / leave conversation rooms as the selection changes — and re-join on
     every `connect`.

     Room membership lives on the server against a socket id, so it does not
     survive a dropped connection, and socket.io reconnects the *same* client
     object rather than handing out a new one. Without the `connect` listener
     this effect never re-ran after a network blip and the conversation room was
     silently lost: typing indicators stopped, and delivery quietly fell back to
     the user-room copy of each message. */
  useEffect(() => {
    if (!socket || conversationId === null) return;

    const join = () => socket.emit("join:conversation", conversationId);
    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      socket.off("connect", join);
      if (socket.connected) socket.emit("leave:conversation", conversationId);
    };
  }, [socket, conversationId]);

  const { peerTyping, notifyTyping, stopTyping } = useTypingIndicator(socket, conversationId);

  /* Mirror the open thread's typing state into the rail, so a row can show
     "Typing…" the same way the header does. */
  useEffect(() => {
    if (conversationId === null) return;
    setTypingConversations((prev) => {
      const has = prev.has(conversationId);
      if (has === peerTyping) return prev;
      const next = new Set(prev);
      if (peerTyping) next.add(conversationId);
      else next.delete(conversationId);
      return next;
    });
  }, [peerTyping, conversationId]);

  const handleNewMessage = useCallback(
    (data: {
      messageId: number;
      conversationId: number;
      senderId: string;
      body: string;
      senderName: string | null;
      senderImage: string | null;
      createdAt: string | Date;
      attachments?: ThreadMessage["attachments"];
      replyTo?: ThreadMessage["replyTo"];
    }) => {
      /* A message for another thread still moves that row up the rail. */
      if (data.conversationId !== conversationId) {
        void utils.chat.listAllConversations.invalidate();
        void utils.chat.getUnreadTotal.invalidate();
        return;
      }
      // Don't duplicate our own messages (already handled via optimistic update).
      if (data.senderId === userId) return;

      const incoming: ChatMessage = {
        id: data.messageId,
        body: data.body,
        createdAt: new Date(data.createdAt),
        senderId: data.senderId,
        senderName: data.senderName,
        senderImage: data.senderImage,
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        attachments: data.attachments ?? [],
        reactions: [],
        replyTo: data.replyTo ?? null,
      };

      utils.chat.listMessages.setInfiniteData(
        { conversationId: data.conversationId, limit: PAGE_SIZE },
        (old) => {
          if (!old) return old;
          /* The server fans the message out to the conversation room *and* to
             each participant's user room, so an open conversation receives it
             twice. */
          if (hasMessage(old, data.messageId)) return old;
          return appendMessage(old, incoming);
        },
      );
      void utils.chat.listAllConversations.invalidate();
    },
    [conversationId, userId, utils.chat.listMessages, utils.chat.listAllConversations, utils.chat.getUnreadTotal],
  );
  useSocketEvent("message:new", handleNewMessage);

  const handleConversationUpdated = useCallback(() => {
    void utils.chat.listAllConversations.invalidate();
    void utils.chat.getUnreadTotal.invalidate();
  }, [utils.chat.listAllConversations, utils.chat.getUnreadTotal]);
  useSocketEvent("conversation:updated", handleConversationUpdated);

  const handleMessageRead = useCallback(
    (data: { conversationId: number; userId: string; messageId: number }) => {
      if (data.conversationId !== conversationId) return;
      if (data.userId === userId) return;
      utils.chat.listMessages.setInfiniteData(
        { conversationId: data.conversationId, limit: PAGE_SIZE },
        (old) => (old ? setPeerRead(old, data.messageId) : old),
      );
    },
    [conversationId, userId, utils.chat.listMessages],
  );
  useSocketEvent("message:read", handleMessageRead);

  const handleMessageUpdated = useCallback(
    (data: {
      conversationId: number;
      messageId: number;
      body?: string;
      editedAt?: string | Date | null;
      deletedAt?: string | Date | null;
      pinnedAt?: string | Date | null;
    }) => {
      if (data.conversationId !== conversationId) return;

      /* `undefined` means "unchanged" and `null` is a real value, so the patch
         is built key by key rather than spread wholesale — otherwise a pin
         would blank the body and an edit would clear the pin. */
      const patch: Partial<ChatMessage> = {};
      if (data.body !== undefined) patch.body = data.body;
      if (data.editedAt !== undefined) patch.editedAt = data.editedAt ? new Date(data.editedAt) : null;
      if (data.deletedAt !== undefined) {
        patch.deletedAt = data.deletedAt ? new Date(data.deletedAt) : null;
        if (data.deletedAt) {
          patch.attachments = [];
          patch.reactions = [];
        }
      }
      if (data.pinnedAt !== undefined) patch.pinnedAt = data.pinnedAt ? new Date(data.pinnedAt) : null;

      utils.chat.listMessages.setInfiniteData(
        { conversationId: data.conversationId, limit: PAGE_SIZE },
        (old) => (old ? patchMessage(old, data.messageId, patch) : old),
      );
      void utils.chat.getConversationDetails.invalidate();
    },
    [conversationId, utils.chat.listMessages, utils.chat.getConversationDetails],
  );
  useSocketEvent("message:updated", handleMessageUpdated);

  const handleMessageReaction = useCallback(
    (data: {
      conversationId: number;
      messageId: number;
      reactions: Array<{ emoji: string; userIds: string[] }>;
    }) => {
      if (data.conversationId !== conversationId) return;
      /* `mine` is per viewer, which is why the frame carries reactor ids and
         each client derives its own rather than trusting a sender's flag. */
      const groups = data.reactions
        .filter((r) => r.userIds.length > 0)
        .map((r) => ({
          emoji: r.emoji,
          count: r.userIds.length,
          mine: r.userIds.includes(userId),
        }))
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));

      utils.chat.listMessages.setInfiniteData(
        { conversationId: data.conversationId, limit: PAGE_SIZE },
        (old) => (old ? patchMessage(old, data.messageId, { reactions: groups }) : old),
      );
    },
    [conversationId, userId, utils.chat.listMessages],
  );
  useSocketEvent("message:reaction", handleMessageReaction);

  // ── navigation helpers ──────────────────────────────────────────────
  const jumpToMessage = useCallback((messageId: number) => {
    const el = document.getElementById(`chat-message-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(messageId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, []);

  const selectSearchHit = useCallback(
    (hit: SearchHit) => {
      setRailQuery("");
      if (hit.conversationId === conversationId) {
        jumpToMessage(hit.id);
        return;
      }
      router.push(`/chat/${hit.conversationId}?message=${hit.id}`);
    },
    [conversationId, jumpToMessage, router],
  );

  /* A deep link can name a message. Wait for it to be in the DOM — it may be on
     a page that has not loaded yet, in which case nothing happens and the user
     simply lands at the bottom of the thread. */
  useEffect(() => {
    if (typeof window === "undefined" || conversationId === null) return;
    const target = new URLSearchParams(window.location.search).get("message");
    if (!target) return;
    const messageId = Number(target);
    if (!Number.isFinite(messageId)) return;

    const id = setTimeout(() => jumpToMessage(messageId), 350);
    return () => clearTimeout(id);
  }, [conversationId, messagesQuery.isLoading, jumpToMessage]);

  /* Escape closes the details pane — expected of any panel like this. */
  useEffect(() => {
    if (!showDetails) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowDetails(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showDetails]);

  /* Attachment previews are object URLs; releasing them on unmount keeps a long
     session from leaking every image the user ever picked. */
  useEffect(() => {
    return () => {
      for (const item of attachments) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusOf = useCallback(
    (message: ThreadMessage): SendStatus => {
      if (message.id > 0) return "sent";
      return failedSends.has(message.id) ? "failed" : "sending";
    },
    [failedSends],
  );

  const addFiles = useCallback((files: File[]) => {
    setAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      })),
    ]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const item = prev[index];
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const draft = conversationId === null ? "" : getDraft(conversationId);
  const threadOpen = conversationId !== null;

  return (
    <div className="flex h-full w-full bg-bg-primary overflow-hidden">
      {/* Rail. Hidden on mobile once a thread is open — the thread is its own
          route, so the browser back button returns here. */}
      <div
        className={`${threadOpen ? "hidden lg:flex" : "flex"} w-full lg:w-[300px] xl:w-[330px] flex-col flex-none`}
      >
        <ConversationRail
          conversations={conversations}
          selectedId={conversationId}
          userId={userId}
          locale={timeLocale}
          query={railQuery}
          onQueryChange={setRailQuery}
          filter={filter}
          onFilterChange={setFilter}
          searchHits={debouncedQuery.length >= 2 ? searchQuery.data ?? [] : []}
          isSearching={searchQuery.isFetching}
          onSelect={(id) => router.push(`/chat/${id}`)}
          onSelectSearchHit={selectSearchHit}
          onNewChat={() => setShowNewChat(true)}
          isOnline={isOnline}
          hasDraft={hasDraft}
          typingConversationIds={typingConversations}
          isLoading={conversationsQuery.isLoading}
        />
      </div>

      {/* Thread */}
      <div className={`${threadOpen ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col`}>
        {threadOpen && activeConversation && otherUser ? (
          <>
            <header className="flex items-center gap-3 px-3 sm:px-5 py-3 border-b border-border-light/40 bg-bg-surface flex-none">
              <button
                type="button"
                onClick={() => router.push("/chat")}
                aria-label={t("backToConversations")}
                className="lg:hidden p-1.5 rounded-lg text-fg-secondary hover:bg-bg-secondary transition-colors flex-shrink-0"
              >
                <ArrowLeft size={18} />
              </button>
              <Avatar
                user={otherUser}
                size="lg"
                online={isOnline(otherUser.id)}
                fallbackLabel={t("userFallback")}
                peek
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-fg-primary truncate">
                  {displayName(otherUser, t("userFallback"))}
                </h2>
                <p
                  className={`text-xs truncate ${peerTyping ? "text-accent-primary" : "text-fg-tertiary"}`}
                  aria-live="polite"
                >
                  {peerTyping
                    ? t("typing")
                    : isOnline(otherUser.id)
                      ? t("activeNow")
                      : t("offline")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  /* The rail's search box is the one search in this surface —
                     it matches names and message bodies together. Focus it
                     rather than opening a second, narrower one. */
                  document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
                }}
                aria-label={t("searchInConversation")}
                className="hidden sm:grid place-items-center p-2 rounded-lg text-fg-tertiary hover:text-accent-primary hover:bg-bg-secondary transition-colors"
              >
                <Search size={17} />
              </button>
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                aria-label={t("details")}
                aria-pressed={showDetails}
                className={`p-2 rounded-lg transition-colors ${
                  showDetails
                    ? "text-accent-primary bg-accent-primary/10"
                    : "text-fg-tertiary hover:text-accent-primary hover:bg-bg-secondary"
                }`}
              >
                <Info size={17} />
              </button>
            </header>

            <MessageThread
              messages={messages}
              userId={userId}
              locale={timeLocale}
              peerLastReadId={peerLastReadId}
              unreadAfterId={unreadAfterId}
              statusOf={statusOf}
              participants={participants}
              peerTyping={peerTyping}
              peerName={displayName(otherUser, t("userFallback"))}
              hasPreviousPage={messagesQuery.hasPreviousPage}
              isFetchingPreviousPage={messagesQuery.isFetchingPreviousPage}
              onLoadPrevious={() => void messagesQuery.fetchPreviousPage()}
              onVisibleNewest={handleVisibleNewest}
              onReply={setReplyingTo}
              onToggleReaction={(messageId, emoji) => toggleReaction.mutate({ messageId, emoji })}
              onEdit={(messageId, body) => editMessage.mutate({ messageId, body })}
              onDelete={(messageId) => deleteMessage.mutate({ messageId })}
              onTogglePin={(messageId) => togglePin.mutate({ messageId })}
              onRetry={retrySend}
              onDiscard={discardSend}
              highlightedId={highlightedId}
              onJumpToMessage={jumpToMessage}
              isLoading={messagesQuery.isLoading}
            />

            <Composer
              value={draft}
              onChange={(next) => setDraft(conversationId, next)}
              onSend={() => void doSend()}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              attachments={attachments}
              onAddFiles={addFiles}
              onRemoveAttachment={removeAttachment}
              onTyping={notifyTyping}
              onStopTyping={stopTyping}
              disabled={false}
              isSending={sendMessage.isPending}
              isUploading={isUploading}
              hasDraft={draft.trim().length > 0}
              placeholder={t("messageSomeone", {
                name: displayName(otherUser, t("userFallback")),
              })}
            />
          </>
        ) : threadOpen ? (
          <div className="flex-1 grid place-items-center">
            {conversationsQuery.isLoading ? (
              <Loader2 className="animate-spin text-accent-primary" size={22} />
            ) : (
              <div className="text-center px-6">
                <p className="text-sm font-semibold text-fg-primary mb-1">{t("conversationNotFound")}</p>
                <button
                  type="button"
                  onClick={() => router.push("/chat")}
                  className="text-sm text-accent-primary font-semibold hover:underline"
                >
                  {t("backToConversations")}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 grid place-items-center px-8">
            <div className="text-center max-w-sm">
              <div className="w-20 h-20 rounded-full bg-accent-primary/10 grid place-items-center mx-auto mb-5">
                <MessageSquare size={32} className="text-accent-primary" />
              </div>
              <h2 className="text-xl font-bold text-fg-primary mb-2">{t("yourMessages")}</h2>
              <p className="text-sm text-fg-secondary mb-5">{t("selectConversationToStart")}</p>
              <button
                type="button"
                onClick={() => setShowNewChat(true)}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-br from-accent-primary to-accent-secondary text-white text-sm font-semibold shadow-accent hover:brightness-110 transition-all"
              >
                {t("startNewChat")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details. A slide-over below xl so it never squeezes the thread. */}
      {showDetails && threadOpen && activeConversation && (
        <>
          <div
            className="xl:hidden fixed inset-0 bg-black/40 z-40"
            onClick={() => setShowDetails(false)}
            aria-hidden="true"
          />
          <div className="fixed xl:static inset-y-0 right-0 z-50 xl:z-auto w-[300px] max-w-[85vw] flex-none">
            <ConversationDetails
              user={otherUser}
              online={isOnline(otherUser?.id)}
              details={detailsQuery.data}
              isLoading={detailsQuery.isLoading}
              muted={activeConversation.muted}
              archived={activeConversation.archived}
              onClose={() => setShowDetails(false)}
              onToggleMute={() =>
                setPrefs.mutate({
                  conversationId: activeConversation.id,
                  muted: !activeConversation.muted,
                })
              }
              onToggleArchive={() =>
                setPrefs.mutate({
                  conversationId: activeConversation.id,
                  archived: !activeConversation.archived,
                })
              }
              onClearHistory={() => setConfirm("clear")}
              onLeave={() => setConfirm("leave")}
              onJumpToMessage={jumpToMessage}
              busy={setPrefs.isPending || clearHistory.isPending || leaveConversation.isPending}
            />
          </div>
        </>
      )}

      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onSelect={(otherUserId) => createConversation.mutate({ otherUserId })}
          isCreating={createConversation.isPending}
          currentUserId={userId}
        />
      )}

      {confirm === "clear" && conversationId !== null && (
        <ConfirmDialog
          title={t("clearHistory")}
          message={t("clearHistoryConfirm")}
          confirmLabel={t("clearHistory")}
          isPending={clearHistory.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => clearHistory.mutate({ conversationId })}
        />
      )}

      {confirm === "leave" && conversationId !== null && (
        <ConfirmDialog
          title={t("leaveConversation")}
          message={t("leaveConversationConfirm")}
          confirmLabel={t("leaveConversation")}
          destructive
          isPending={leaveConversation.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => leaveConversation.mutate({ conversationId })}
        />
      )}
    </div>
  );
}

/* Re-exported so the thread and the shell agree on one message type. */
export type { ThreadMessage };
export { MessageBubble };
