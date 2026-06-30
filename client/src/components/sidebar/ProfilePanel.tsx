'use client';

import { useState, useRef } from 'react';
import { X, Camera, Edit2, Check, Moon, Sun, Monitor, Lock, User, AtSign, Info, LogOut } from 'lucide-react';
import { usersApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { disconnectSocket } from '@/lib/socket';
import { clearAllUserData } from '@/lib/db/index';
import { useChatStore } from '@/store/chat';
import Avatar from '@/components/ui/Avatar';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

interface Props { onClose: () => void; }

export default function ProfilePanel({ onClose }: Props) {
  const { user, updateUser, logout } = useAuthStore();
  const { theme, setTheme }          = useUIStore();
  const [editingName,  setEditingName]  = useState(false);
  const [editingAbout, setEditingAbout] = useState(false);
  const [name,  setName]  = useState(user?.display_name ?? '');
  const [about, setAbout] = useState(user?.about ?? '');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router  = useRouter();

  const saveField = async (field: 'display_name' | 'about') => {
    try {
      const res = await usersApi.updateProfile({ [field]: field === 'display_name' ? name : about });
      updateUser(res.data.user);
      toast.success('Saved');
    } catch {
      toast.error('Update failed');
    }
    if (field === 'display_name') setEditingName(false);
    else setEditingAbout(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await usersApi.uploadAvatar(file);
      updateUser({ avatar_url: res.data.avatarUrl });
      toast.success('Photo updated');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    disconnectSocket();
    await clearAllUserData();
    localStorage.removeItem('zapchat-active-user');
    useChatStore.getState().setConversations([]);
    logout();
    router.push('/login');
    toast.success('Logged out');
  };

  const THEMES = [
    { id: 'light',  icon: Sun,     label: 'Light'  },
    { id: 'dark',   icon: Moon,    label: 'Dark'   },
    { id: 'system', icon: Monitor, label: 'System' },
  ] as const;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Panel — slides in from left */}
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 51,
        width: 'min(380px, 95vw)',
        background: 'rgb(var(--bg-elevated))',
        boxShadow: '4px 0 40px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
        animation: 'slideInLeft 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '16px 20px',
          background: 'rgb(var(--brand))',
          flexShrink: 0,
        }}>
          <button onClick={onClose} style={{ ...iconCircle, background: 'rgba(255,255,255,0.15)' }}>
            <X size={18} color="#fff" />
          </button>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>
            Profile
          </h2>
        </div>

        {/* Avatar section */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '36px 24px 28px',
          background: 'rgba(var(--brand),0.04)',
          borderBottom: '1px solid rgba(var(--chat-border),0.4)',
          flexShrink: 0,
        }}>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <Avatar src={user?.avatar_url} name={user?.display_name ?? ''} size="xl" />
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                position: 'absolute', bottom: 2, right: 2,
                width: 34, height: 34, borderRadius: '50%',
                background: 'rgb(var(--brand))',
                border: '3px solid rgb(var(--bg-elevated))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                transition: 'transform 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {uploading ? (
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #fff', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
              ) : (
                <Camera size={15} color="#fff" />
              )}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />

          <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'rgb(var(--text-primary))', textAlign: 'center' }}>
            {user?.display_name}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgb(var(--brand))', fontWeight: 500 }}>
            ● Online
          </p>
        </div>

        {/* Info fields */}
        <div style={{ flex: 1, padding: '8px 0' }}>

          {/* Name */}
          <Section icon={<User size={18} />} label="Display name">
            {editingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveField('display_name')}
                  style={{
                    flex: 1, border: 'none', borderBottom: '2px solid rgb(var(--brand))',
                    background: 'transparent', color: 'rgb(var(--text-primary))',
                    fontSize: 15, fontFamily: 'inherit', outline: 'none', padding: '2px 0',
                  }}
                />
                <button onClick={() => saveField('display_name')} style={actionBtn}>
                  <Check size={16} color="rgb(var(--brand))" />
                </button>
                <button onClick={() => setEditingName(false)} style={actionBtn}>
                  <X size={16} color="rgb(var(--text-muted))" />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, color: 'rgb(var(--text-primary))' }}>{user?.display_name}</span>
                <button onClick={() => setEditingName(true)} style={actionBtn}>
                  <Edit2 size={15} color="rgb(var(--text-muted))" />
                </button>
              </div>
            )}
          </Section>

          {/* About */}
          <Section icon={<Info size={18} />} label="About">
            {editingAbout ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  autoFocus
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveField('about')}
                  placeholder="Add a bio…"
                  style={{
                    flex: 1, border: 'none', borderBottom: '2px solid rgb(var(--brand))',
                    background: 'transparent', color: 'rgb(var(--text-primary))',
                    fontSize: 14, fontFamily: 'inherit', outline: 'none', padding: '2px 0',
                  }}
                />
                <button onClick={() => saveField('about')} style={actionBtn}>
                  <Check size={16} color="rgb(var(--brand))" />
                </button>
                <button onClick={() => setEditingAbout(false)} style={actionBtn}>
                  <X size={16} color="rgb(var(--text-muted))" />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, color: user?.about ? 'rgb(var(--text-primary))' : 'rgb(var(--text-muted))', fontStyle: user?.about ? 'normal' : 'italic' }}>
                  {user?.about || 'Add a bio…'}
                </span>
                <button onClick={() => setEditingAbout(true)} style={actionBtn}>
                  <Edit2 size={15} color="rgb(var(--text-muted))" />
                </button>
              </div>
            )}
          </Section>

          {/* Username */}
          <Section icon={<AtSign size={18} />} label="Username">
            <span style={{ fontSize: 14, color: 'rgb(var(--text-primary))' }}>@{user?.username}</span>
          </Section>

          {/* Email */}
          <Section icon={<Lock size={18} />} label="Email">
            <span style={{ fontSize: 14, color: 'rgb(var(--text-muted))' }}>{user?.email}</span>
          </Section>

          <div style={{ margin: '8px 0', borderTop: '1px solid rgba(var(--chat-border),0.4)' }} />

          {/* Theme switcher */}
          <div style={{ padding: '14px 20px' }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                        textTransform: 'uppercase', color: 'rgb(var(--text-muted))' }}>
              Appearance
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {THEMES.map(({ id, icon: Icon, label }) => {
                const active = theme === id;
                return (
                  <button
                    key={id}
                    onClick={() => setTheme(id)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '14px 8px', borderRadius: 14,
                      border: `2px solid ${active ? 'rgb(var(--brand))' : 'rgba(var(--chat-border),0.5)'}`,
                      background: active ? 'rgba(var(--brand),0.08)' : 'transparent',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                    }}
                  >
                    <Icon size={20} color={active ? 'rgb(var(--brand))' : 'rgb(var(--text-muted))'} />
                    <span style={{ fontSize: 12, fontWeight: active ? 600 : 500,
                                   color: active ? 'rgb(var(--brand))' : 'rgb(var(--text-secondary))' }}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ margin: '4px 0', borderTop: '1px solid rgba(var(--chat-border),0.4)' }} />

          {/* Log out */}
          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              width: '100%', padding: '14px 20px', border: 'none',
              cursor: 'pointer', background: 'none', fontFamily: 'inherit', textAlign: 'left',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(239,68,68,0.1)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <LogOut size={17} color="#ef4444" />
            </div>
            <span style={{ fontSize: 14, fontWeight: 500, color: '#ef4444' }}>Log out</span>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideInLeft {
          from { transform: translateX(-100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(var(--chat-border),0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(var(--brand),0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
          {icon && <span style={{ color: 'rgb(var(--brand))' }}>{icon}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0 0 3px', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: 'rgb(var(--brand))' }}>
            {label}
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}

const iconCircle: React.CSSProperties = {
  width: 34, height: 34, borderRadius: '50%',
  border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,0.1)', transition: 'background 0.15s',
};

const actionBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', border: 'none',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', transition: 'background 0.15s',
  flexShrink: 0,
};
