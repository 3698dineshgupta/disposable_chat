'use client';

import { useEffect, useRef, useCallback } from 'react';
import { type Socket } from 'socket.io-client';
import { connectSocket, getSocket, disconnectSocket } from '@/lib/socket';
import { messageBus } from '@/lib/messageBus';
import { updateMessageStatus, clearAllUserData } from '@/lib/db/index';
import { useAuthStore } from '@/store/auth';
import { useChatStore, type RawIncoming } from '@/store/chat';
import { useCallStore } from '@/store/call';
import { useUIStore } from '@/store/ui';
import type { IncomingMessage, IncomingCall } from '@/types';
import toast from 'react-hot-toast';

const log = (...args: unknown[]) => console.log('[SOCKET-CLIENT]', ...args);

export function useSocketSetup() {
  const { accessToken, isAuthenticated } = useAuthStore();
  const { setUserOnline, setUserOffline, setTyping, addMessage, updateMessage, setConversations } = useChatStore();
  const { setIncomingCall } = useCallStore();
  const socketRef = useRef<Socket | null>(null);

  // Deduplicates messages that arrive on BOTH the conv room AND user room simultaneously
  const receivedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    const socket = connectSocket(accessToken);
    socketRef.current = socket;

    log('setting up event handlers, socketId=', socket.id);

    /* ── Presence ── */
    const onUserOnline = ({ userId }: { userId: string }) => {
      log(`user:online ${userId}`);
      setUserOnline(userId);
    };
    const onUserOffline = ({ userId }: { userId: string }) => {
      log(`user:offline ${userId}`);
      setUserOffline(userId);
    };
    socket.on('user:online',  onUserOnline);
    socket.on('user:offline', onUserOffline);

    /* ── Typing ── */
    const onTypingStart = ({ userId, conversationId }: { userId: string; conversationId: string }) =>
      setTyping(conversationId, userId, true);
    const onTypingStop  = ({ userId, conversationId }: { userId: string; conversationId: string }) =>
      setTyping(conversationId, userId, false);
    socket.on('typing:start', onTypingStart);
    socket.on('typing:stop',  onTypingStop);

    /* ── Message receive ── */
    const onMessageReceive = (data: IncomingMessage) => {
      log(`message:receive conv=${data.conversationId} from=${data.senderId} localId=${data.localId}`);

      // Deduplicate: same message may arrive via conv room AND user room
      if (data.localId) {
        if (receivedIdsRef.current.has(data.localId)) {
          log(`dedup skip localId=${data.localId}`);
          return;
        }
        receivedIdsRef.current.add(data.localId);
        // Prune old IDs to avoid unbounded memory growth
        if (receivedIdsRef.current.size > 500) {
          const iter = receivedIdsRef.current.values();
          for (let i = 0; i < 100; i++) {
            const { value, done } = iter.next();
            if (done) break;
            receivedIdsRef.current.delete(value);
          }
        }
      }

      messageBus.emit(data);
      useChatStore.getState().queueIncoming([{
        conversationId:   data.conversationId,
        senderId:         data.senderId,
        encryptedPayload: data.encryptedPayload,
        messageType:      data.messageType,
        localId:          data.localId,
        timestamp:        data.timestamp,
      }]);

      // Increment unread for non-active conversations
      const { activeConversationId } = useUIStore.getState();
      if (data.conversationId !== activeConversationId) {
        const { conversations, updateConversation } = useChatStore.getState();
        const conv = conversations.find(c => c.id === data.conversationId);
        updateConversation(data.conversationId, {
          unreadCount: (conv?.unreadCount ?? 0) + 1,
          updated_at:  data.timestamp,
        });
      }
    };
    socket.on('message:receive', onMessageReceive);

    /* ── Pending messages (offline delivery) ── */
    const onMessagesPending = ({ messages }: { messages: unknown[] }) => {
      log(`messages:pending count=${messages.length}`);
      const shaped: RawIncoming[] = (messages as Array<Record<string, unknown>>).map((m) => ({
        conversationId:   m.conversation_id as string,
        senderId:         m.sender_id as string,
        encryptedPayload: m.encrypted_payload as never,
        messageType:      m.message_type as string,
        localId:          m.local_id as string | undefined,
        timestamp:        m.created_at as string,
        pendingDbId:      m.id as string | undefined,
      }));
      useChatStore.getState().queueIncoming(shaped);

      const { activeConversationId } = useUIStore.getState();
      const perConv: Record<string, number> = {};
      for (const m of messages as Array<Record<string, unknown>>) {
        if (m.conversation_id !== activeConversationId) {
          perConv[m.conversation_id as string] = (perConv[m.conversation_id as string] ?? 0) + 1;
        }
      }
      if (Object.keys(perConv).length > 0) {
        useChatStore.getState().addPendingUnreads(perConv);
      }
    };
    socket.on('messages:pending', onMessagesPending);

    /* ── Delivery / seen receipts ── */
    const onMessageDelivered = ({ localId }: { localId: string }) => {
      log(`message:delivered localId=${localId}`);
      updateMessage(localId, { status: 'delivered' });
      updateMessageStatus(localId, 'delivered');
    };
    socket.on('message:delivered', onMessageDelivered);

    const onMessageSeen = ({ localIds, conversationId: cid }: { localIds: string[]; conversationId?: string }) => {
      log(`message:seen ${localIds.length} ids in conv=${cid}`);
      localIds.forEach(id => {
        updateMessage(id, { status: 'seen' });
        updateMessageStatus(id, 'seen');
      });
      if (cid) {
        const { conversations, updateConversation } = useChatStore.getState();
        const conv = conversations.find(c => c.id === cid);
        if (conv?.lastMessage && localIds.includes(conv.lastMessage.localId)) {
          updateConversation(cid, { lastMessage: { ...conv.lastMessage, status: 'seen' } });
        }
      }
    };
    socket.on('message:seen', onMessageSeen);

    const onMessageReact = ({ localId, userId, emoji }: { localId: string; userId: string; emoji: string }) => {
      useChatStore.getState().addReaction(localId, userId, emoji);
    };
    socket.on('message:react', onMessageReact);

    /* ── Calls ── */
    const onCallIncoming = (call: IncomingCall) => {
      log(`call:incoming callId=${call.callId} from=${call.callerId} type=${call.type}`);
      setIncomingCall(call);
    };
    socket.on('call:incoming', onCallIncoming);

    // Buffer ICE candidates here (in useSocket) so they are never dropped during the
    // window between call:incoming / startCall and CallScreen.setupWebRTC registering
    // its named iceHandler. CallScreen drains this buffer after registering its handler.
    const onCallIce = ({ candidate, from }: { candidate: RTCIceCandidateInit; from: string }) => {
      log(`call:ice buffering candidate from=${from}`);
      useCallStore.getState().addPendingIceCandidate(candidate);
    };
    socket.on('call:ice', onCallIce);

    const onCallEnded = ({ callId }: { callId: string }) => {
      log(`call:ended callId=${callId}`);
      useCallStore.getState().endCall();
    };
    socket.on('call:ended', onCallEnded);

    const onCallRejected = ({ callId }: { callId: string }) => {
      log(`call:rejected callId=${callId}`);
      toast('Call declined', { icon: '📵' });
      useCallStore.getState().endCall();
    };
    socket.on('call:rejected', onCallRejected);

    /* ── Single-device enforcement ── */
    const onSessionReplaced = () => {
      log('session:replaced — logging out');
      clearAllUserData().catch(() => {});
      localStorage.removeItem('zapchat-active-user');
      setConversations([]);
      useAuthStore.getState().logout();
      // Also disconnect the socket cleanly
      disconnectSocket();
      toast.error('Signed in from another device. You have been logged out.', { duration: 5000 });
    };
    socket.on('session:replaced', onSessionReplaced);

    /* ── Re-join conversation rooms after reconnect ── */
    const onConnect = () => {
      log('socket (re)connected, re-joining conversation rooms');
      const { conversations } = useChatStore.getState();
      conversations.forEach((c: { id: string }) => {
        socket.emit('conversation:join', { conversationId: c.id });
      });
    };
    socket.on('connect', onConnect);

    return () => {
      log('cleaning up socket event handlers');
      socket.off('user:online',       onUserOnline);
      socket.off('user:offline',      onUserOffline);
      socket.off('typing:start',      onTypingStart);
      socket.off('typing:stop',       onTypingStop);
      socket.off('message:receive',   onMessageReceive);
      socket.off('messages:pending',  onMessagesPending);
      socket.off('message:delivered', onMessageDelivered);
      socket.off('message:seen',      onMessageSeen);
      socket.off('message:react',     onMessageReact);
      socket.off('call:incoming',     onCallIncoming);
      socket.off('call:ice',          onCallIce);
      socket.off('call:ended',        onCallEnded);
      socket.off('call:rejected',     onCallRejected);
      socket.off('session:replaced',  onSessionReplaced);
      socket.off('connect',           onConnect);
    };
  }, [accessToken, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  return socketRef.current;
}

export function useTyping(conversationId: string) {
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef      = useRef(false);

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
