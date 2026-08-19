"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import Image from "next/image";
import { Send, Paperclip, Search, MoreVertical, X, Plus, MessageCircle, Users, Trash2 } from "lucide-react";
import { useToast } from "~/components/providers/ToastProvider";
import { useUploadThing } from "~/lib/uploadthing";
import { useSocket } from "~/components/providers/SocketProvider";
import { useSocketEvent } from "~/lib/useSocketEvent";

type ChatMessage = RouterOutputs["chat"]["listMessages"]["messages"][number];
type ParticipantSuggestion = RouterOutputs["chat"]["getParticipantSuggestions"];

export function ChatClient({ userId }: { userId: string }) {
  const t = useTranslations("chat.direct");
  const locale = useLocale();
  const timeLocale = locale === "bg" ? "bg-BG" : "en-US";
  const toast = useToast();
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatEmail, setNewChatEmail] = useState("");
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatMenuRef = useRef<HTMLDivElement | null>(null);

  const utils = api.useUtils();
  const searchParams = useSearchParams();
  const { startUpload } = useUploadThing("chatAttachment");

  const participantSuggestionsQuery = api.chat.getParticipantSuggestions.useQuery();
  const participantSuggestions: ParticipantSuggestion = participantSuggestionsQuery.data ?? {
    organizationMembers: [],
    recentContacts: [],
    projectSuggestions: [],
  };
  const workspaceMembers = participantSuggestions.organizationMembers;

  // Get all conversations (real-time updates via Socket.IO)
  const conversationsQuery = api.chat.listAllConversations.useQuery(undefined);

  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  // Allow deep-linking into a conversation via URL: /chat?conversationId=123
  useEffect(() => {
    const raw = searchParams.get("conversationId");
    if (!raw) return;

    const cid = Number(raw);
    if (!cid || Number.isNaN(cid)) return;

    // Only set if it differs, to avoid infinite loops.
    if (selectedConversationId === cid) return;

    // Ensure the user actually has access to this conversation.
    const convo = conversations.find((c) => c.id === cid);
    if (!convo) return;

    const otherUser = convo.userOne.id === userId ? convo.userTwo : convo.userOne;
    setSelectedConversationId(cid);
    setSelectedUserId(otherUser.id);
  }, [conversations, searchParams, selectedConversationId, userId]);

  // Get messages for selected conversation (cursor-based pagination)
  const messagesQuery = api.chat.listMessages.useInfiniteQuery(
    { conversationId: selectedConversationId ?? -1, limit: 50 },
    {
      enabled: selectedConversationId !== null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  const messages = useMemo(
    () => messagesQuery.data?.pages.flatMap((p) => p.messages) ?? [],
    [messagesQuery.data],
  );

  // Send message
  const sendMessage = api.chat.sendMessage.useMutation({
    onMutate: async (variables) => {
      if (!selectedConversationId) return;

      await utils.chat.listMessages.cancel({ conversationId: selectedConversationId, limit: 50 });

      const previous = utils.chat.listMessages.getInfiniteData({ conversationId: selectedConversationId, limit: 50 });

      const optimistic: ChatMessage = {
        id: -Date.now(),
        body: variables.body,
        createdAt: new Date(),
        senderId: userId,
        senderName: null,
        senderImage: null,
      };

      utils.chat.listMessages.setInfiniteData(
        { conversationId: selectedConversationId, limit: 50 },
        (old) => {
          if (!old) return { pages: [{ messages: [optimistic], nextCursor: undefined }], pageParams: [null] as (number | null)[] };
          const lastPageIdx = old.pages.length - 1;
          return {
            ...old,
            pages: old.pages.map((page, i) =>
              i === lastPageIdx
                ? { ...page, messages: [...page.messages, optimistic] }
                : page,
            ),
          };
        },
      );

      setDraft("");
      return { previous };
    },
    onError: (_err, _variables, context) => {
      console.error("[ChatClient] sendMessage error:", _err);
      if (!selectedConversationId || !context?.previous) return;
      utils.chat.listMessages.setInfiniteData(
        { conversationId: selectedConversationId, limit: 50 },
        context.previous,
      );
      toast.error(t("failedToSendMessage"));
    },
    onSuccess: async (msg) => {
      if (selectedConversationId === null) return;

      const realMsg: ChatMessage = {
        id: msg.id ?? -1,
        body: msg.body ?? "",
        createdAt: msg.createdAt ?? new Date(),
        senderId: msg.senderId ?? userId,
        senderName: msg.senderName ?? null,
        senderImage: msg.senderImage ?? null,
      };

      // Replace optimistic message with real one
      utils.chat.listMessages.setInfiniteData(
        { conversationId: selectedConversationId, limit: 50 },
        (old) => {
          if (!old) return old!;
          const lastPageIdx = old.pages.length - 1;
          return {
            ...old,
            pages: old.pages.map((page, i) =>
              i === lastPageIdx
                ? { ...page, messages: [...page.messages.filter((m) => m.id > 0), realMsg] }
                : page,
            ),
          };
        },
      );

      await utils.chat.listAllConversations.invalidate();
    },
  });

  // Search user by email for new chat
  const searchUserQuery = api.user.searchByEmail.useQuery(
    { email: newChatEmail.trim() },
    { enabled: newChatEmail.trim().length > 3 && newChatEmail.includes("@"), retry: false }
  );

  const recentContacts = participantSuggestions.recentContacts;

  // Filter workspace members based on search input
  const filteredMemberSuggestions = useMemo(() => {
    const allMembers = workspaceMembers
      .filter((member) => member.id !== userId)
      .sort((a, b) =>
        (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "", timeLocale, { sensitivity: "base" }),
      );
    if (!newChatEmail.trim()) return allMembers;
    const query = newChatEmail.toLowerCase().trim();
    return allMembers.filter((member) =>
      (member.name?.toLowerCase() ?? "").includes(query) ||
      (member.email?.toLowerCase() ?? "").includes(query),
    );
  }, [workspaceMembers, newChatEmail, userId, timeLocale]);

  const filteredRecentContacts = useMemo(() => {
    if (!newChatEmail.trim()) return recentContacts.slice(0, 8);
    const query = newChatEmail.toLowerCase().trim();
    return recentContacts
      .filter((member) =>
        (member.name?.toLowerCase() ?? "").includes(query) ||
        (member.email?.toLowerCase() ?? "").includes(query),
      )
      .slice(0, 8);
  }, [recentContacts, newChatEmail]);
  const filteredProjectSuggestions = useMemo(() => {
    const query = newChatEmail.toLowerCase().trim();
    if (!query) return participantSuggestions.projectSuggestions.slice(0, 6);
    return participantSuggestions.projectSuggestions
      .map((project) => ({
        ...project,
        members: project.members.filter(
          (member) =>
            (member.name?.toLowerCase() ?? "").includes(query) ||
            (member.email?.toLowerCase() ?? "").includes(query),
        ),
      }))
      .filter((project) => project.members.length > 0)
      .slice(0, 6);
  }, [participantSuggestions.projectSuggestions, newChatEmail]);

  // Create new conversation
  const createConversation = api.chat.getOrCreateDirectConversation.useMutation({
    onSuccess: async (data) => {
      setSelectedConversationId(data.conversationId);
      await utils.chat.listAllConversations.invalidate();
      setShowNewChatModal(false);
      setNewChatEmail("");
      toast.success(t("chatStarted"));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleStartNewChat = () => {
    if (searchUserQuery.data) {
      createConversation.mutate({ otherUserId: searchUserQuery.data.id });
    }
  };

  // Delete conversation
  const deleteConversation = api.chat.deleteConversation.useMutation({
    onSuccess: async () => {
      setSelectedConversationId(null);
      setSelectedUserId(null);
      setShowChatMenu(false);
      setConfirmDeleteChat(false);
      await utils.chat.listAllConversations.invalidate();
      toast.success(t("chatDeleted"));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleDeleteChat = () => {
    if (!selectedConversationId) return;
    deleteConversation.mutate({ conversationId: selectedConversationId });
  };

  // Close chat menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) {
        setShowChatMenu(false);
      }
    };
    if (showChatMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showChatMenu]);

  const handleSelectMember = (member: { id: string }) => {
    createConversation.mutate({ otherUserId: member.id });
  };

  // -----------------------------------------------------------------------
  // Socket.IO: room management + real-time event listeners
  // -----------------------------------------------------------------------
  const socket = useSocket();

  // Join / leave conversation rooms when the selected conversation changes.
  useEffect(() => {
    if (!socket || selectedConversationId === null) return;
    socket.emit("join:conversation", selectedConversationId);
    return () => {
      socket.emit("leave:conversation", selectedConversationId);
    };
  }, [socket, selectedConversationId]);

  // On new message pushed via socket → append to the local cache.
  const handleNewMessage = useCallback(
    (data: {
      messageId: number;
      conversationId: number;
      senderId: string;
      body: string;
      senderName: string | null;
      senderImage: string | null;
      createdAt: string | Date;
    }) => {
      if (data.conversationId !== selectedConversationId) return;
      // Don't duplicate our own messages (already handled via optimistic update).
      if (data.senderId === userId) return;
      const newMsg: ChatMessage = {
        id: data.messageId,
        body: data.body,
        createdAt: new Date(data.createdAt),
        senderId: data.senderId,
        senderName: data.senderName,
        senderImage: data.senderImage,
      };
      utils.chat.listMessages.setInfiniteData(
        { conversationId: data.conversationId, limit: 50 },
        (old) => {
          if (!old) return old!;
          // Deduplicate: skip if message already exists (can happen if user is in both conversation room and user room)
          const allMsgIds = new Set(old.pages.flatMap((p) => p.messages.map((m) => m.id)));
          if (allMsgIds.has(data.messageId)) return old;
          const lastPageIdx = old.pages.length - 1;
          return {
            ...old,
            pages: old.pages.map((page, i) =>
              i === lastPageIdx
                ? { ...page, messages: [...page.messages, newMsg] }
                : page,
            ),
          };
        },
      );
    },
    [selectedConversationId, userId, utils.chat.listMessages],
  );
  useSocketEvent("message:new", handleNewMessage);

  // On conversation updated → invalidate conversations list to refresh ordering.
  const handleConversationUpdated = useCallback(() => {
    void utils.chat.listAllConversations.invalidate();
  }, [utils.chat.listAllConversations]);
  useSocketEvent("conversation:updated", handleConversationUpdated);

  // Auto-scroll to bottom when new messages arrive (not when loading older)
  const prevMsgCount = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if messages were appended (new ones), not prepended (older ones)
    if (messages.length > prevMsgCount.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  // Load older messages when scrolled to the top
  const handleMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 80 && messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) {
      const prevHeight = el.scrollHeight;
      void messagesQuery.fetchNextPage().then(() => {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - prevHeight;
        });
      });
    }
  }, [messagesQuery]);

  const selectedUser = conversations
    .flatMap((c) => [c.userOne, c.userTwo])
    .find((u) => u.id === selectedUserId);

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery) return true;
    const otherUser = c.userOne.id === userId ? c.userTwo : c.userOne;
    const name = otherUser.name?.toLowerCase() ?? "";
    const email = otherUser.email?.toLowerCase() ?? "";
    const query = searchQuery.toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  const doSend = () => {
    if (!selectedConversationId || (!draft.trim() && attachments.length === 0) || sendMessage.isPending || isUploading) return;
    const messageBody = draft.trim();
    if (messageBody) {
      sendMessage.mutate({ conversationId: selectedConversationId, body: messageBody });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConversationId || (!draft.trim() && attachments.length === 0) || sendMessage.isPending || isUploading) return;

    // Upload attachments if any
    if (attachments.length > 0) {
      setIsUploading(true);
      try {
        let messageBody = draft.trim();
        const uploaded = await startUpload(attachments);
        if (uploaded) {
          const attachmentUrls = uploaded.map(f => f.url).join('\n');
          messageBody = messageBody ? `${messageBody}\n\n${attachmentUrls}` : attachmentUrls;
        }
        setAttachments([]);
        setIsUploading(false);
        if (messageBody) {
          sendMessage.mutate({ conversationId: selectedConversationId, body: messageBody });
        }
      } catch (err) {
        console.error("Upload failed:", err);
        toast.error(t("failedToUploadAttachments"));
        setIsUploading(false);
      }
      return;
    }

    doSend();
  };

  return (
<div className="flex flex-col sm:flex-row h-full w-full bg-bg-primary">      
      {/* Delete Chat Confirmation Dialog */}
      {confirmDeleteChat && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-secondary rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in slide-in-from-bottom-4">
            <h3 className="text-lg font-bold text-fg-primary mb-2">{t("deleteChatTitle")}</h3>
            <p className="text-sm text-fg-secondary mb-6">{t("deleteChatConfirmMessage")}</p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteChat(false)}
                className="px-4 py-2 text-sm font-medium text-fg-secondary hover:bg-bg-surface rounded-lg transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleDeleteChat}
                disabled={deleteConversation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
              >
                {deleteConversation.isPending ? t("deleting") : t("delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-secondary rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in fade-in slide-in-from-bottom-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 sticky top-0 bg-bg-secondary pb-2">
               <h3 className="text-lg font-bold text-fg-primary">{t("startNewChat")}</h3>
              <button
                onClick={() => { setShowNewChatModal(false); setNewChatEmail(""); }}
                className="p-2 hover:bg-bg-surface rounded-lg transition-colors"
              >
                <X size={20} className="text-fg-secondary" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-fg-secondary mb-2">{t("searchOrEnterEmail")}</label>
                <input
                  type="text"
                  value={newChatEmail}
                  onChange={(e) => setNewChatEmail(e.target.value)}
                  placeholder={t("searchByNameOrEmail")}
                  className="w-full px-4 py-3 bg-bg-surface rounded-xl text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                />
              </div>

              {/* Recent contacts section */}
              {filteredRecentContacts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <MessageCircle size={16} className="text-fg-tertiary" />
                    <p className="text-xs font-semibold text-fg-tertiary uppercase">{t("recentContacts")}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {filteredRecentContacts.map((member) => (
                      <button
                        key={`recent-${member.id}`}
                        onClick={() => handleSelectMember(member)}
                        disabled={createConversation.isPending}
                        className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-bg-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left min-h-11"
                      >
                        {member.image ? (
                          <Image
                            src={member.image}
                            alt={member.name ?? t("userFallback")}
                            width={36}
                            height={36}
                            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                            {member.name?.[0]?.toUpperCase() ?? "?"}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-fg-primary truncate">{member.name ?? t("userFallback")}</p>
                          <p className="text-xs text-fg-tertiary truncate">{member.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Project members quick-add section */}
              {filteredProjectSuggestions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Users size={16} className="text-fg-tertiary" />
                    <p className="text-xs font-semibold text-fg-tertiary uppercase">{t("projectMembersQuickAdd")}</p>
                  </div>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {filteredProjectSuggestions.map((project) => (
                      <div key={project.projectId} className="rounded-lg border border-white/[0.06] p-2">
                        <p className="px-1 pb-1 text-[11px] font-semibold text-fg-tertiary truncate">{project.projectTitle}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {project.members.slice(0, 6).map((member) => (
                            <button
                              key={`project-${project.projectId}-${member.id}`}
                              onClick={() => handleSelectMember(member)}
                              disabled={createConversation.isPending}
                              className="rounded-full bg-bg-primary px-3 py-1.5 text-xs text-fg-secondary border border-white/[0.08] hover:border-accent-primary/35 hover:text-fg-primary transition min-h-11"
                            >
                              {member.name ?? member.email}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Workspace Members Section */}
              {filteredMemberSuggestions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Users size={16} className="text-fg-tertiary" />
                    <p className="text-xs font-semibold text-fg-tertiary uppercase">{t("workspaceMembers")}</p>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {filteredMemberSuggestions.map((member) => (
                      <button
                        key={member.id}
                        onClick={() => handleSelectMember(member)}
                        disabled={createConversation.isPending}
                        className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-bg-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left min-h-11"
                      >
                        {member.image ? (
                          <Image
                            src={member.image}
                            alt={member.name ?? t("userFallback")}
                            width={40}
                            height={40}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                            {member.name?.[0]?.toUpperCase() ?? "?"}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                           <p className="text-sm font-semibold text-fg-primary truncate">{member.name ?? t("userFallback")}</p>
                          <p className="text-xs text-fg-tertiary truncate">{member.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Email Search Section */}
              {newChatEmail.trim().includes("@") && (
                <div className="border-t border-bg-elevated pt-4 space-y-2">
                  <p className="text-xs font-semibold text-fg-tertiary uppercase px-3">{t("searchResults")}</p>
                  {searchUserQuery.data && (
                    <button
                      onClick={handleStartNewChat}
                      disabled={createConversation.isPending}
                       className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-bg-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left min-h-11"
                     >
                      {searchUserQuery.data.image ? (
                        <Image
                          src={searchUserQuery.data.image}
                           alt={searchUserQuery.data.name ?? t("userFallback")}
                          width={40}
                          height={40}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                          {searchUserQuery.data.name?.[0]?.toUpperCase() ?? "?"}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                         <p className="text-sm font-semibold text-fg-primary truncate">{searchUserQuery.data.name ?? t("userFallback")}</p>
                        <p className="text-xs text-fg-tertiary truncate">{searchUserQuery.data.email}</p>
                      </div>
                    </button>
                  )}
                  {searchUserQuery.isLoading && (
                    <p className="text-sm text-fg-tertiary text-center py-2">{t("searching")}</p>
                  )}
                  {searchUserQuery.isError && (
                    <p className="text-sm text-error text-center py-2">{t("userNotFound")}</p>
                  )}
                </div>
              )}

              {/* No Results Message */}
              {newChatEmail.trim() && filteredMemberSuggestions.length === 0 && !newChatEmail.includes("@") && (
                <p className="text-sm text-fg-tertiary text-center py-4">{t("noWorkspaceMembersMatch")}</p>
              )}

              {/* Empty State */}
              {!newChatEmail.trim() && filteredMemberSuggestions.length === 0 && (
                <p className="text-sm text-fg-tertiary text-center py-4">{t("noWorkspaceMembersAvailable")}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Conversations Sidebar */}
      <div className={`${selectedConversationId ? 'hidden sm:flex' : 'flex'} w-full sm:w-72 lg:w-80 xl:w-96 shadow-lg flex-col bg-bg-surface`}>
        <div className="p-3 sm:p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary" size={16} />
              <input
                type="text"
                placeholder={t("searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm bg-bg-surface shadow-sm rounded-full text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
              />
            </div>
            <button
              onClick={() => setShowNewChatModal(true)}
              className="p-2.5 bg-gradient-to-r from-accent-primary to-accent-secondary text-white rounded-full hover:shadow-lg transition-all flex-shrink-0"
              title={t("newChat")}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8">
              <div className="w-16 h-16 rounded-full bg-accent-primary/10 flex items-center justify-center mb-4">
                <MessageCircle size={28} className="text-accent-primary" />
              </div>
              <p className="text-sm font-medium text-fg-primary mb-1">{t("noConversationsYet")}</p>
              <p className="text-xs text-fg-tertiary text-center mb-4">{t("startNewChatToGetStarted")}</p>
              <button
                onClick={() => setShowNewChatModal(true)}
                className="px-4 py-2 bg-accent-primary/10 text-accent-primary text-sm font-medium rounded-lg hover:bg-accent-primary/20 transition-colors"
              >
                {t("startNewChat")}
              </button>
            </div>
          ) : (
            <div className="space-y-0.5 p-1.5 sm:p-2">
              {filteredConversations.map((conv) => {
                const otherUser = conv.userOne.id === userId ? conv.userTwo : conv.userOne;
                const lastMessageTime = conv.lastMessageAt
                  ? new Date(conv.lastMessageAt).toLocaleTimeString(timeLocale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";

                return (
                  <button
                    key={conv.id}
                    onClick={() => {
                      setSelectedConversationId(conv.id);
                      setSelectedUserId(otherUser.id);
                    }}
                    className={`w-full p-2.5 sm:p-3 rounded-xl transition-all text-left flex items-center gap-2.5 sm:gap-3 ${
                      selectedConversationId === conv.id
                        ? "bg-accent-primary/10 shadow-sm"
                        : "hover:bg-bg-elevated shadow-sm"
                    }`}
                  >
                    {otherUser.image ? (
                      <Image
                        src={otherUser.image}
                         alt={otherUser.name ?? t("userFallback")}
                        width={44}
                        height={44}
                        className="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover ring-2 ring-white/10 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                        {otherUser.name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-fg-primary truncate">
                          {otherUser.name ?? otherUser.email}
                        </p>
                        {lastMessageTime && (
                          <span className="text-xs text-fg-tertiary flex-shrink-0">{lastMessageTime}</span>
                        )}
                      </div>
                      <p className="text-xs text-fg-tertiary truncate">
                        {otherUser.email ?? t("userFallback")}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`${selectedConversationId ? 'flex' : 'hidden sm:flex'} flex-1 flex-col bg-bg-primary`}>
        {selectedConversationId && selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="px-3 sm:px-6 py-3 sm:py-4 shadow-sm flex items-center justify-between bg-gradient-to-r from-bg-elevated to-bg-surface">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => setSelectedConversationId(null)}
                  className="sm:hidden p-1.5 hover:bg-bg-surface rounded-lg transition-colors text-fg-primary"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                  </svg>
                </button>
                {selectedUser.image ? (
                  <Image
                    src={selectedUser.image}
                    alt={selectedUser.name ?? t("userFallback")}
                    width={40}
                    height={40}
                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover ring-2 ring-accent-primary/20 flex-shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs sm:text-sm font-bold text-accent-primary">
                      {selectedUser.name?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm sm:text-base font-bold text-fg-primary truncate">
                    {selectedUser.name ?? selectedUser.email}
                  </h2>
                </div>
              </div>
              <div className="relative flex-shrink-0" ref={chatMenuRef}>
                <button
                  onClick={() => setShowChatMenu(!showChatMenu)}
                  className="p-1.5 sm:p-2 hover:bg-bg-surface rounded-lg transition-colors text-fg-secondary"
                >
                  <MoreVertical size={18} className="sm:w-5 sm:h-5" />
                </button>
                {showChatMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-bg-elevated border border-white/10 rounded-xl shadow-xl z-50 py-1 min-w-[160px]">
                     <button
                       onClick={() => { setShowChatMenu(false); setConfirmDeleteChat(true); }}
                       className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                     >
                       <Trash2 size={15} />
                       {t("deleteChatTitle")}
                     </button>
                  </div>
                )}
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 sm:space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-accent-primary/10 flex items-center justify-center mx-auto mb-3">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-accent-primary">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-fg-secondary">{t("noMessagesYet")}</p>
                    <p className="text-xs text-fg-tertiary mt-1">{t("startConversation")}</p>
                  </div>
                </div>
              ) : (
                messages.map((message, idx) => {
                  const isOwn = message.senderId === userId;
                  const showAvatar = idx === 0 || messages[idx - 1]?.senderId !== message.senderId;

                  return (
                    <div key={`${message.id}-${idx}`} className={`flex items-end gap-1.5 sm:gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                      {showAvatar ? (
                        message.senderImage ? (
                          <Image
                            src={message.senderImage}
                             alt={message.senderName ?? t("userFallback")}
                            width={28}
                            height={28}
                            className="w-6 h-6 sm:w-7 sm:h-7 rounded-full object-cover ring-2 ring-white/10 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                            {message.senderName?.[0]?.toUpperCase() ?? "?"}
                          </div>
                        )
                      ) : (
                        <div className="w-6 sm:w-7" />
                      )}
                      <div className={`max-w-[75%] sm:max-w-[70%] ${isOwn ? "items-end" : "items-start"} flex flex-col gap-0.5 sm:gap-1`}>
                        {showAvatar && !isOwn && (
                          <span className="text-xs font-medium text-fg-secondary px-2.5 sm:px-3">
                            {message.senderName ?? t("userFallback")}
                          </span>
                        )}
                        <div
                          className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl ${
                            isOwn
                              ? "bg-gradient-to-r from-accent-primary to-accent-secondary text-white rounded-br-md"
                              : "bg-bg-elevated text-fg-primary rounded-bl-md"
                          }`}
                        >
                          {(() => {
                            const imageRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/utfs\.io\/[^\s]+)/gi;
                            const parts = message.body.split(imageRegex);
                            const matches = message.body.match(imageRegex) ?? [];
                            
                            if (matches.length === 0) {
                              return <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{message.body}</p>;
                            }
                            
                            return (
                              <div className="flex flex-col gap-2">
                                {parts.map((part, i) => (
                                  <span key={i}>
                                    {part && <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{part.trim()}</p>}
                                    {matches[i] && (
                                      <a href={matches[i]} target="_blank" rel="noopener noreferrer" className="block mt-2">
                                        <Image
                                          src={matches[i]}
                                          alt="Shared image"
                                          width={400}
                                          height={300}
                                          className="max-w-full max-h-64 rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
                                          unoptimized
                                        />
                                      </a>
                                    )}
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                        <span className="text-xs text-fg-tertiary px-2.5 sm:px-3">
                          {new Date(message.createdAt).toLocaleTimeString(timeLocale, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Message Input */}
            <form onSubmit={handleSubmit} className="p-3 sm:p-4 shadow-sm bg-bg-elevated">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3 p-2 bg-bg-surface rounded-lg">
                  {attachments.map((file, idx) => (
                    <div key={idx} className="relative group">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-elevated rounded-lg shadow-sm">
                        <span className="text-xs text-fg-secondary truncate max-w-[120px]">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                          className="text-fg-tertiary hover:text-error"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setAttachments([...attachments, ...files]);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="p-2 sm:p-2.5 rounded-full hover:bg-bg-surface transition-colors text-accent-primary disabled:opacity-50"
                  title={t("attachFiles")}
                >
                  <Paperclip size={18} className="sm:w-5 sm:h-5" />
                </button>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      doSend();
                    }
                  }}
                  placeholder={t("typeMessagePlaceholder")}
                  disabled={isUploading}
                  className="flex-1 text-sm bg-bg-surface shadow-sm rounded-full px-4 sm:px-5 py-2.5 sm:py-3 text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/30 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={(!draft.trim() && attachments.length === 0) || sendMessage.isPending || isUploading}
                  className="p-2.5 sm:p-3 rounded-full bg-gradient-to-r from-accent-primary to-accent-secondary text-white disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-all"
                >
                  {isUploading ? (
                    <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send size={16} className="sm:w-[18px] sm:h-[18px]" />
                  )}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md px-8">
              <div className="w-24 h-24 rounded-full bg-accent-primary/10 flex items-center justify-center mx-auto mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 text-accent-primary">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h3 className="text-xl font-bold text-fg-primary mb-2">{t("yourMessages")}</h3>
              <p className="text-fg-secondary">{t("selectConversationToStart")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
