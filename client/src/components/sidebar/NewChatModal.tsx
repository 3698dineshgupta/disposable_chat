'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, Users, MessageCircle, ChevronRight } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi, conversationsApi } from '@/lib/api';
import { useUIStore } from '@/store/ui';
import { useChatStore } from '@/store/chat';
import Avatar from '@/components/ui/Avatar';
import type { User } from '@/types';
import toast from 'react-hot-toast';

interface Props { onClose: () => void; }

export default function NewChatModal({ onClose }: Props) {
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setActiveConversation, setNewGroupModal } = useUIStore();
  const { addConversation } = useChatStore();
  const queryClient = useQueryClient();

  /* Animate in */
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    setTimeout(() => inputRef.current?.focus(), 200);
  }, []);

  const close = () => {
    setVisible(false);
    setTimeout(onClose, 220);
  };

  const { data: users, isLoading } = useQuery({
    queryKey: ['user-search', search],
    queryFn: () => usersApi.search(search).then((r) => r.data.users as User[]),
    enabled: search.length >= 2,
    staleTime: 10_000,
  });

  const startChat = async (otherUser: User) => {
    setLoading(otherUser.id);
    try {
      const res = await conversationsApi.getOrCreate(otherUser.id);
      const ou = res.data.otherUser ?? otherUser;
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
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      close();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to start chat');
    } finally {
      setLoading(null);
    }
  };

  const showResults  = search.length >= 2;
  const noResults    = showResults && !isLoading && users?.length === 0;
  const hasResults   = showResults && !isLoading && (users?.length ?? 0) > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 51,
        background: 'rgb(var(--bg-elevated))',
        borderRadius: '24px 24px 0 0',
        boxShadow: '0 -8px 48px rgba(0,0,0,0.35)',
        maxHeight: '82vh',
        display: 'flex', flexDirection: 'column',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.22s cubic-bezier(0.32,0.72,0,1)',
        fontFamily: 'inherit',
      }}>

        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{
            width: 40, height: 4, borderRadius: 2,
            background: 'rgba(var(--text-muted),0.4)',
          }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 20px 16px',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'rgb(var(--text-primary))' }}>
              New chat
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'rgb(var(--text-muted))' }}>
              Search for people to message
            </p>
          </div>
          <button
            onClick={close}
            style={{
              width: 36, height: 36, borderRadius: '50%', border: 'none',
              background: 'rgba(var(--chat-border),0.5)',
              color: 'rgb(var(--text-secondary))',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(var(--chat-border),0.8)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(var(--chat-border),0.5)')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search input */}
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{
              position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
              color: search.length >= 2 ? 'rgb(var(--brand))' : 'rgb(var(--text-muted))',
              pointerEvents: 'none', transition: 'color 0.15s',
            }} />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or username…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '12px 40px 12px 40px',
                borderRadius: 14,
                border: `1.5px solid ${search.length >= 2 ? 'rgba(var(--brand),0.4)' : 'rgba(var(--chat-border),0.5)'}`,
                background: 'rgba(var(--bg-surface),0.8)',
                color: 'rgb(var(--text-primary))',
                fontSize: 14, fontFamily: 'inherit', outline: 'none',
                boxShadow: search.length >= 2 ? '0 0 0 3px rgba(var(--brand),0.1)' : 'none',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: 'rgba(var(--chat-border),0.7)',
                  color: 'rgb(var(--text-secondary))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 24 }}>

          {/* New group chat button */}
          <div style={{ padding: '0 16px 8px' }}>
            <button
              onClick={() => { close(); setTimeout(() => setNewGroupModal(true), 250); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                width: '100%', padding: '12px 14px', borderRadius: 14,
                border: '1px solid rgba(var(--brand),0.2)',
                background: 'rgba(var(--brand),0.06)',
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--brand),0.12)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(var(--brand),0.35)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--brand),0.06)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(var(--brand),0.2)';
              }}
            >
              <div style={{
                width: 42, height: 42, borderRadius: '50%',
                background: 'linear-gradient(135deg, rgb(var(--brand)), rgba(var(--brand),0.7))',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                boxShadow: '0 4px 12px rgba(var(--brand),0.3)',
              }}>
                <Users size={18} color="#fff" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'rgb(var(--brand))' }}>
                  New group chat
                </div>
                <div style={{ fontSize: 12, color: 'rgb(var(--text-muted))', marginTop: 1 }}>
                  Create a group with multiple people
                </div>
              </div>
              <ChevronRight size={16} style={{ color: 'rgb(var(--text-muted))', flexShrink: 0 }} />
            </button>
          </div>

          {/* Divider with label */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 20px 4px',
          }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(var(--chat-border),0.4)' }} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                           color: 'rgb(var(--text-muted))', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              {showResults ? `People${hasResults ? ` (${users!.length})` : ''}` : 'Find people'}
            </span>
            <div style={{ flex: 1, height: 1, background: 'rgba(var(--chat-border),0.4)' }} />
          </div>

          {/* Empty / hint state */}
          {!showResults && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '28px 24px 16px', gap: 10,
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(var(--brand),0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Search size={22} color="rgb(var(--brand))" />
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'rgb(var(--text-secondary))' }}>
                Search for someone
              </p>
              <p style={{ margin: 0, fontSize: 12.5, color: 'rgb(var(--text-muted))', textAlign: 'center', lineHeight: 1.5 }}>
                Type at least 2 characters to find people by name or username
              </p>
            </div>
          )}

          {/* Loading */}
          {isLoading && showResults && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 0' }}>
              {[0.9, 0.7, 0.5].map((op, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 20px', opacity: op,
                }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(var(--chat-border),0.5)', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ height: 12, borderRadius: 6, background: 'rgba(var(--chat-border),0.5)', width: '55%' }} />
                    <div style={{ height: 10, borderRadius: 6, background: 'rgba(var(--chat-border),0.35)', width: '35%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* No results */}
          {noResults && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '28px 24px 16px', gap: 10,
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(var(--chat-border),0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <MessageCircle size={22} color="rgb(var(--text-muted))" />
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'rgb(var(--text-secondary))' }}>
                No users found
              </p>
              <p style={{ margin: 0, fontSize: 12.5, color: 'rgb(var(--text-muted))', textAlign: 'center' }}>
                No one matched "<strong style={{ color: 'rgb(var(--text-secondary))' }}>{search}</strong>"
              </p>
            </div>
          )}

          {/* Results */}
          {hasResults && (
            <div style={{ padding: '4px 0' }}>
              {users!.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  loading={loading === user.id}
                  onClick={() => startChat(user)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

function UserRow({ user, loading, onClick }: { user: User; loading: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        width: '100%', padding: '10px 20px', border: 'none',
        cursor: loading ? 'default' : 'pointer', textAlign: 'left',
        fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
        background: hov ? 'rgba(var(--chat-border),0.3)' : 'transparent',
        transition: 'background 0.12s',
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar src={user.avatar_url} name={user.display_name} size="md" isOnline={user.is_online} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600,
          color: 'rgb(var(--text-primary))',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {user.display_name}
        </div>
        <div style={{ fontSize: 12.5, color: 'rgb(var(--text-muted))', marginTop: 1 }}>
          @{user.username}
          {user.is_online && (
            <span style={{ marginLeft: 6, color: '#00a884', fontWeight: 500 }}>· Online</span>
          )}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        {loading ? (
          <div style={{
            width: 18, height: 18, borderRadius: '50%',
            border: '2px solid rgb(var(--brand))', borderTopColor: 'transparent',
            animation: 'spin 0.6s linear infinite',
          }} />
        ) : (
          <div style={{
            padding: '5px 12px', borderRadius: 20,
            background: hov ? 'rgba(var(--brand),0.15)' : 'rgba(var(--brand),0.08)',
            color: 'rgb(var(--brand))', fontSize: 12, fontWeight: 600,
            transition: 'background 0.15s',
          }}>
            Message
          </div>
        )}
      </div>
    </button>
  );
}
