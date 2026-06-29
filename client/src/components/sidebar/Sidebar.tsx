'use client';

import { useState } from 'react';
import { MessageSquare, Phone, Circle, Settings, PenSquare, LogOut, Sun, Moon, Users } from 'lucide-react';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { authApi } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';
import Avatar from '@/components/ui/Avatar';
import ConversationList from './ConversationList';
import CallHistory from './CallHistory';
import StatusPanel from './StatusPanel';
import NewChatModal from './NewChatModal';
import ProfilePanel from './ProfilePanel';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

const NAV = [
  { id: 'chats',  Icon: MessageSquare, label: 'Chats' },
  { id: 'status', Icon: Circle,        label: 'Status' },
  { id: 'calls',  Icon: Phone,         label: 'Calls' },
] as const;

export default function Sidebar() {
  const { activePanel, setActivePanel, theme, setTheme, showNewChatModal, setNewChatModal } = useUIStore();
  const { user, logout } = useAuthStore();
  const [showMenu, setShowMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    disconnectSocket();
    logout();
    router.push('/login');
    toast.success('Logged out');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: 'clamp(300px, 28vw, 400px)',
                  background: 'rgb(var(--chat-sidebar))', borderRight: '1px solid rgba(var(--chat-border), 0.6)' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 16px 14px', background: 'rgb(var(--chat-header))',
                    borderBottom: '1px solid rgb(var(--chat-border) / 0.4)' }}>

        <button onClick={() => setShowProfile(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0, flex: 1, minWidth: 0 }}>
          <Avatar src={user?.avatar_url} name={user?.display_name ?? user?.username ?? '?'} size="sm" />
          <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'rgb(var(--text-primary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.display_name ?? user?.username}
            </div>
            <div style={{ fontSize: 11, color: '#00a884', fontWeight: 500 }}>● Online</div>
          </div>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <IconBtn title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </IconBtn>
          <IconBtn title="New chat" onClick={() => setNewChatModal(true)}>
            <PenSquare size={18} />
          </IconBtn>
          <div style={{ position: 'relative' }}>
            <IconBtn onClick={() => setShowMenu(v => !v)}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3.5, alignItems: 'center' }}>
                {[0,1,2].map(i => <span key={i} style={{ display: 'block', width: 3.5, height: 3.5, borderRadius: '50%', background: 'rgb(var(--text-secondary))' }} />)}
              </span>
            </IconBtn>
            {showMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setShowMenu(false)} />
                <div style={{ position: 'absolute', right: 0, top: 44, zIndex: 20, width: 200, borderRadius: 14,
                              background: 'rgb(var(--bg-elevated))', border: '1px solid rgb(var(--chat-border) / 0.5)',
                              boxShadow: '0 8px 32px rgba(0,0,0,0.3)', overflow: 'hidden', padding: '4px 0' }}>
                  <MenuBtn icon={<Settings size={15} />} label="Settings" onClick={() => { setShowProfile(true); setShowMenu(false); }} />
                  <MenuBtn icon={<LogOut size={15} />} label="Log out" danger onClick={() => { handleLogout(); setShowMenu(false); }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Nav tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgb(var(--chat-border) / 0.4)', background: 'rgb(var(--chat-header))' }}>
        {NAV.map(({ id, Icon, label }) => {
          const active = activePanel === id;
          return (
            <button key={id} onClick={() => setActivePanel(id)}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '10px 0',
                             border: 'none', cursor: 'pointer', background: 'none', position: 'relative',
                             color: active ? '#00a884' : 'rgb(var(--text-secondary))',
                             transition: 'color 0.15s', fontFamily: 'inherit', fontSize: 11, fontWeight: active ? 600 : 400 }}>
              <Icon size={18} />
              <span>{label}</span>
              {active && <span style={{ position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2,
                                        background: 'linear-gradient(90deg, transparent, #00a884, transparent)', borderRadius: 2 }} />}
            </button>
          );
        })}
      </div>

      {/* ── Panel content ── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activePanel === 'chats'  && <ConversationList />}
        {activePanel === 'status' && <StatusPanel />}
        {activePanel === 'calls'  && <CallHistory />}
      </div>

      {/* ── Modals ── */}
      {showNewChatModal && <NewChatModal onClose={() => setNewChatModal(false)} />}
      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} />}
    </div>
  );
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  const [hov, setHov] = useState(false);
  return (
    <button title={title} onClick={onClick}
            onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
            style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                     background: hov ? 'rgba(var(--chat-border), 0.5)' : 'transparent',
                     color: 'rgb(var(--text-secondary))', transition: 'background 0.15s', fontFamily: 'inherit' }}>
      {children}
    </button>
  );
}

function MenuBtn({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', border: 'none', cursor: 'pointer',
                     background: hov ? 'rgba(var(--chat-border), 0.4)' : 'transparent', fontFamily: 'inherit', fontSize: 14,
                     color: danger ? '#ef4444' : 'rgb(var(--text-primary))', transition: 'background 0.12s', textAlign: 'left' }}>
      {icon} {label}
    </button>
  );
}
