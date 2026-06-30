import { create } from 'zustand';
import type { Conversation, LocalMessage, User } from '@/types';

interface TypingState {
  [userId: string]: boolean;
}

export interface RawIncoming {
  conversationId: string;
  senderId: string;
  encryptedPayload: any;
  messageType: string;
  localId?: string;
  timestamp: string;
  pendingDbId?: string; // set for messages:pending rows needing acknowledgement
  retryCount?: number;  // incremented on each failed decryption attempt
}

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, LocalMessage[]>; // conversationId → messages
  typingUsers: Record<string, TypingState>; // conversationId → { userId: isTyping }
  onlineUsers: Set<string>;
  replyingTo: Record<string, LocalMessage | null>; // conversationId → msg
  searchText: Record<string, string>;
  rawIncoming: Record<string, RawIncoming[]>; // conversationId → unprocessed encrypted messages
  pendingUnreads: Record<string, number>; // unread counts received before conversations loaded

  /* Conversation actions */
  setConversations: (convs: Conversation[]) => void;
  addConversation: (conv: Conversation) => void;
  updateConversation: (id: string, partial: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;
  addPendingUnreads: (counts: Record<string, number>) => void;
  clearPendingUnread: (convId: string) => void;

  /* Message actions */
  setMessages: (conversationId: string, msgs: LocalMessage[]) => void;
  prependMessages: (conversationId: string, msgs: LocalMessage[]) => void;
  addMessage: (msg: LocalMessage) => void;
  updateMessage: (localId: string, partial: Partial<LocalMessage>) => void;
  deleteMessage: (localId: string, forEveryone: boolean) => void;
  addReaction: (localId: string, userId: string, emoji: string | null) => void;

  /* Presence */
  setUserOnline: (userId: string) => void;
  setUserOffline: (userId: string) => void;
  setOnlineUsers: (userIds: string[]) => void;

  /* Typing */
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;

  /* Reply */
  setReplyingTo: (conversationId: string, msg: LocalMessage | null) => void;

  /* Search */
  setSearchText: (conversationId: string, text: string) => void;

  /* Raw incoming queue (encrypted, awaiting decryption when conversation opens) */
  queueIncoming: (msgs: RawIncoming[]) => void;
  clearIncoming: (conversationId: string) => void;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  conversations: [],
  messages: {},
  typingUsers: {},
  onlineUsers: new Set(),
  replyingTo: {},
  rawIncoming: {},
  searchText: {},
  pendingUnreads: {},

  // Merge any stored pending unread counts into the incoming conversations
  setConversations: (convs) =>
    set((s) => ({
      conversations: convs.map((c) =>
        s.pendingUnreads[c.id]
          ? { ...c, unreadCount: (c.unreadCount ?? 0) + s.pendingUnreads[c.id] }
          : c
      ),
    })),
  addConversation: (conv) =>
    set((s) => {
      const existing = s.conversations.find((c) => c.id === conv.id);
      if (existing) return s;
      return { conversations: [conv, ...s.conversations] };
    }),
  updateConversation: (id, partial) =>
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...partial } : c)),
    })),
  removeConversation: (id) =>
    set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) })),

  setMessages: (cid, msgs) =>
    set((s) => ({ messages: { ...s.messages, [cid]: msgs } })),
  prependMessages: (cid, msgs) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [cid]: [...msgs, ...(s.messages[cid] ?? [])],
      },
    })),
  addMessage: (msg) =>
    set((s) => {
      const existing = s.messages[msg.conversationId] ?? [];
      if (existing.some((m) => m.localId === msg.localId)) return s; // already in store, no-op
      return {
        messages: { ...s.messages, [msg.conversationId]: [...existing, msg] },
        conversations: s.conversations.map((c) =>
          c.id === msg.conversationId
            ? { ...c, lastMessage: msg, updated_at: msg.timestamp }
            : c
        ),
      };
    }),
  updateMessage: (localId, partial) =>
    set((s) => {
      const updated: Record<string, LocalMessage[]> = {};
      for (const [cid, msgs] of Object.entries(s.messages)) {
        updated[cid] = msgs.map((m) => (m.localId === localId ? { ...m, ...partial } : m));
      }
      return { messages: updated };
    }),
  deleteMessage: (localId, forEveryone) =>
    set((s) => {
      const updated: Record<string, LocalMessage[]> = {};
      for (const [cid, msgs] of Object.entries(s.messages)) {
        updated[cid] = msgs.map((m) =>
          m.localId === localId
            ? forEveryone
              ? { ...m, deletedForEveryone: true, text: undefined, mediaUrl: undefined }
              : { ...m, deletedForMe: true }
            : m
        );
      }
      return { messages: updated };
    }),
  addReaction: (localId, userId, emoji) =>
    set((s) => {
      const updated: Record<string, LocalMessage[]> = {};
      for (const [cid, msgs] of Object.entries(s.messages)) {
        updated[cid] = msgs.map((m) => {
          if (m.localId !== localId) return m;
          const reactions = m.reactions.filter((r) => r.userId !== userId);
          if (emoji) reactions.push({ userId, emoji });
          return { ...m, reactions };
        });
      }
      return { messages: updated };
    }),

  setUserOnline: (userId) =>
    set((s) => {
      const next = new Set(s.onlineUsers);
      next.add(userId);
      return { onlineUsers: next };
    }),
  setUserOffline: (userId) =>
    set((s) => {
      const next = new Set(s.onlineUsers);
      next.delete(userId);
      return { onlineUsers: next };
    }),
  setOnlineUsers: (userIds) => set({ onlineUsers: new Set(userIds) }),

  setTyping: (cid, userId, isTyping) =>
    set((s) => ({
      typingUsers: {
        ...s.typingUsers,
        [cid]: { ...(s.typingUsers[cid] ?? {}), [userId]: isTyping },
      },
    })),

  setReplyingTo: (cid, msg) =>
    set((s) => ({ replyingTo: { ...s.replyingTo, [cid]: msg } })),

  setSearchText: (cid, text) =>
    set((s) => ({ searchText: { ...s.searchText, [cid]: text } })),

  queueIncoming: (msgs) =>
    set((s) => {
      const next = { ...s.rawIncoming };
      for (const m of msgs) {
        const existing = next[m.conversationId] ?? [];
        // deduplicate by localId
        const dup = m.localId && existing.some((e) => e.localId === m.localId);
        if (!dup) next[m.conversationId] = [...existing, m];
      }
      return { rawIncoming: next };
    }),

  clearIncoming: (cid) =>
    set((s) => {
      const next = { ...s.rawIncoming };
      delete next[cid];
      return { rawIncoming: next };
    }),

  // Called by the socket handler when pending messages arrive before conversations load.
  // Immediately updates conversations that are already in the store, AND stores counts
  // for conversations that haven't loaded yet (merged in setConversations).
  addPendingUnreads: (counts) =>
    set((s) => {
      const nextPending = { ...s.pendingUnreads };
      for (const [id, count] of Object.entries(counts)) {
        nextPending[id] = (nextPending[id] ?? 0) + count;
      }
      // Also immediately update any conversations already in the store
      const conversations = s.conversations.map((c) =>
        counts[c.id] !== undefined
          ? { ...c, unreadCount: (c.unreadCount ?? 0) + counts[c.id] }
          : c
      );
      return { pendingUnreads: nextPending, conversations };
    }),

  clearPendingUnread: (convId) =>
    set((s) => {
      const { [convId]: _, ...rest } = s.pendingUnreads;
      return { pendingUnreads: rest };
    }),
}));
