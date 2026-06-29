'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useInView } from 'react-intersection-observer';
import { format, isToday, isYesterday, parseISO, isSameDay } from 'date-fns';
import type { LocalMessage, Conversation } from '@/types';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import { deleteMessageForMe, deleteMessageForEveryone, updateMessageReaction } from '@/lib/db';
import { getSocket } from '@/lib/socket';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

interface Props {
  messages: LocalMessage[];
  conversation: Conversation;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onReply: (msg: LocalMessage) => void;
}

function DateSeparator({ date }: { date: Date }) {
  let label: string;
  if (isToday(date)) label = 'TODAY';
  else if (isYesterday(date)) label = 'YESTERDAY';
  else label = format(date, 'MMMM d, yyyy').toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '12px 0 8px' }}>
      <div style={{
        background: 'rgb(var(--bg-elevated))',
        color: 'rgb(var(--text-secondary))',
        fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
        borderRadius: 8, padding: '4px 12px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
        border: '1px solid rgba(var(--chat-border), 0.4)',
      }}>
        {label}
      </div>
    </div>
  );
}

export default function MessageList({ messages, conversation, isLoading, hasMore, onLoadMore, onReply }: Props) {
  const { user } = useAuthStore();
  const { updateMessage, addReaction } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const typingUsers = useChatStore((s) => s.typingUsers[conversation.id] ?? {});
  const isAnyoneTyping = Object.values(typingUsers).some(Boolean);

  /* Load more sentinel */
  const { ref: topSentinelRef, inView } = useInView({ threshold: 0 });

  useEffect(() => {
    if (inView && hasMore && !isLoading) onLoadMore();
  }, [inView, hasMore, isLoading]);

  /* Scroll to bottom when new messages arrive */
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.isMine) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else if (containerRef.current) {
        const el = containerRef.current;
        const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
        if (isNearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages]);

  /* Initial scroll to bottom */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [conversation.id]);

  const handleDelete = useCallback(async (msg: LocalMessage, forEveryone: boolean) => {
    if (forEveryone) {
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('message:delete', {
          localId: msg.localId,
          conversationId: msg.conversationId,
          forEveryone: true,
        });
      }
      await deleteMessageForEveryone(msg.localId);
      updateMessage(msg.localId, { deletedForEveryone: true, text: undefined, mediaUrl: undefined });
    } else {
      await deleteMessageForMe(msg.localId);
      updateMessage(msg.localId, { deletedForMe: true });
    }
    toast.success(forEveryone ? 'Deleted for everyone' : 'Deleted');
  }, [updateMessage]);

  const handleReact = useCallback(async (msg: LocalMessage, emoji: string) => {
    const socket = getSocket();
    const existing = msg.reactions.find((r) => r.userId === user?.id);
    const newEmoji = existing?.emoji === emoji ? null : emoji;

    if (socket?.connected) {
      socket.emit('message:react', {
        conversationId: conversation.id,
        localId: msg.localId,
        emoji: newEmoji,
      });
    }
    await updateMessageReaction(msg.localId, user!.id, newEmoji);
    addReaction(msg.localId, user!.id, newEmoji);
  }, [user, conversation.id, addReaction]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied');
  };

  /* Group messages and insert date separators */
  const rendered: Array<{ type: 'date'; date: Date } | { type: 'msg'; msg: LocalMessage; idx: number }> = [];
  let lastDate: Date | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const d = parseISO(msg.timestamp);
    if (!lastDate || !isSameDay(lastDate, d)) {
      rendered.push({ type: 'date', date: d });
      lastDate = d;
    }
    rendered.push({ type: 'msg', msg, idx: i });
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto scroll-smooth chat-wallpaper"
      style={{ paddingTop: 8, paddingBottom: 8 }}
    >
      {/* Load more sentinel */}
      <div ref={topSentinelRef} className="h-4" />

      {/* Loading spinner */}
      {isLoading && (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* E2E notice */}
      {messages.length === 0 && !isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 16px 10px' }}>
          <div style={{
            background: 'rgb(var(--bg-elevated))',
            borderRadius: 10, padding: '10px 18px', textAlign: 'center', maxWidth: 320,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            border: '1px solid rgba(var(--chat-border), 0.4)',
          }}>
            <p style={{ margin: 0, fontSize: 12.5, color: 'rgb(var(--text-secondary))', lineHeight: 1.6 }}>
              🔒 Messages and calls are end-to-end encrypted. No one outside of this chat can read them.
            </p>
          </div>
        </div>
      )}

      {/* Messages */}
      {rendered.map((item, i) => {
        if (item.type === 'date') {
          return <DateSeparator key={`date-${i}`} date={item.date} />;
        }
        const { msg, idx } = item;
        const prev = messages[idx - 1];
        const next = messages[idx + 1];
        const isConsecutive = !!prev && prev.senderId === msg.senderId &&
          Math.abs(parseISO(msg.timestamp).getTime() - parseISO(prev.timestamp).getTime()) < 60_000;

        return (
          <MessageBubble
            key={msg.localId}
            msg={msg}
            isConsecutive={isConsecutive}
            prevMsg={prev}
            nextMsg={next}
            onReply={onReply}
            onDelete={handleDelete}
            onReact={handleReact}
            onCopy={handleCopy}
          />
        );
      })}

      {/* Typing indicator */}
      {isAnyoneTyping && <TypingIndicator />}

      <div ref={bottomRef} className="h-1" />
    </div>
  );
}
