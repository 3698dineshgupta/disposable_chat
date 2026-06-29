'use client';

import { useState } from 'react';
import { Check, CheckCheck, Pin, BellOff } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useUIStore } from '@/store/ui';
import { useChatStore } from '@/store/chat';
import type { Conversation, LocalMessage } from '@/types';
import { formatConversationTime, getConversationName, getConversationAvatar, truncate } from '@/lib/utils';

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
  const { onlineUsers } = useChatStore();
  const [hov, setHov] = useState(false);

  const isActive = activeConversationId === conv.id;
  const isOnline = conv.type === 'direct' && !!conv.other_user_id && onlineUsers.has(conv.other_user_id);
  const name     = getConversationName(conv);
  const avatar   = getConversationAvatar(conv);
  const lastMsg  = conv.lastMessage;
  const unread   = conv.unreadCount ?? 0;

  return (
    <button
      onClick={() => setActiveConversation(conv.id)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
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
            <Pin size={9} style={{ color: 'rgb(var(--text-muted))' }} />
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
                      fontWeight: unread > 0 ? 500 : 400 }}>
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
  );
}
