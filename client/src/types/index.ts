/* ============================================================
 * Core domain types for ZapChat
 * ============================================================ */

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  about: string;
  phone?: string | null;
  last_seen: string;
  is_online: boolean;
  public_key?: string | null;
  signing_public_key?: string | null;
  created_at?: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name?: string | null;
  avatar_url?: string | null;
  description?: string | null;
  created_by?: string | null;
  invite_link?: string | null;
  created_at: string;
  updated_at: string;

  /* participant settings */
  is_pinned?: boolean;
  is_archived?: boolean;
  is_muted?: boolean;
  last_read_at?: string;

  /* direct chat: other user info (joined from DB) */
  other_user_id?: string;
  other_username?: string;
  other_display_name?: string;
  other_avatar_url?: string | null;
  other_is_online?: boolean;
  other_last_seen?: string;
  other_about?: string;
  other_public_key?: string | null;
  other_signing_public_key?: string | null;

  /* computed on client */
  lastMessage?: LocalMessage | null;
  unreadCount?: number;
  participants?: ConversationParticipant[];
}

export interface ConversationParticipant {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
  last_seen: string;
  public_key?: string | null;
  signing_public_key?: string | null;
  role?: 'admin' | 'member';
  joined_at?: string;
}

/* ── Messages (stored locally in IndexedDB) ── */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'seen' | 'failed';
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'voice' | 'file' | 'location' | 'reply' | 'sticker' | 'system';

export interface MessageReaction {
  emoji: string;
  userId: string;
}

export interface LocalMessage {
  localId: string;          // client-generated UUID
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderAvatar?: string | null;
  type: MessageType;
  text?: string;
  mediaUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  fileMime?: string | null;
  duration?: number | null; // audio/video duration in seconds
  replyTo?: string | null;  // localId of replied message
  reactions: MessageReaction[];
  status: MessageStatus;
  timestamp: string;        // ISO string
  editedAt?: string | null;
  deletedForMe?: boolean;
  deletedForEveryone?: boolean;
  isForwarded?: boolean;
  isStarred?: boolean;
  /* Group: sender info */
  isMine: boolean;
}

/* ── Encrypted payload transmitted via socket ── */
export interface EncryptedPayload {
  ciphertext: string;   // base64
  iv: string;           // base64
  signature?: string;   // base64 (ECDSA)
  signingPublicKey?: string;
  senderPublicKey?: string;
  messageType?: MessageType;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    fileMime?: string;
    duration?: number;
    replyTo?: string;
    isForwarded?: boolean;
  };
}

/* ── Call types ── */
export type CallType = 'audio' | 'video';
export type CallStatus = 'calling' | 'ringing' | 'answered' | 'rejected' | 'missed' | 'ended' | 'failed';

export interface Call {
  id: string;
  caller_id: string;
  callee_id: string;
  caller_name?: string;
  caller_avatar?: string | null;
  callee_name?: string;
  callee_avatar?: string | null;
  type: CallType;
  status: CallStatus;
  started_at: string;
  answered_at?: string | null;
  ended_at?: string | null;
  duration: number;
  conversation_id?: string | null;
}

export interface ActiveCall {
  callId: string;
  peerId: string;
  peerInfo?: Partial<User>;
  type: CallType;
  status: CallStatus;
  startedAt: number;
  isMuted: boolean;
  isCameraOn: boolean;
  isSpeakerOn: boolean;
  isScreenSharing: boolean;
  localStream?: MediaStream | null;
  remoteStream?: MediaStream | null;
  incomingOffer?: RTCSessionDescriptionInit;
  conversationId?: string;
  isInitiator?: boolean;
}

/* ── Status ── */
export interface Status {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  type: 'text' | 'image' | 'video';
  content?: string | null;
  media_url?: string | null;
  background_color: string;
  font_style: string;
  expires_at: string;
  view_count: number;
  viewed: boolean;
  created_at: string;
}

/* ── Crypto key material ── */
export interface KeyPair {
  privateKey: CryptoKey;
  publicKeyRaw: string;   // base64
}

export interface SigningKeyPair {
  privateKey: CryptoKey;
  publicKeyRaw: string;   // base64
}

/* ── Incoming socket events ── */
export interface IncomingMessage {
  conversationId: string;
  senderId: string;
  encryptedPayload: EncryptedPayload;
  messageType: MessageType;
  localId?: string;
  timestamp: string;
}

export interface IncomingCall {
  callId: string;
  callerId: string;
  callerInfo: Partial<User>;
  type: CallType;
  conversationId?: string;
  offer: RTCSessionDescriptionInit;
}

/* ── AI Auto-Reply ── */
export interface WritingStyleProfile {
  tone?: string;
  avg_message_length?: number;
  uses_emoji?: boolean;
  emoji_frequency?: string;
  capitalization?: string;
  uses_slang?: boolean;
  common_phrases?: string[];
  sample_messages?: string[];
  language_notes?: string;
  analyzed_count?: number;
}

export interface AIConversationSettings {
  auto_reply_enabled: boolean;
}

/* ── API responses ── */
export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface PaginatedMessages {
  messages: LocalMessage[];
  hasMore: boolean;
  nextCursor?: string;
}
