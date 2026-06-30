'use client';

import { useEffect, useRef, useCallback } from 'react';
import { type Socket } from 'socket.io-client';
import { connectSocket, getSocket } from '@/lib/socket';
import { messageBus } from '@/lib/messageBus';
import { updateMessageStatus } from '@/lib/db/index';
import { useAuthStore } from '@/store/auth';
import { useChatStore, type RawIncoming } from '@/store/chat';
import { useCallStore } from '@/store/call';
import { useUIStore } from '@/store/ui';
import type { IncomingMessage, IncomingCall } from '@/types';
import toast from 'react-hot-toast';

export function useSocketSetup() {
  const { accessToken, isAuthenticated } = useAuthStore();
  const { setUserOnline, setUserOffline, setTyping, addMessage, updateMessage } = useChatStore();
  const { setIncomingCall } = useCallStore();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    const socket = connectSocket(accessToken);
    socketRef.current = socket;

    /* ── Presence ── */
    socket.on('user:online', ({ userId }: { userId: string }) => setUserOnline(userId));
    socket.on('user:offline', ({ userId }: { userId: string }) => setUserOffline(userId));

    /* ── Typing ── */
    socket.on('typing:start', ({ userId, conversationId }: { userId: string; conversationId: string }) =>
      setTyping(conversationId, userId, true)
    );
    socket.on('typing:stop', ({ userId, conversationId }: { userId: string; conversationId: string }) =>
      setTyping(conversationId, userId, false)
    );

    /* ── Messages ── */
    socket.on('message:receive', (data: IncomingMessage) => {
      messageBus.emit(data);
      useChatStore.getState().queueIncoming([{
        conversationId: data.conversationId,
        senderId: data.senderId,
        encryptedPayload: data.encryptedPayload,
        messageType: data.messageType,
        localId: data.localId,
        timestamp: data.timestamp,
      }]);

      // Increment unread count if this conversation isn't currently open
      const { activeConversationId } = useUIStore.getState();
      if (data.conversationId !== activeConversationId) {
        const { conversations, updateConversation } = useChatStore.getState();
        const conv = conversations.find((c) => c.id === data.conversationId);
        updateConversation(data.conversationId, {
          unreadCount: (conv?.unreadCount ?? 0) + 1,
          updated_at: data.timestamp,
        });
      }
    });

    /* Queue pending messages (offline delivery) */
    socket.on('messages:pending', ({ messages }: { messages: any[] }) => {
      const shaped: RawIncoming[] = messages.map((m) => ({
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        encryptedPayload: m.encrypted_payload,
        messageType: m.message_type,
        localId: m.local_id,
        timestamp: m.created_at,
        pendingDbId: m.id,
      }));
      useChatStore.getState().queueIncoming(shaped);

      // Build per-conversation unread counts (skip the currently open conversation)
      const { activeConversationId } = useUIStore.getState();
      const perConv: Record<string, number> = {};
      for (const m of messages) {
        if (m.conversation_id !== activeConversationId) {
          perConv[m.conversation_id] = (perConv[m.conversation_id] ?? 0) + 1;
        }
      }
      if (Object.keys(perConv).length > 0) {
        // addPendingUnreads handles both cases:
        //   - conversations already loaded → updated immediately
        //   - conversations not yet loaded → stored and merged when setConversations fires
        useChatStore.getState().addPendingUnreads(perConv);
      }
    });

    socket.on('message:delivered', ({ localId }: { localId: string }) => {
      updateMessage(localId, { status: 'delivered' });
      updateMessageStatus(localId, 'delivered');
    });

    socket.on('message:seen', ({ localIds, conversationId: cid }: { localIds: string[]; conversationId?: string }) => {
      localIds.forEach((id) => {
        updateMessage(id, { status: 'seen' });
        updateMessageStatus(id, 'seen');
      });
      if (cid) {
        const { conversations, updateConversation } = useChatStore.getState();
        const conv = conversations.find((c) => c.id === cid);
        if (conv?.lastMessage && localIds.includes(conv.lastMessage.localId)) {
          updateConversation(cid, { lastMessage: { ...conv.lastMessage, status: 'seen' } });
        }
      }
    });

    socket.on('message:react', ({ localId, userId, emoji }: { localId: string; userId: string; emoji: string }) => {
      useChatStore.getState().addReaction(localId, userId, emoji);
    });

    /* ── Calls ── */
    socket.on('call:incoming', (call: IncomingCall) => setIncomingCall(call));
    socket.on('call:ended', () => useCallStore.getState().endCall());
    socket.on('call:rejected', () => useCallStore.getState().endCall());

    /* ── Single-device enforcement ── */
    socket.on('session:replaced', () => {
      useAuthStore.getState().logout();
      toast.error('Signed in from another device. You have been logged out.', { duration: 5000 });
    });

    /* Re-join all known conversation rooms after reconnect */
    socket.on('connect', () => {
      const { conversations } = useChatStore.getState?.() ?? {};
      (conversations ?? []).forEach((c: { id: string }) => {
        socket.emit('conversation:join', { conversationId: c.id });
      });
    });

    return () => {
      socket.off('user:online');
      socket.off('user:offline');
      socket.off('typing:start');
      socket.off('typing:stop');
      socket.off('message:receive');
      socket.off('messages:pending');
      socket.off('message:delivered');
      socket.off('message:seen');
      socket.off('message:react');
      socket.off('call:incoming');
      socket.off('call:ended');
      socket.off('call:rejected');
      socket.off('session:replaced');
    };
  }, [accessToken, isAuthenticated]);

  return socketRef.current;
}

export function useTyping(conversationId: string) {
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const startTyping = useCallback(() => {
    const socket = getSocket();
    if (!socket?.connected) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing:start', { conversationId });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      socket.emit('typing:stop', { conversationId });
    }, 2000);
  }, [conversationId]);

  const stopTyping = useCallback(() => {
    const socket = getSocket();
    if (!socket?.connected) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      socket.emit('typing:stop', { conversationId });
    }
  }, [conversationId]);

  return { startTyping, stopTyping };
}
