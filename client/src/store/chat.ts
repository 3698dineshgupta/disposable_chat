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
}

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, LocalMessage[]>; // conversationId → messages
  typingUsers: Record<string, TypingState>; // conversationId → { userId: isTyping }
  onlineUsers: Set<string>;
  replyingTo: Record<string, LocalMessage | null>; // conversationId → msg
  searchText: Record<string, string>;
  rawIncoming: Record<string, RawIncoming[]>; // conversationId → unprocessed encrypted messages

  /* Conversation actions */
  setConversations: (convs: Conversation[]) => void;
  addConversation: (conv: Conversation) => void;
  updateConversation: (id: string, partial: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;

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

  setConversations: (convs) => set({ conversations: convs }),
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
}));
