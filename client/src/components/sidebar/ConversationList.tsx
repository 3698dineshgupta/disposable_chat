'use client';

import { useEffect, useState } from 'react';
import { Search, X, MessageCirclePlus, Plus } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { conversationsApi, usersApi } from '@/lib/api';
import { joinConversationRoom } from '@/lib/socket';
import { saveConversations, getAllConversations, getLastMessage, getUnreadCount } from '@/lib/db';
import { useChatStore } from '@/store/chat';
import { useUIStore } from '@/store/ui';
import type { Conversation, User } from '@/types';
import ConversationItem from './ConversationItem';
import Avatar from '@/components/ui/Avatar';
import toast from 'react-hot-toast';

type Filter = 'all' | 'unread' | 'favorites' | 'groups';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',       label: 'All'       },
  { id: 'unread',    label: 'Unread'    },
  { id: 'favorites', label: 'Favorites' },
  { id: 'groups',    label: 'Groups'    },
];

export default function ConversationList() {
  const { conversations, setConversations, addConversation } = useChatStore();
  const { setActiveConversation, setNewChatModal } = useUIStore();
  const [search, setSearch]           = useState('');
  const [localConvs, setLocalConvs]   = useState<Conversation[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [startingChat, setStartingChat]   = useState<string | null>(null);
  const [filter, setFilter]           = useState<Filter>('all');
  const queryClient = useQueryClient();

  useEffect(() => {
    getAllConversations().then((local) => {
      if (local.length > 0 && conversations.length === 0) {
        setConversations(local);
        setLocalConvs(local);
      }
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await conversationsApi.list();
      const convs: Conversation[] = res.data.conversations;
      // Use the best available "last read" timestamp to count unread messages.
      // Priority: server's last_read_at → local store's last_read_at (updated by
      // markAllSeenInConv) → conversation created_at → current time.
      // Never fall back to epoch (new Date(0)) — that would mark all historical
      // messages as unread for conversations where last_read_at is null.
      const localStore = useChatStore.getState().conversations;
      const enriched = await Promise.all(
        convs.map(async (c) => {
          const localConv = localStore.find((lc) => lc.id === c.id);
          const effectiveLastRead =
            c.last_read_at ??
            localConv?.last_read_at ??
            c.created_at ??
            new Date().toISOString();
          return {
            ...c,
            lastMessage:  await getLastMessage(c.id),
            unreadCount:  await getUnreadCount(c.id, effectiveLastRead),
          };
        })
      );
      await saveConversations(enriched);
      return enriched;
    },
    staleTime: 30_000,
  });

  useEffect(() => { if (data) setConversations(data); }, [data]);

  const { data: userResults, isLoading: userSearchLoading } = useQuery({
    queryKey: ['user-search', search],
    queryFn: () => usersApi.search(search).then((r) => r.data.users as User[]),
    enabled: search.length >= 2,
    staleTime: 10_000,
  });

  const list = conversations.length > 0 ? conversations : localConvs;

  const filteredConvs = list.filter((c) => {
    // Text search filter
    if (search) {
      const name = c.type === 'group' ? (c.name ?? '') : (c.other_display_name ?? c.other_username ?? '');
      if (!name.toLowerCase().includes(search.toLowerCase())) return false;
    }
    // Tab filter
    if (filter === 'unread')    return (c.unreadCount ?? 0) > 0;
    if (filter === 'favorites') return !!c.is_pinned;
    if (filter === 'groups')    return c.type === 'group';
    return true;
  });

  const sorted = [...filteredConvs].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  const existingUserIds = new Set(list.map((c) => c.other_user_id).filter(Boolean));
  const newUsers = (userResults ?? []).filter((u) => !existingUserIds.has(u.id));

  const startChat = async (user: User) => {
    setStartingChat(user.id);
    try {
      const res = await conversationsApi.getOrCreate(user.id);
      const ou = res.data.otherUser ?? user;
      const fullConv = {
        ...res.data.conversation,
        other_user_id:            ou.id,
        other_username:           ou.username,
        other_display_name:       ou.display_name,
        other_avatar_url:         ou.avatar_url ?? null,
        other_is_online:          ou.is_online ?? false,
        other_last_seen:          ou.last_seen ?? null,
        other_about:              ou.about ?? null,
        other_public_key:         ou.public_key ?? null,
        other_signing_public_key: ou.signing_public_key ?? null,
      };
      addConversation(fullConv);
      setActiveConversation(fullConv.id);
      joinConversationRoom(fullConv.id);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setSearch('');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to start chat');
    } finally {
      setStartingChat(null);
    }
  };

  const isEmpty    = !isLoading && sorted.length === 0 && newUsers.length === 0 && search.length < 2;
  const noResults  = !isLoading && sorted.length === 0 && (search.length > 0 || filter !== 'all');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Search bar ── */}
      <div style={{ padding: '10px 12px 6px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={14} style={{
            position: 'absolute', left: 12, pointerEvents: 'none', transition: 'color 0.15s',
            color: searchFocused ? 'rgb(var(--brand))' : 'rgb(var(--text-muted))',
          }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search or start new chat"
            style={{
              width: '100%', padding: '9px 36px', borderRadius: 24,
              border: `1px solid ${searchFocused ? 'rgba(var(--brand),0.4)' : 'rgba(var(--chat-border),0.5)'}`,
              background: 'rgb(var(--bg-surface))',
              color: 'rgb(var(--text-primary))',
              fontSize: 13.5, fontFamily: 'inherit', outline: 'none',
              boxShadow: searchFocused ? '0 0 0 3px rgba(var(--brand),0.1)' : 'none',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')}
                    style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer',
                             color: 'rgb(var(--text-muted))', display: 'flex', padding: 2 }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Filter chips ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 12px 10px', overflowX: 'auto',
      }}>
        {FILTERS.map(({ id, label }) => {
          const active = filter === id;
          return (
            <button
              key={id}
              onClick={() => setFilter(id)}
              style={{
                padding: '5px 14px', borderRadius: 20, border: 'none',
                cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500,
                fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
                background: active ? 'rgb(var(--brand))' : 'rgba(var(--chat-border), 0.5)',
                color: active ? '#fff' : 'rgb(var(--text-primary))',
                transition: 'background 0.15s, color 0.15s',
                boxShadow: active ? '0 2px 8px rgba(var(--brand),0.3)' : 'none',
              }}
            >
              {label}
            </button>
          );
        })}
        {/* New group button */}
        <button
          onClick={() => setNewChatModal(true)}
          title="New chat"
          style={{
            width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'rgba(var(--chat-border), 0.5)',
            color: 'rgb(var(--text-secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(var(--brand),0.12)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(var(--chat-border), 0.5)')}
        >
          <Plus size={15} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Loading skeletons */}
        {isLoading && list.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', opacity: 0.7 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(var(--bg-surface),0.8)', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ height: 12, borderRadius: 6, background: 'rgba(var(--bg-surface),0.8)', width: '60%' }} />
                  <div style={{ height: 11, borderRadius: 6, background: 'rgba(var(--bg-surface),0.5)', width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Conversations */}
        {sorted.map((conv) => <ConversationItem key={conv.id} conversation={conv} />)}

        {/* User search results (new chats to start) */}
        {search.length >= 2 && newUsers.length > 0 && (
          <div>
            <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                          textTransform: 'uppercase', color: 'rgb(var(--text-muted))' }}>
              New conversation
            </div>
            {newUsers.map((user) => (
              <button key={user.id} onClick={() => startChat(user)} disabled={startingChat === user.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 16px',
                               border: 'none', cursor: 'pointer', background: 'none', textAlign: 'left', fontFamily: 'inherit',
                               opacity: startingChat === user.id ? 0.6 : 1, transition: 'background 0.12s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(var(--chat-border),0.3)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                <Avatar src={user.avatar_url} name={user.display_name} size="md" isOnline={user.is_online} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'rgb(var(--text-primary))',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.display_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgb(var(--brand))' }}>@{user.username}</div>
                </div>
                {startingChat === user.id ? (
                  <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgb(var(--brand))',
                                borderTopColor: 'transparent', animation: 'spin 0.6s linear infinite' }} />
                ) : (
                  <span style={{ fontSize: 12, color: 'rgb(var(--brand))', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    Message →
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {userSearchLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid rgb(var(--brand))',
                          borderTopColor: 'transparent', animation: 'spin 0.6s linear infinite' }} />
          </div>
        )}

        {/* Empty / no results */}
        {(noResults || isEmpty) && !userSearchLoading && newUsers.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        height: '50%', padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(var(--brand),0.08)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <MessageCirclePlus size={26} color="rgb(var(--brand))" />
            </div>
            <p style={{ fontSize: 14, color: 'rgb(var(--text-secondary))', fontWeight: 500, margin: '0 0 6px' }}>
              {filter !== 'all' && !search ? `No ${filter} chats` : search ? `No results for "${search}"` : 'No conversations yet'}
            </p>
            <p style={{ fontSize: 12.5, color: 'rgb(var(--text-muted))', lineHeight: 1.5, margin: '0 0 16px' }}>
              {filter !== 'all' && !search ? 'Try a different filter' : 'Search for someone to start chatting'}
            </p>
            {isEmpty && (
              <button onClick={() => setNewChatModal(true)}
                      style={{ padding: '8px 22px', borderRadius: 100, border: 'none', cursor: 'pointer',
                               fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                               background: 'rgb(var(--brand))', color: 'white',
                               boxShadow: '0 4px 12px rgba(var(--brand),0.3)' }}>
                New chat
              </button>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
