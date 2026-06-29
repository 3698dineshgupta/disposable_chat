'use client';

import { useEffect, useRef, useCallback } from 'react';
import { type Socket } from 'socket.io-client';
import { connectSocket, getSocket } from '@/lib/socket';
import { messageBus } from '@/lib/messageBus';
import { updateMessageStatus } from '@/lib/db/index';
import { useAuthStore } from '@/store/auth';
import { useChatStore, type RawIncoming } from '@/store/chat';
import { useCallStore } from '@/store/call';
import type { IncomingMessage, IncomingCall } from '@/types';

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
      messageBus.emit(data); // real-time delivery for active ChatWindow
      // Also queue so ChatWindow picks it up even if it wasn't open yet
      useChatStore.getState().queueIncoming([{
        conversationId: data.conversationId,
        senderId: data.senderId,
        encryptedPayload: data.encryptedPayload,
        messageType: data.messageType,
        localId: data.localId,
        timestamp: data.timestamp,
      }]);
    });

    /* Queue pending messages (offline delivery) so any ChatWindow can pick them up */
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
      // Also update lastMessage in the conversation so the tick in ConversationItem refreshes
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

    /* Join room for any new conversation that gets added to the store while connected */
    const joinNewConvRooms = () => {
      const convIds: string[] = []; // placeholder — handled below
    };
    // Whenever a conversation:join is needed (called externally via getSocket().emit)
    socket.on('connect', () => {
      // Re-join all known conversation rooms after reconnect
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
      socket.off('message:delivered');
      socket.off('message:seen');
      socket.off('message:react');
      socket.off('call:incoming');
      socket.off('call:ended');
      socket.off('call:rejected');
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
