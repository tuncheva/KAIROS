"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import { useSocket } from "~/components/providers/SocketProvider";
import { useSocketEvent } from "~/hooks/useSocketEvent";
import {
  appendMessage,
  dropMessage,
  hasMessage,
  nextOptimisticId,
  NEW_MESSAGE_EXTRAS,
  replaceMessage,
  seedPage,
} from "~/components/chat/messageCache";
import { MessageBox } from "react-chat-elements";
import Image from "next/image";

const MessageBubble = MessageBox as unknown as ComponentType<{
  position: "left" | "right";
  type: "text";
  text: string;
  title?: string;
  date?: Date;
  avatar?: string;
}>;

type ChatUser = {
  id: string;
  name: string | null;
  image: string | null;
};

type ListMessagesPage = RouterOutputs["chat"]["listMessages"];
type SendMessageOutput = RouterOutputs["chat"]["sendMessage"];
type ChatMessage = ListMessagesPage["messages"][number];

export function ProjectChat({ projectId, currentUserId }: { projectId: number; currentUserId: string }) {
  const utils = api.useUtils();

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const listUsers = api.chat.listProjectUsers.useQuery(
    { projectId },
    {
      staleTime: 1000 * 60,
    },
  );

  const otherUsers: ChatUser[] = useMemo(() => listUsers.data ?? [], [listUsers.data]);

  // Destructure `mutate`: react-query keeps it referentially stable, whereas the
  // mutation object is recreated on every render. Depending on the object below
  // is what made this effect re-fire endlessly.
  const { mutate: openConversation } = api.chat.getOrCreateProjectConversation.useMutation({
    onSuccess: (data) => {
      setConversationId(data.conversationId);
    },
  });

  // Tracks the (project, user) pair we have already opened a conversation for.
  //
  // The previous version guarded only on `isPending` while depending on the
  // mutation object, so each settled mutation re-ran the effect and fired
  // another one: an unbounded loop of getOrCreateProjectConversation calls for
  // as long as the tab stayed open, each doing an access check plus several
  // more queries.
  const requestedPairRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedUserId) {
      requestedPairRef.current = null;
      setConversationId(null);
      return;
    }

    const pairKey = `${projectId}:${selectedUserId}`;
    if (requestedPairRef.current === pairKey) return;
    requestedPairRef.current = pairKey;

    setConversationId(null);
    openConversation({ projectId, otherUserId: selectedUserId });
  }, [selectedUserId, projectId, openConversation]);

  const messagesQuery = api.chat.listMessages.useInfiniteQuery(
    { conversationId: conversationId ?? -1, limit: 50 },
    {
      enabled: conversationId !== null,
      // New messages arrive over the socket (see the message:new handler below).
      // This is only a fallback for a dropped connection — it used to be 500ms,
      // i.e. two requests per second per open chat.
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      /* Backwards: `prevCursor` anchors the page before this one, so history
         must be prepended. See `~/components/chat/messageCache`. */
      getPreviousPageParam: (firstPage) => firstPage.prevCursor,
      getNextPageParam: () => undefined,
    },
  );

  const messages: ChatMessage[] = useMemo(
    () => messagesQuery.data?.pages.flatMap((p) => p.messages) ?? [],
    [messagesQuery.data],
  );

  // ---------------------------------------------------------------------------
  // Real-time delivery (replaces the 500ms poll this component used to run)
  // ---------------------------------------------------------------------------
  const socket = useSocket();

  /* Re-join on every `connect`: server-side room membership is tied to a socket
     id and does not survive a reconnect, and socket.io reuses the same client
     object, so this effect would not otherwise re-run. */
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

  const handleNewMessage = useCallback(
    (data: {
      messageId: number;
      conversationId: number;
      senderId: string;
      body: string;
      senderName: string | null;
      senderImage: string | null;
      createdAt: string | Date;
      /* Optional: the frame carries attachments now, but a project thread that
         was open across the deploy can still receive one sent without them. */
      attachments?: ChatMessage["attachments"];
    }) => {
      if (data.conversationId !== conversationId) return;
      // Our own messages are already in the cache via the optimistic update.
      if (data.senderId === currentUserId) return;

      utils.chat.listMessages.setInfiniteData(
        { conversationId: data.conversationId, limit: 50 },
        (old) => {
          if (!old) return old;
          // The server also fans out to each participant's user room, so the same
          // message can arrive twice.
          if (hasMessage(old, data.messageId)) return old;
          return appendMessage(old, {
            id: data.messageId,
            body: data.body,
            createdAt: new Date(data.createdAt),
            senderId: data.senderId,
            senderName: data.senderName,
            senderImage: data.senderImage,
            ...NEW_MESSAGE_EXTRAS,
            attachments: data.attachments ?? [],
          });
        },
      );
    },
    [conversationId, currentUserId, utils.chat.listMessages],
  );
  useSocketEvent("message:new", handleNewMessage);

  const sendMessage = api.chat.sendMessage.useMutation({
    onMutate: async (variables) => {
      if (!conversationId) return;

      await utils.chat.listMessages.cancel({ conversationId, limit: 50 });

      /* Carried to onSuccess/onError so each send only ever touches its own
         placeholder. Clearing every negative id there dropped the second of
         two messages sent in quick succession. */
      const optimisticId = nextOptimisticId();

      const optimistic: ChatMessage = {
        id: optimisticId,
        body: variables.body,
        createdAt: new Date(),
        senderId: currentUserId,
        senderName: null,
        senderImage: null,
        ...NEW_MESSAGE_EXTRAS,
      };

      utils.chat.listMessages.setInfiniteData(
        { conversationId, limit: 50 },
        (old) => (old ? appendMessage(old, optimistic) : seedPage(optimistic)),
      );

      setDraft("");

      return { optimisticId };
    },
    onError: (_err, _variables, context) => {
      if (!conversationId || context?.optimisticId === undefined) return;
      utils.chat.listMessages.setInfiniteData(
        { conversationId, limit: 50 },
        (old) => (old ? dropMessage(old, context.optimisticId) : old),
      );
    },
    onSuccess: async (msg: SendMessageOutput, _variables, context) => {
      if (conversationId === null) return;
      const realMsg: ChatMessage = {
        id: msg.id ?? -1, body: msg.body ?? "", createdAt: msg.createdAt ?? new Date(),
        senderId: msg.senderId ?? currentUserId, senderName: msg.senderName ?? null, senderImage: msg.senderImage ?? null,
        ...NEW_MESSAGE_EXTRAS,
        attachments: msg.attachments ?? [],
        replyTo: msg.replyTo ?? null,
      };
      const optimisticId = context?.optimisticId;
      utils.chat.listMessages.setInfiniteData(
        { conversationId, limit: 50 },
        (old) => {
          if (!old) return old;
          /* The socket echo may have landed first. */
          if (hasMessage(old, realMsg.id)) return dropMessage(old, optimisticId);
          if (optimisticId === undefined) return appendMessage(old, realMsg);
          return replaceMessage(old, optimisticId, realMsg);
        },
      );

      await utils.chat.listProjectConversations.invalidate({ projectId });
    },
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, conversationId]);

  const selectedUser = otherUsers.find((u) => u.id === selectedUserId);

  return (
    <div className="surface-card overflow-hidden flex flex-col h-full min-h-[420px] lg:h-[calc(100vh-12rem)] shadow-lg">
      <div className="px-4 py-3 border-b border-border-light/20 flex items-center justify-between gap-3 bg-gradient-to-r from-bg-elevated to-bg-surface">
        <div className="min-w-0 flex items-center gap-2">
          {selectedUser?.image ? (
            <Image src={selectedUser.image} alt={selectedUser.name ?? "User"} width={32} height={32} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center">
              <span className="text-xs font-bold text-accent-primary">{selectedUser?.name?.[0] ?? "?"}</span>
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-fg-primary">{selectedUser ? selectedUser.name ?? "User" : "Chat"}</p>
            <p className="text-xs text-fg-tertiary truncate">
              {selectedUser ? "Direct message" : "Select a user to start"}
            </p>
          </div>
        </div>

        <select
          className="text-sm bg-bg-surface border border-border-light/30 rounded-lg px-3 py-2 text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          value={selectedUserId ?? ""}
          onChange={(e) => setSelectedUserId(e.target.value || null)}
        >
          <option value="">Select user…</option>
          {otherUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? "User"}
            </option>
          ))}
        </select>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 bg-gradient-to-b from-bg-surface/20 to-bg-primary">
        {!selectedUserId && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-accent-primary/10 flex items-center justify-center mx-auto mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-accent-primary">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-fg-secondary">Your Messages</p>
              <p className="text-xs text-fg-tertiary mt-1">Select a user to start chatting</p>
            </div>
          </div>
        )}

        {selectedUserId && messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-fg-tertiary">No messages yet.</p>
          </div>
        )}

        {selectedUserId &&
          messages.map((m, idx) => (
            <div key={`${m.id}-${idx}`} className="my-2">
              <MessageBubble
                position={m.senderId === currentUserId ? "right" : "left"}
                type="text"
                text={m.body}
                title={m.senderName ?? undefined}
                date={new Date(m.createdAt)}
                avatar={m.senderImage ?? undefined}
              />
            </div>
          ))}
      </div>

      <form
        className="p-3 border-t border-border-light/20 flex items-center gap-2 bg-bg-elevated/50"
        onSubmit={(e) => {
          e.preventDefault();
          const body = draft.trim();
          if (!body || conversationId === null || sendMessage.isPending) return;
          sendMessage.mutate({ conversationId, body });
        }}
      >
        <button
          type="button"
          className="p-2 rounded-full hover:bg-bg-surface transition-colors text-accent-primary"
          title="Attach photo"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={selectedUserId ? "Message..." : "Select a user..."}
          disabled={!selectedUserId || conversationId === null}
          className="flex-1 text-sm bg-bg-surface border border-border-light/30 rounded-full px-4 py-2.5 text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/30 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!selectedUserId || conversationId === null || sendMessage.isPending || draft.trim().length === 0}
          className="px-4 py-2.5 rounded-full text-sm font-semibold bg-gradient-to-r from-accent-primary to-accent-secondary text-white disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-all"
        >
          Send
        </button>
      </form>
    </div>
  );
}
