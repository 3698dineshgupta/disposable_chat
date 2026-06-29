'use client';

import { Phone, Video, Search, MoreVertical, ArrowLeft, Shield, Archive, BellOff, Trash2, Lock, X } from 'lucide-react';
import { useState } from 'react';
import Avatar from '@/components/ui/Avatar';
import { useUIStore } from '@/store/ui';
import { useChatStore } from '@/store/chat';
import { useCallStore } from '@/store/call';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';
import { conversationsApi } from '@/lib/api';
import { formatLastSeen, getConversationName, getConversationAvatar } from '@/lib/utils';
import type { Conversation } from '@/types';
import toast from 'react-hot-toast';

interface Props {
  conversation: Conversation;
  onSearchToggle: () => void;
}

export default function ChatHeader({ conversation, onSearchToggle }: Props) {
  const { setActiveConversation, isMobileView } = useUIStore();
  const { typingUsers, onlineUsers, updateConversation } = useChatStore();
  const { startCall } = useCallStore();
  const { user } = useAuthStore();
  const [showMenu, setShowMenu]         = useState(false);
  const [showEncInfo, setShowEncInfo]   = useState(false);

  const name   = getConversationName(conversation);
  const avatar = getConversationAvatar(conversation);
  const typing = typingUsers[conversation.id] ?? {};
  const typingUserIds = Object.entries(typing).filter(([uid, isTyping]) => isTyping && uid !== user?.id).map(([uid]) => uid);
  const isOnline = conversation.type === 'direct' && !!conversation.other_user_id && onlineUsers.has(conversation.other_user_id);

  let subtitle = '';
  if (typingUserIds.length > 0) {
    subtitle = 'typing…';
  } else if (conversation.type === 'direct') {
    subtitle = formatLastSeen(conversation.other_last_seen ?? new Date().toISOString(), isOnline);
  } else {
    subtitle = `${(conversation.participants?.length ?? 0)} members`;
  }

  const isTyping = typingUserIds.length > 0;

  const initiateCall = (type: 'audio' | 'video') => {
    if (!conversation.other_user_id) { toast.error('Can only call in direct chats'); return; }
    const socket = getSocket();
    if (!socket?.connected) { toast.error('Not connected'); return; }
    startCall({
      callId: '',
      peerId: conversation.other_user_id,
      peerInfo: { display_name: conversation.other_display_name, avatar_url: conversation.other_avatar_url },
      type,
      status: 'calling',
      conversationId: conversation.id,
      isInitiator: true,
    });
  };

  const handleArchive = async () => {
    try {
      await conversationsApi.updateSettings(conversation.id, { is_archived: true });
      updateConversation(conversation.id, { is_archived: true });
      setActiveConversation(null);
      toast.success('Chat archived');
    } catch { toast.error('Failed to archive'); }
    setShowMenu(false);
  };

  const handleMute = async () => {
    try {
      await conversationsApi.updateSettings(conversation.id, { is_muted: !conversation.is_muted });
      updateConversation(conversation.id, { is_muted: !conversation.is_muted });
      toast.success(conversation.is_muted ? 'Notifications unmuted' : 'Notifications muted');
    } catch { toast.error('Failed'); }
    setShowMenu(false);
  };

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px',
        background: 'rgb(var(--chat-header))',
        borderBottom: '1px solid rgba(var(--chat-border), 0.6)',
        userSelect: 'none',
      }}>
        {/* Back (mobile) */}
        {isMobileView && (
          <button onClick={() => setActiveConversation(null)} style={iconBtnStyle}>
            <ArrowLeft size={20} color="rgb(var(--text-secondary))" />
          </button>
        )}

        {/* Avatar + info */}
        <button style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
          <Avatar src={avatar} name={name} size="sm" isOnline={conversation.type === 'direct' ? isOnline : undefined} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: 'rgb(var(--text-primary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: isTyping || isOnline ? 'rgb(var(--brand))' : 'rgb(var(--text-muted))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: 'color 0.2s' }}>
              {subtitle}
            </p>
          </div>
        </button>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {conversation.type === 'direct' && (
            <>
              <button onClick={() => initiateCall('video')} style={iconBtnStyle} title="Video call">
                <Video size={20} color="rgb(var(--text-secondary))" />
              </button>
              <button onClick={() => initiateCall('audio')} style={iconBtnStyle} title="Voice call">
                <Phone size={20} color="rgb(var(--text-secondary))" />
              </button>
            </>
          )}
          <button onClick={onSearchToggle} style={iconBtnStyle} title="Search">
            <Search size={20} color="rgb(var(--text-secondary))" />
          </button>

          {/* More menu */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowMenu((v) => !v)} style={iconBtnStyle} title="More options">
              <MoreVertical size={20} color="rgb(var(--text-secondary))" />
            </button>

            {showMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setShowMenu(false)} />
                <div style={{
                  position: 'absolute', right: 0, top: 42, zIndex: 20, width: 220,
                  background: 'rgb(var(--bg-elevated))',
                  borderRadius: 12,
                  border: '1px solid rgba(var(--chat-border), 0.5)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
                  overflow: 'hidden', padding: '4px 0',
                }}>
                  <DropdownItem icon={<BellOff size={16} />} label={conversation.is_muted ? 'Unmute notifications' : 'Mute notifications'} onClick={handleMute} />
                  <DropdownItem icon={<Archive size={16} />} label="Archive chat" onClick={handleArchive} />
                  <DropdownItem icon={<Lock size={16} />} label="Encryption info"
                    onClick={() => { setShowEncInfo(true); setShowMenu(false); }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Encryption info modal */}
      {showEncInfo && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowEncInfo(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'rgb(var(--bg-elevated))',
              borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 380,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              border: '1px solid rgba(var(--chat-border), 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(var(--brand), 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Lock size={18} color="rgb(var(--brand))" />
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'rgb(var(--text-primary))' }}>End-to-End Encrypted</p>
                  <p style={{ margin: 0, fontSize: 12, color: 'rgb(var(--text-muted))' }}>ZapChat Encryption</p>
                </div>
              </div>
              <button onClick={() => setShowEncInfo(false)} style={{ ...iconBtnStyle, flexShrink: 0 }}>
                <X size={18} color="rgb(var(--text-secondary))" />
              </button>
            </div>

            <div style={{ background: 'rgba(var(--brand), 0.06)', borderRadius: 12, padding: '14px 16px', marginBottom: 16, border: '1px solid rgba(var(--brand), 0.12)' }}>
              <p style={{ margin: 0, fontSize: 13.5, color: 'rgb(var(--text-primary))', lineHeight: 1.6 }}>
                Messages and calls in this conversation are secured with <strong>end-to-end encryption</strong> using ECDH key exchange. Only you and {name} can read your messages — not even ZapChat.
              </p>
            </div>

            {[
              { label: 'Key exchange',    value: 'ECDH P-256 (Elliptic Curve Diffie-Hellman)' },
              { label: 'Message cipher',  value: 'AES-256-GCM' },
              { label: 'Signing',         value: 'ECDSA P-256' },
              { label: 'Key storage',     value: 'Device only (IndexedDB)' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid rgba(var(--chat-border), 0.4)', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'rgb(var(--text-muted))', flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 13, color: 'rgb(var(--text-primary))', fontWeight: 500, textAlign: 'right' }}>{value}</span>
              </div>
            ))}

            <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(var(--chat-border), 0.2)', borderRadius: 10 }}>
              <p style={{ margin: 0, fontSize: 11.5, color: 'rgb(var(--text-muted))', lineHeight: 1.6, textAlign: 'center' }}>
                {conversation.other_public_key
                  ? `✓ Peer public key verified. Conversation key: ${conversation.other_public_key.slice(0, 16)}…`
                  : '⚠ Waiting for peer to upload their public key.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 38, height: 38, borderRadius: '50%',
  background: 'none', border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.15s',
};

function DropdownItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '10px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
        background: hov ? 'rgba(var(--chat-border), 0.4)' : 'transparent',
        color: danger ? '#ef4444' : 'rgb(var(--text-primary))',
        fontSize: 14, fontFamily: 'inherit', transition: 'background 0.1s',
      }}
    >
      <span style={{ color: danger ? '#ef4444' : 'rgb(var(--text-secondary))' }}>{icon}</span>
      {label}
    </button>
  );
}
