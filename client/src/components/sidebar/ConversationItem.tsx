'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, CheckCheck, BellOff, Star, Archive, BellRing, PinOff } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useUIStore } from '@/store/ui';
import { useChatStore } from '@/store/chat';
import { conversationsApi } from '@/lib/api';
import type { Conversation, LocalMessage } from '@/types';
import { formatConversationTime, getConversationName, getConversationAvatar, truncate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Props { conversation: Conversation; }

function StatusIcon({ msg }: { msg: LocalMessage }) {
  if (!msg.isMine) return null;
  const cls = { color: msg.status === 'seen' ? '#53bdeb' : 'rgb(var(--text-muted))', flexShrink: 0 };
  if (msg.status === 'seen')      return <CheckCheck size={14} style={cls} />;
  if (msg.status === 'delivered') return <CheckCheck size={14} style={cls} />;
  if (msg.status === 'sent')      return <Check      size={14} style={cls} />;
  if (msg.status === 'pending')   return <Check      size={14} style={{ ...cls, opacity: 0.5 }} />;
  return null;
}

function preview(msg: LocalMessage): string {
  if (msg.deletedForEveryone) return '🚫 This message was deleted';
  if (msg.deletedForMe)       return '';
  switch (msg.type) {
    case 'image':  return '📷 Photo';
    case 'video':  return '🎬 Video';
    case 'audio':  return '🎵 Audio';
    case 'voice':  return '🎤 Voice message';
    case 'file':   return `📎 ${msg.fileName ?? 'File'}`;
    case 'sticker':return '🎭 Sticker';
    default:       return truncate(msg.text ?? '', 42);
  }
}

export default function ConversationItem({ conversation: conv }: Props) {
  const { setActiveConversation, activeConversationId } = useUIStore();
  const { onlineUsers, updateConversation } = useChatStore();
  const [hov, setHov] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isActive = activeConversationId === conv.id;
  const isOnline = conv.type === 'direct' && !!conv.other_user_id && onlineUsers.has(conv.other_user_id);
  const name     = getConversationName(conv);
  const avatar   = getConversationAvatar(conv);
  const lastMsg  = conv.lastMessage;
  const unread   = conv.unreadCount ?? 0;

  /* Close context menu on outside click */
  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const togglePin = async () => {
    const newPinned = !conv.is_pinned;
    updateConversation(conv.id, { is_pinned: newPinned });
    setContextMenu(null);
    try {
      await conversationsApi.updateSettings(conv.id, { is_pinned: newPinned });
      toast.success(newPinned ? 'Added to favorites' : 'Removed from favorites');
    } catch {
      updateConversation(conv.id, { is_pinned: !newPinned });
      toast.error('Failed to update');
    }
  };

  const toggleMute = async () => {
    const newMuted = !conv.is_muted;
    updateConversation(conv.id, { is_muted: newMuted });
    setContextMenu(null);
    try {
      await conversationsApi.updateSettings(conv.id, { is_muted: newMuted });
      toast.success(newMuted ? 'Notifications muted' : 'Notifications on');
    } catch {
      updateConversation(conv.id, { is_muted: !newMuted });
      toast.error('Failed to update');
    }
  };

  const toggleArchive = async () => {
    const newArchived = !conv.is_archived;
    updateConversation(conv.id, { is_archived: newArchived });
    setContextMenu(null);
    try {
      await conversationsApi.updateSettings(conv.id, { is_archived: newArchived });
      toast.success(newArchived ? 'Chat archived' : 'Chat unarchived');
    } catch {
      updateConversation(conv.id, { is_archived: !newArchived });
      toast.error('Failed to update');
    }
  };

  return (
    <>
      <button
        onClick={() => setActiveConversation(conv.id)}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        onContextMenu={handleContextMenu}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 16px',
          border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', position: 'relative',
          background: isActive ? 'rgba(var(--brand),0.1)' : hov ? 'rgba(var(--chat-border),0.35)' : 'transparent',
          transition: 'background 0.12s',
        }}
      >
        {isActive && <span style={{ position: 'absolute', left: 0, top: '15%', bottom: '15%', width: 3,
                                     background: '#00a884', borderRadius: '0 3px 3px 0' }} />}

        {/* Avatar */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar src={avatar} name={name} size="md"
                  isOnline={conv.type === 'direct' ? isOnline : undefined} />
          {conv.is_pinned && (
            <span style={{ position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: '50%',
                           background: 'rgb(var(--bg-elevated))', display: 'flex', alignItems: 'center', justifyContent: 'center',
                           boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
              <Star size={9} style={{ color: '#f59e0b', fill: '#f59e0b' }} />
            </span>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 14, fontWeight: unread > 0 ? 600 : 500, color: 'rgb(var(--text-primary))',
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
              {name}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {lastMsg && <StatusIcon msg={lastMsg} />}
              <span style={{ fontSize: 11, color: unread > 0 ? '#00a884' : 'rgb(var(--text-muted))', fontWeight: unread > 0 ? 600 : 400 }}>
                {formatConversationTime(conv.updated_at ?? conv.created_at)}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <p style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                        color: unread > 0 ? 'rgb(var(--text-primary))' : 'rgb(var(--text-muted))',
                        fontWeight: unread > 0 ? 500 : 400, margin: 0 }}>
              {lastMsg ? (
                <>
                  {lastMsg.isMine && conv.type === 'group' && (
                    <span style={{ color: '#00a884' }}>You: </span>
                  )}
                  {preview(lastMsg)}
                </>
              ) : (
                <span style={{ fontStyle: 'italic', color: 'rgb(var(--text-muted))' }}>Start a conversation</span>
              )}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {conv.is_muted && <BellOff size={12} style={{ color: 'rgb(var(--text-muted))' }} />}
              {unread > 0 && (
                <span style={{ minWidth: 20, height: 20, borderRadius: 10, padding: '0 5px',
                               background: conv.is_muted ? 'rgb(var(--text-muted))' : '#00a884',
                               color: 'white', fontSize: 11, fontWeight: 700,
                               display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Right-click context menu */}
      {contextMenu && (
        <div ref={menuRef} style={{
          position: 'fixed',
          left: Math.min(contextMenu.x, window.innerWidth - 200),
          top: Math.min(contextMenu.y, window.innerHeight - 160),
          zIndex: 9999,
          background: 'rgb(var(--bg-elevated))',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)',
          border: '1px solid rgba(var(--chat-border),0.5)',
          minWidth: 190,
          overflow: 'hidden',
          animation: 'ctxMenuIn 0.12s ease-out',
        }}>
          <CtxItem
            icon={conv.is_pinned ? <PinOff size={15} /> : <Star size={15} />}
            label={conv.is_pinned ? 'Remove from favorites' : 'Add to favorites'}
            color={conv.is_pinned ? undefined : '#f59e0b'}
            onClick={togglePin}
          />
          <CtxItem
            icon={conv.is_muted ? <BellRing size={15} /> : <BellOff size={15} />}
            label={conv.is_muted ? 'Unmute notifications' : 'Mute notifications'}
            onClick={toggleMute}
          />
          <CtxItem
            icon={<Archive size={15} />}
            label={conv.is_archived ? 'Unarchive chat' : 'Archive chat'}
            onClick={toggleArchive}
          />
        </div>
      )}

      <style>{`
        @keyframes ctxMenuIn {
          from { opacity: 0; transform: scale(0.92) translateY(-4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </>
  );
}

function CtxItem({ icon, label, onClick, color }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '11px 16px', border: 'none', cursor: 'pointer',
        background: hov ? 'rgba(var(--brand),0.08)' : 'transparent',
        color: color ?? 'rgb(var(--text-primary))',
        fontSize: 13.5, fontWeight: 500, fontFamily: 'inherit',
        textAlign: 'left', transition: 'background 0.1s',
      }}
    >
      <span style={{ color: color ?? 'rgb(var(--text-secondary))' }}>{icon}</span>
      {label}
    </button>
  );
}
