'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import { conversationsApi } from '@/lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  generateKeyPair, generateSigningKeys, exportPublicKey, exportSigningPublicKey,
  importPublicKey, importSigningPublicKey, loadKeyPair, persistKeyPair,
  clearSharedSecretCache,
} from '@/lib/crypto/index';
import { storeKey, retrieveKey } from '@/lib/db/index';
import { authApi } from '@/lib/api';
import { joinConversationRoom } from '@/lib/socket';

// Session-scoped flag: tracks whether we've uploaded our public keys to the server
// this page session. Reset on every page reload. Prevents redundant PUT /auth/keys
// calls when multiple ChatWindows open within the same session.
let _keysUploadedThisSession = false;
import { useMessages } from '@/hooks/useMessages';
import type { Conversation, LocalMessage, MessageType, ConversationParticipant } from '@/types';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import { searchMessages } from '@/lib/db/index';

interface Props {
  conversationId: string;
}

export default function ChatWindow({ conversationId }: Props) {
  const { user } = useAuthStore();
  const { setReplyingTo, replyingTo } = useChatStore();
  const queryClient = useQueryClient();
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<LocalMessage[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [cryptoCtx, setCryptoCtx] = useState<{
    myPrivateKey: CryptoKey | null;
    mySigningPrivateKey: CryptoKey | null;
    theirPublicKeyB64: string | null;
    theirSigningPublicKeyB64: string | null;
  }>({
    myPrivateKey: null,
    mySigningPrivateKey: null,
    theirPublicKeyB64: null,
    theirSigningPublicKeyB64: null,
  });

  /* Fetch conversation details — refetch every 5s if other user's key is still null */
  const missingTheirKey = conversation?.type === 'direct' && !conversation?.other_public_key;
  const { data: convData } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => conversationsApi.getById(conversationId).then((r) => ({
      conversation: r.data.conversation as Conversation,
      participants: r.data.participants as ConversationParticipant[],
    })),
    staleTime: missingTheirKey ? 0 : 15_000,
    // Poll every 5s until we have the peer's key, then every 30s to pick up key
    // rotations (e.g. peer just connected from a new device / VPN session).
    refetchInterval: missingTheirKey ? 5_000 : 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (convData) {
      const fullConv: Conversation = {
        ...convData.conversation,
        participants: convData.participants,
      };
      setConversation(fullConv);
    }
  }, [convData]);

  /* Ensure socket is in the conversation room whenever the window opens */
  useEffect(() => {
    joinConversationRoom(conversationId);
  }, [conversationId]);

  /* Also use from store (has direct user info for direct chats) */
  const storeConv = useChatStore((s) => s.conversations.find((c) => c.id === conversationId));
  useEffect(() => {
    if (storeConv) setConversation((prev) => prev ? { ...prev, ...storeConv } : storeConv);
  }, [storeConv]);

  /* Setup E2E encryption keys */
  useEffect(() => {
    if (!user || !conversation) return;
    const theirKey = conversation.type === 'direct'
      ? conversation.other_public_key
      : null; // group: use per-member keys (simplified: use first participant's key)

    const setup = async () => {
      /* Load or generate my key pair */
      let loaded = await loadKeyPair(retrieveKey);
      if (!loaded) {
        // First time: generate, persist, and upload to server
        const kp = await generateKeyPair();
        const sp = await generateSigningKeys();
        const { publicKeyRaw, signingPublicKeyRaw } = await persistKeyPair(kp, sp, storeKey);
        loaded = { keyPair: kp, signingKeyPair: sp };
        await authApi.updateKeys(publicKeyRaw, signingPublicKeyRaw);
        _keysUploadedThisSession = true;
      } else if (!_keysUploadedThisSession) {
        // Keys exist in IndexedDB but haven't been pushed to the server yet this
        // session. This covers: (a) first upload failed due to a network error,
        // (b) the user is on a new device, (c) the server DB was reset.
        // IMPORTANT: only set _keysUploadedThisSession = true AFTER the upload
        // succeeds. If we set it immediately and the upload fails, the flag
        // prevents any retry this session and recipients get decrypt failures.
        const publicKeyRaw = await exportPublicKey(loaded.keyPair.publicKey);
        const signingPublicKeyRaw = await exportSigningPublicKey(loaded.signingKeyPair.publicKey);
        try {
          await authApi.updateKeys(publicKeyRaw, signingPublicKeyRaw);
          _keysUploadedThisSession = true;
          console.log('[E2EE] key sync to server succeeded');
        } catch (err) {
          console.warn('[E2EE] key sync to server failed — will retry on next conversation open:', (err as Error)?.message);
          // _keysUploadedThisSession stays false so next open retries the upload
        }
      }

      // Clear stale shared-secret cache entries whenever the peer's key may have
      // changed (this effect re-runs when conversation.other_public_key changes).
      clearSharedSecretCache();

      setCryptoCtx({
        myPrivateKey: loaded.keyPair.privateKey,
        mySigningPrivateKey: loaded.signingKeyPair.privateKey,
        theirPublicKeyB64: theirKey ?? null,
        theirSigningPublicKeyB64: conversation.other_signing_public_key ?? null,
      });
    };

    setup().catch(console.error);
  }, [user, conversation?.id, conversation?.other_public_key]);

  // When decryption fails (key mismatch), invalidate the conversation query so
  // React Query re-fetches the latest other_public_key before the next retry.
  const onKeyMismatch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
  }, [queryClient, conversationId]);

  const { messages, isLoading, hasMore, loadMore, sendMessage } = useMessages(conversation, cryptoCtx, onKeyMismatch);

  /* Search */
  useEffect(() => {
    if (!searchText.trim()) { setSearchResults([]); return; }
    const timeout = setTimeout(async () => {
      const results = await searchMessages(conversationId, searchText);
      setSearchResults(results);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchText, conversationId]);

  const handleSend = async (text: string, type: MessageType = 'text', extra?: object) => {
    await sendMessage(text, type, extra as any);
  };

  const currentReply = replyingTo[conversationId] ?? null;
  const displayMessages = searchText ? searchResults : messages;

  if (!conversation) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgb(var(--chat-bg))' }}>
        <div style={{ width: 24, height: 24, border: '2px solid rgb(var(--brand))', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'rgb(var(--chat-bg))' }}>
      {/* Header */}
      <ChatHeader
        conversation={conversation}
        onSearchToggle={() => setShowSearch((v) => !v)}
      />

      {/* Search bar */}
      {showSearch && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 16px',
          background: 'rgb(var(--chat-header))',
          borderBottom: '1px solid rgba(var(--chat-border), 0.5)',
        }}>
          <Search size={16} color="rgb(var(--text-muted))" style={{ flexShrink: 0 }} />
          <input
            autoFocus
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search in conversation…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'rgb(var(--text-primary))', fontSize: 14, fontFamily: 'inherit',
            }}
          />
          {searchResults.length > 0 && (
            <span style={{ fontSize: 12, color: 'rgb(var(--text-muted))', whiteSpace: 'nowrap' }}>
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </span>
          )}
          <button onClick={() => { setSearchText(''); setShowSearch(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: '50%', color: 'rgb(var(--text-muted))' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Messages */}
      <MessageList
        messages={displayMessages}
        conversation={conversation}
        isLoading={isLoading}
        hasMore={hasMore && !searchText}
        onLoadMore={loadMore}
        onReply={(msg) => setReplyingTo(conversationId, msg)}
      />

      {/* Input */}
      <MessageInput
        conversationId={conversationId}
        replyingTo={currentReply}
        onClearReply={() => setReplyingTo(conversationId, null)}
        onSend={handleSend}
        disabled={!cryptoCtx.myPrivateKey || !cryptoCtx.theirPublicKeyB64}
      />
    </div>
  );
}
