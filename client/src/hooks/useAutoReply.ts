'use client';

/**
 * useAutoReply — AI Auto-Reply orchestration hook.
 *
 * Runs in the main layout (always mounted). For every incoming message in an
 * AI-enabled conversation:
 *  1. Independently decrypts the message (same keys, no dependency on ChatWindow).
 *  2. Waits for useMessages to also save it to IndexedDB (context).
 *  3. Shows a typing indicator for a human-like duration.
 *  4. Calls the backend /api/ai/generate endpoint (plaintext, never raw keys).
 *  5. Encrypts the reply and sends via the normal socket flow.
 *
 * Privacy: When AI is enabled, message content is sent to the backend for
 * AI processing. This breaks E2EE for the affected conversation — the user
 * consents via the enable modal in ChatHeader.
 */

import { useEffect, useRef, useCallback } from 'react';
import { messageBus } from '@/lib/messageBus';
import { getSocket } from '@/lib/socket';
import { useAIStore } from '@/store/ai';
import { useChatStore } from '@/store/chat';
import { useAuthStore } from '@/store/auth';
import { aiApi } from '@/lib/api';
import { getMessages } from '@/lib/db/index';
import {
  loadKeyPair,
  getOrDeriveSharedSecret,
  encryptMessage,
  decryptMessage,
  signData,
  exportSigningPublicKey,
  exportPublicKey,
} from '@/lib/crypto/index';
import { retrieveKey } from '@/lib/db/index';
import type { IncomingMessage } from '@/types';

const MIN_PRE_TYPING_MS  = 600;
const MS_PER_CHAR        = 38;
const MAX_TYPING_MS      = 8500;
const IDBWRITE_DELAY_MS  = 400; // wait for useMessages to save to IndexedDB first

export function useAutoReply() {
  const { autoReplyEnabled, isGenerating, setGenerating, aiAvailable, setAIAvailable } = useAIStore();
  const { conversations } = useChatStore();
  const { user } = useAuthStore();

  const inFlightRef = useRef<Set<string>>(new Set());
  const keysRef     = useRef<{ keyPair: CryptoKeyPair; signingKeyPair: CryptoKeyPair } | null>(null);

  const loadKeys = useCallback(async () => {
    if (keysRef.current) return keysRef.current;
    const loaded = await loadKeyPair(retrieveKey);
    keysRef.current = loaded;
    return loaded;
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsub = messageBus.on(async (raw: unknown) => {
      const data = raw as IncomingMessage;
      if (!data?.conversationId || !data?.encryptedPayload) return;

      const { conversationId, senderId } = data;

      // Never reply to own messages
      if (senderId === user.id) return;

      // Check AI is enabled
      if (!autoReplyEnabled[conversationId]) return;
      if (!aiAvailable) return;

      // Deduplicate
      const key = `${conversationId}:${data.localId ?? data.timestamp}`;
      if (inFlightRef.current.has(key)) return;
      inFlightRef.current.add(key);

      // Don't stack: if already generating for this conv, skip
      if (isGenerating[conversationId]) {
        inFlightRef.current.delete(key);
        return;
      }

      setGenerating(conversationId, true);

      try {
        await runAutoReply({
          data,
          conversationId,
          senderId,
          userId: user.id,
          conversations,
          loadKeys,
          setAIAvailable,
        });
      } catch (err) {
        console.error('[useAutoReply]', err);
      } finally {
        setGenerating(conversationId, false);
        inFlightRef.current.delete(key);
      }
    });

    return () => { unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, autoReplyEnabled, aiAvailable]);
}

/* ── Core auto-reply logic (extracted so the effect stays clean) ── */
async function runAutoReply({
  data,
  conversationId,
  senderId,
  userId,
  conversations,
  loadKeys,
  setAIAvailable,
}: {
  data: IncomingMessage;
  conversationId: string;
  senderId: string;
  userId: string;
  conversations: any[];
  loadKeys: () => Promise<{ keyPair: CryptoKeyPair; signingKeyPair: CryptoKeyPair } | null>;
  setAIAvailable: (v: boolean) => void;
}) {
  const socket = getSocket();
  const conv   = conversations.find((c) => c.id === conversationId);
  if (!conv?.other_public_key) return;

  // Load user's private keys
  const keys = await loadKeys();
  if (!keys) return;

  // Step 1: Decrypt the incoming message to get plaintext
  let incomingText = '';
  try {
    const sharedSecret = await getOrDeriveSharedSecret(keys.keyPair.privateKey, conv.other_public_key);
    const { ciphertext, iv } = data.encryptedPayload;
    incomingText = await decryptMessage(sharedSecret, ciphertext, iv);
  } catch {
    // Decryption failed (wrong keys, or non-text type) — skip AI for this message
    return;
  }

  // Only auto-reply to text messages
  if (!incomingText || data.encryptedPayload?.messageType === 'voice') return;

  // Step 2: Small pre-typing delay (feels more natural + lets IndexedDB settle)
  await sleep(MIN_PRE_TYPING_MS + Math.random() * 800);

  // Step 3: Start typing indicator
  if (socket?.connected) socket.emit('typing:start', { conversationId });

  // Step 4: Load recent history from IndexedDB for AI context
  // Wait briefly so useMessages has time to save the decrypted incoming msg
  await sleep(IDBWRITE_DELAY_MS);
  const dbMessages = await getMessages(conversationId, 40);

  const recentMessages = dbMessages
    .filter((m) => !m.deletedForEveryone && !m.deletedForMe && m.type === 'text' && m.text)
    .map((m) => ({
      role: (m.senderId === userId ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.text!.slice(0, 800),
    }));

  // Step 5: Call backend AI endpoint
  let aiReply: string = '';
  try {
    const resp = await aiApi.generate({
      conversationId,
      incomingMessage: incomingText,
      recentMessages,
    });
    aiReply = resp.data.reply?.trim() ?? '';
    if (!aiReply) throw new Error('Empty reply from AI');
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 503 || status === 429) {
      setAIAvailable(false);
      setTimeout(() => setAIAvailable(true), 120_000);
    }
    if (socket?.connected) socket.emit('typing:stop', { conversationId });
    return;
  }

  // Step 6: Simulate typing time proportional to reply length
  const typingMs = Math.min(MAX_TYPING_MS, aiReply.length * MS_PER_CHAR + Math.random() * 1500);
  await sleep(typingMs);

  // Step 7: Stop typing
  if (socket?.connected) socket.emit('typing:stop', { conversationId });

  // Step 8: Encrypt the AI reply with E2EE
  const sharedSecret = await getOrDeriveSharedSecret(keys.keyPair.privateKey, conv.other_public_key);
  const { ciphertext, iv } = await encryptMessage(sharedSecret, aiReply);

  const encoder = new TextEncoder();
  const sigBuf  = await signData(keys.signingKeyPair.privateKey, encoder.encode(ciphertext + iv).buffer as ArrayBuffer);

  const [sigPubB64, encPubB64] = await Promise.all([
    exportSigningPublicKey(keys.signingKeyPair.publicKey),
    exportPublicKey(keys.keyPair.publicKey),
  ]);

  const localId = crypto.randomUUID();
  const encryptedPayload = {
    ciphertext,
    iv,
    signature: sigBuf,
    signingPublicKey: sigPubB64,
    senderPublicKey: encPubB64,
    messageType: 'text',
  };

  // Step 9: Send through normal socket message:send
  if (socket?.connected) {
    socket.emit('message:send', {
      conversationId,
      recipientId: conv.other_user_id,
      encryptedPayload,
      messageType: 'text',
      localId,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
