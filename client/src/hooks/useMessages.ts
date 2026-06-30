'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
const uuidv4 = () => crypto.randomUUID();
import { getSocket } from '@/lib/socket';
import { messageBus } from '@/lib/messageBus';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import {
  saveMessage, getMessages, updateMessageStatus, saveConversation,
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

export function useMessages(
  conversation: Conversation | null,
  cryptoCtx: CryptoContext,
  onKeyMismatch?: () => void,
) {
  const { user } = useAuthStore();
  const { addMessage, updateMessage, setMessages, messages } = useChatStore();
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const processingRef = useRef(new Set<string>());
  const conversationId = conversation?.id;
  // Ref keeps conversation accessible inside callbacks without causing re-renders
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  const conversationMessages = conversationId ? (messages[conversationId] ?? []) : [];

  /* ── Mark all unread messages in this conversation as seen ── */
  const markAllSeenInConv = useCallback(async () => {
    if (!conversationId || !user) return;
    const now = new Date().toISOString();
    const socket = getSocket();

    // Always stamp last_read_at in the store + IndexedDB immediately on open.
    // This is the root fix for "old messages shown as unread on next load" —
    // previously, when unseen === 0, we returned early without persisting the
    // updated timestamp, so IndexedDB kept the stale time and getUnreadCount
    // re-counted the same messages as unread on every page refresh.
    useChatStore.getState().updateConversation(conversationId, { unreadCount: 0, last_read_at: now });
    useChatStore.getState().clearPendingUnread(conversationId);

    // Persist the updated last_read_at to IndexedDB so it survives refresh
    const updatedConv = useChatStore.getState().conversations.find((c) => c.id === conversationId);
    if (updatedConv) {
      try { await saveConversation({ ...updatedConv, last_read_at: now, unreadCount: 0 }); } catch { /* non-fatal */ }
    }

    // Also update last_read_at in the server DB so other devices see the read state.
    // Use conversationRef to avoid making this callback dependent on the conversation prop
    // (which would cause an infinite re-render loop via updateConversation → storeConv change).
    if (conversationRef.current?.other_user_id && socket?.connected) {
      socket.emit('message:seen', { conversationId, localIds: [], senderId: conversationRef.current.other_user_id });
    }

    const msgs = useChatStore.getState().messages[conversationId] ?? [];
    const unseen = msgs.filter((m) => !m.isMine && m.status !== 'seen');
    if (unseen.length === 0) return;

    // Group by sender so we emit one event per sender
    const bySender: Record<string, string[]> = {};
    for (const m of unseen) {
      if (!bySender[m.senderId]) bySender[m.senderId] = [];
      bySender[m.senderId].push(m.localId);
    }
    for (const senderId of Object.keys(bySender)) {
      socket?.emit('message:seen', { conversationId, localIds: bySender[senderId], senderId });
    }
    // Persist seen status to IndexedDB and update store
    for (const m of unseen) {
      await updateMessageStatus(m.localId, 'seen');
      updateMessage(m.localId, { status: 'seen' });
    }
  }, [conversationId, user, updateMessage]); // conversation intentionally omitted — accessed via conversationRef

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
      // Show a brief diagnostic toast so we can distinguish "message arrived but
      // couldn't decrypt" from "message never arrived". Shown only in dev or when
      // explicitly needed; won't spam the user because it fires once per message.
      import('react-hot-toast').then(({ default: toast }) => {
        toast('Message received but could not decrypt — refreshing keys…', {
          id: 'decrypt-fail', // deduplicate: only one toast visible at a time
          icon: '🔑',
          duration: 4000,
        });
      }).catch(() => {});
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
        // NOTE: do NOT add to processingRef yet — only mark it after decryption
        // succeeds. If decryption returns null (keys not ready), the message stays
        // unprocessed so the queue can retry it once cryptoCtx is fully loaded.

        const decrypted = await decryptPayload(data.encryptedPayload, data.senderId);
        if (!decrypted) return; // keys not ready — will be retried from queue

        // Re-check after the async gap: the queue processor may have already
        // handled this message while we were awaiting decryption.
        if (data.localId && processingRef.current.has(data.localId)) return;
        if (data.localId) processingRef.current.add(data.localId);

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
  // React to queue changes so messages that failed to decrypt via messageBus (race with
  // crypto context loading) are retried as soon as they land in the queue.
  const rawQueueLength = useChatStore((s) => (s.rawIncoming[conversationId ?? ''] ?? []).length);

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
      const retryMessages: (typeof queued[number])[] = [];

      for (const m of queued) {
        if (m.senderId === user.id) {
          // Own messages echoed back (e.g. pending_messages): just ack
          if (m.pendingDbId) idsToAck.push(m.pendingDbId);
          continue;
        }
        if (m.localId && processingRef.current.has(m.localId)) {
          // Already processed: ack and skip
          if (m.pendingDbId) idsToAck.push(m.pendingDbId);
          continue;
        }

        const decrypted = await decryptPayload(m.encryptedPayload, m.senderId);
        if (!decrypted) {
          // Decryption failed — the sender's key may have just rotated.
          // Re-queue (max 3 retries) and trigger a conversation refetch
          // to pick up the latest other_public_key before the next attempt.
          const retries = m.retryCount ?? 0;
          if (retries < 3) {
            retryMessages.push({ ...m, retryCount: retries + 1 });
          } else {
            // Give up after 3 retries — ack to clean up the DB row
            if (m.pendingDbId) idsToAck.push(m.pendingDbId);
            console.warn('[decrypt] giving up after 3 retries, localId=', m.localId);
          }
          continue;
        }

        if (m.pendingDbId) idsToAck.push(m.pendingDbId);
        // Re-check after async gap before marking (messageBus may have raced us)
        if (m.localId && processingRef.current.has(m.localId)) continue;
        if (m.localId) processingRef.current.add(m.localId);

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

      // Re-queue messages that failed to decrypt — but delay so the conversation
      // refetch (triggered by onKeyMismatch) has time to return the new
      // other_public_key before we attempt decryption again.
      if (retryMessages.length > 0) {
        onKeyMismatch?.(); // invalidates conversation query → fresh other_public_key
        // 3 s delay: gives the conversation refetch time to return a new key
        // even on slow mobile connections before we attempt decryption again.
        setTimeout(() => {
          useChatStore.getState().queueIncoming(retryMessages);
        }, 3000);
      }

      await markAllSeenInConv();
    };

    processQueue().catch(console.error);
  // rawQueueLength is intentionally included: re-run whenever new items arrive so
  // messages that failed messageBus decryption (crypto context race) are retried.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isLoading, rawQueueLength, cryptoCtx.myPrivateKey, cryptoCtx.theirPublicKeyB64]);

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
