'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
const uuidv4 = () => crypto.randomUUID();
import { getSocket } from '@/lib/socket';
import { messageBus } from '@/lib/messageBus';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import {
  saveMessage, getMessages, updateMessageStatus,
  deleteMessageForMe, deleteMessageForEveryone,
  updateMessageReaction, enqueueMessage, getPendingQueue, dequeueMessage,
} from '@/lib/db/index';
import {
  encryptMessage, decryptMessage, signData, verifySignature,
  importSigningPublicKey, getOrDeriveSharedSecret,
} from '@/lib/crypto';
import type { LocalMessage, MessageType, EncryptedPayload, Conversation } from '@/types';
import { conversationsApi } from '@/lib/api';

const b64toBuf = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;

interface CryptoContext {
  myPrivateKey: CryptoKey | null;
  mySigningPrivateKey: CryptoKey | null;
  theirPublicKeyB64: string | null;
  theirSigningPublicKeyB64: string | null;
}

export function useMessages(conversation: Conversation | null, cryptoCtx: CryptoContext) {
  const { user } = useAuthStore();
  const { addMessage, updateMessage, setMessages, messages } = useChatStore();
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const processingRef = useRef(new Set<string>());
  const conversationId = conversation?.id;

  const conversationMessages = conversationId ? (messages[conversationId] ?? []) : [];

  /* ── Mark all unread messages in this conversation as seen ── */
  const markAllSeenInConv = useCallback(async () => {
    if (!conversationId || !user) return;
    const msgs = useChatStore.getState().messages[conversationId] ?? [];
    const unseen = msgs.filter((m) => !m.isMine && m.status !== 'seen');
    if (unseen.length === 0) {
      useChatStore.getState().updateConversation(conversationId, { unreadCount: 0 });
      useChatStore.getState().clearPendingUnread(conversationId);
      return;
    }
    const socket = getSocket();
    // Group by sender so we emit one event per sender
    const bySender: Record<string, string[]> = {};
    for (const m of unseen) {
      if (!bySender[m.senderId]) bySender[m.senderId] = [];
      bySender[m.senderId].push(m.localId);
    }
    for (const senderId of Object.keys(bySender)) {
      socket?.emit('message:seen', { conversationId, localIds: bySender[senderId], senderId });
    }
    // Persist to IndexedDB and update store
    for (const m of unseen) {
      await updateMessageStatus(m.localId, 'seen');
      updateMessage(m.localId, { status: 'seen' });
    }
    // Reset unread count and refresh last_read_at
    useChatStore.getState().updateConversation(conversationId, {
      unreadCount: 0,
      last_read_at: new Date().toISOString(),
    });
    useChatStore.getState().clearPendingUnread(conversationId);
  }, [conversationId, user, updateMessage]);

  /* ── Load messages from IndexedDB ── */
  const loadMessages = useCallback(async (before?: string) => {
    if (!conversationId) return;
    setIsLoading(true);
    try {
      const loaded = await getMessages(conversationId, 50, before);
      if (!before) {
        setMessages(conversationId, loaded);
      } else {
        useChatStore.getState().prependMessages(conversationId, loaded);
      }
      setHasMore(loaded.length === 50);
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (conversationId) loadMessages();
  }, [conversationId, loadMessages]);

  /* Mark all existing messages as seen whenever conversation opens or finishes loading */
  useEffect(() => {
    if (!conversationId || isLoading) return;
    markAllSeenInConv();
  }, [conversationId, isLoading, markAllSeenInConv]);

  /* ── Decrypt helper ── */
  const decryptPayload = useCallback(async (
    payload: EncryptedPayload,
    senderId: string
  ): Promise<string | null> => {
    if (!cryptoCtx.myPrivateKey || !cryptoCtx.theirPublicKeyB64) return null;
    if (!payload?.ciphertext || !payload?.iv) return null;
    try {
      const sharedSecret = await getOrDeriveSharedSecret(cryptoCtx.myPrivateKey, cryptoCtx.theirPublicKeyB64);

      if (payload.signature && cryptoCtx.theirSigningPublicKeyB64) {
        const signingKey = await importSigningPublicKey(cryptoCtx.theirSigningPublicKeyB64);
        const valid = await verifySignature(signingKey, payload.signature, b64toBuf(payload.ciphertext));
        if (!valid) console.warn('[E2EE] Signature verification failed for', senderId);
      }

      return await decryptMessage(sharedSecret, payload.ciphertext, payload.iv);
    } catch (err) {
      console.warn('[decrypt failed — key mismatch or corrupted payload]', (err as Error)?.message ?? err);
      return null;
    }
  }, [cryptoCtx]);

  /* ── Listen for incoming messages via messageBus ── */
  useEffect(() => {
    if (!conversationId || !user) return;

    const handler = async (data: {
      conversationId: string;
      senderId: string;
      encryptedPayload: EncryptedPayload;
      messageType: MessageType;
      localId?: string;
      timestamp: string;
    }) => {
      try {
        if (data.conversationId !== conversationId) return;
        if (data.senderId === user.id) return;
        if (data.localId && processingRef.current.has(data.localId)) return;
        if (data.localId) processingRef.current.add(data.localId);

        const decrypted = await decryptPayload(data.encryptedPayload, data.senderId);
        // Skip undeliverable messages (null means keys missing or mismatch)
        if (!decrypted) return;

        const isMedia = data.messageType !== 'text' && data.messageType !== 'system';
        const localId = data.localId ?? uuidv4();
        const msg: LocalMessage = {
          localId,
          conversationId,
          senderId: data.senderId,
          type: data.messageType,
          text:     isMedia ? undefined : decrypted,
          mediaUrl: isMedia ? decrypted : null,
          reactions: [],
          status: 'delivered',
          timestamp: data.timestamp,
          isMine: false,
          replyTo:   data.encryptedPayload?.metadata?.replyTo   ?? null,
          fileName:  data.encryptedPayload?.metadata?.fileName  ?? null,
          fileSize:  data.encryptedPayload?.metadata?.fileSize  ?? null,
          fileMime:  data.encryptedPayload?.metadata?.fileMime  ?? null,
          duration:  data.encryptedPayload?.metadata?.duration  ?? null,
        };

        addMessage(msg);
        await saveMessage(msg);

        const sock = getSocket();
        sock?.emit('message:seen', { conversationId, localIds: [localId], senderId: data.senderId });
        await updateMessageStatus(localId, 'seen');
        updateMessage(localId, { status: 'seen' });
        useChatStore.getState().updateConversation(conversationId, {
          unreadCount: 0,
          last_read_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[message handler error]', err);
      }
    };

    const unsub = messageBus.on((raw) => { handler(raw as Parameters<typeof handler>[0]).catch(console.error); });
    return unsub;
  }, [conversationId, user, decryptPayload, addMessage, updateMessage]);

  /* ── Process queued incoming messages (received while this ChatWindow was not open) ── */
  useEffect(() => {
    if (!conversationId || !user || isLoading) return;
    if (!cryptoCtx.myPrivateKey || !cryptoCtx.theirPublicKeyB64) return;

    const queued = useChatStore.getState().rawIncoming[conversationId] ?? [];
    if (queued.length === 0) return;

    // Clear queue immediately to prevent re-processing on next render
    useChatStore.getState().clearIncoming(conversationId);

    const processQueue = async () => {
      const socket = getSocket();
      const idsToAck: string[] = [];

      for (const m of queued) {
        // Always acknowledge the DB row — even if we can't decrypt, clean it up
        if (m.pendingDbId) idsToAck.push(m.pendingDbId);

        if (m.senderId === user.id) continue;
        if (m.localId && processingRef.current.has(m.localId)) continue;
        if (m.localId) processingRef.current.add(m.localId);

        const decrypted = await decryptPayload(m.encryptedPayload, m.senderId);
        // Skip messages that can't be decrypted (key mismatch from old session)
        if (!decrypted) continue;

        const isMedia = m.messageType !== 'text' && m.messageType !== 'system';
        const localId = m.localId ?? uuidv4();
        const msg: LocalMessage = {
          localId,
          conversationId,
          senderId: m.senderId,
          type: m.messageType as MessageType,
          text:     isMedia ? undefined : decrypted,
          mediaUrl: isMedia ? decrypted : null,
          reactions: [],
          status: 'delivered',
          timestamp: m.timestamp,
          isMine: false,
          replyTo:   m.encryptedPayload?.metadata?.replyTo   ?? null,
          fileName:  m.encryptedPayload?.metadata?.fileName  ?? null,
          fileSize:  m.encryptedPayload?.metadata?.fileSize  ?? null,
          fileMime:  m.encryptedPayload?.metadata?.fileMime  ?? null,
          duration:  m.encryptedPayload?.metadata?.duration  ?? null,
        };

        addMessage(msg);
        await saveMessage(msg);
      }

      if (idsToAck.length > 0) {
        socket?.emit('messages:acknowledge', { messageIds: idsToAck });
      }

      await markAllSeenInConv();
    };

    processQueue().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isLoading, cryptoCtx.myPrivateKey, cryptoCtx.theirPublicKeyB64]);

  /* ── Send message ── */
  const sendMessage = useCallback(async (
    text: string,
    type: MessageType = 'text',
    extra?: {
      mediaUrl?: string;
      storagePath?: string | null;
      fileName?: string;
      fileSize?: number;
      fileMime?: string;
      duration?: number;
      replyTo?: string;
    }
  ): Promise<void> => {
    if (!conversationId || !user) return;
    if (!cryptoCtx.myPrivateKey || !cryptoCtx.theirPublicKeyB64) {
      const { default: toast } = await import('react-hot-toast');
      toast.error(
        !cryptoCtx.myPrivateKey
          ? 'Your encryption keys are not ready. Please refresh the page.'
          : 'The other user has not set up encryption keys yet. Ask them to open the app.',
        { duration: 5000 }
      );
      return;
    }

    const localId = uuidv4();
    const timestamp = new Date().toISOString();

    const msg: LocalMessage = {
      localId,
      conversationId,
      senderId: user.id,
      type,
      text: type === 'text' ? text : undefined,
      mediaUrl: extra?.mediaUrl ?? null,
      fileName: extra?.fileName ?? null,
      fileSize: extra?.fileSize ?? null,
      fileMime: extra?.fileMime ?? null,
      duration: extra?.duration ?? null,
      replyTo: extra?.replyTo ?? null,
      reactions: [],
      status: 'pending',
      timestamp,
      isMine: true,
    };

    addMessage(msg);
    await saveMessage(msg);

    try {
      const sharedSecret = await getOrDeriveSharedSecret(cryptoCtx.myPrivateKey, cryptoCtx.theirPublicKeyB64);
      // For media messages, encrypt the mediaUrl so the receiver knows where to fetch the file.
      // For text messages, encrypt the text content as usual.
      const contentToEncrypt = type === 'text' ? text : (extra?.mediaUrl ?? text ?? '');
      const { ciphertext, iv } = await encryptMessage(sharedSecret, contentToEncrypt);

      let signature: string | undefined;
      if (cryptoCtx.mySigningPrivateKey) {
        signature = await signData(cryptoCtx.mySigningPrivateKey, b64toBuf(ciphertext));
      }

      const payload: EncryptedPayload = {
        ciphertext, iv, signature,
        metadata: {
          fileName: extra?.fileName,
          fileSize: extra?.fileSize,
          fileMime: extra?.fileMime,
          duration: extra?.duration,
          replyTo: extra?.replyTo,
        },
      };

      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('message:send', {
          conversationId,
          recipientId: conversation?.other_user_id,
          encryptedPayload: payload,
          messageType: type,
          localId,
          storagePath: extra?.storagePath ?? null,
        }, (res: { success?: boolean; error?: string }) => {
          if (res.success) {
            updateMessage(localId, { status: 'sent' });
            updateMessageStatus(localId, 'sent');
          } else {
            updateMessage(localId, { status: 'failed' });
            updateMessageStatus(localId, 'failed');
          }
        });
      } else {
        await enqueueMessage(localId, conversationId, JSON.stringify(payload));
        updateMessage(localId, { status: 'pending' });
      }
    } catch (err) {
      console.error('[sendMessage error]', err);
      updateMessage(localId, { status: 'failed' });
      updateMessageStatus(localId, 'failed');
    }
  }, [conversationId, user, conversation, cryptoCtx, addMessage, updateMessage]);

  /* ── Flush offline queue ── */
  const flushOfflineQueue = useCallback(async () => {
    const socket = getSocket();
    if (!socket?.connected) return;
    const queue = await getPendingQueue();
    for (const item of queue) {
      const payload = JSON.parse(item.payload) as EncryptedPayload;
      socket.emit('message:send', {
        conversationId: item.conversationId,
        encryptedPayload: payload,
        localId: item.id,
      }, async (res: { success?: boolean }) => {
        if (res.success) {
          await dequeueMessage(item.id);
          updateMessage(item.id, { status: 'sent' });
        }
      });
    }
  }, [updateMessage]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('connect', flushOfflineQueue);
    return () => { socket.off('connect', flushOfflineQueue); };
  }, [flushOfflineQueue]);

  return {
    messages: conversationMessages,
    isLoading,
    hasMore,
    loadMore: () => {
      const first = conversationMessages[0];
      if (first) loadMessages(first.timestamp);
    },
    sendMessage,
  };
}
