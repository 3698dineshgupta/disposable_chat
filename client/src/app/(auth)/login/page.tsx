'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ensureKeysUploaded } from '@/lib/setupKeys';

const CARD: React.CSSProperties = {
  width: '100%',
  borderRadius: 28,
  overflow: 'hidden',
  background: 'rgba(15,24,32,0.9)',
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.06)',
  boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,168,132,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
};

const INPUT: React.CSSProperties = {
  width: '100%',
  background: 'rgba(23,35,42,0.7)',
  border: '1.5px solid rgba(255,255,255,0.07)',
  borderRadius: 14,
  padding: '14px 16px',
  fontSize: 15,
  color: '#e1e6eb',
  outline: 'none',
  fontFamily: 'inherit',
  transition: 'border-color 0.2s, box-shadow 0.2s',
};

function Input({
  label, name, type = 'text', value, onChange, autoComplete, right,
}: {
  label: string; name: string; type?: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string; right?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7a909a', marginBottom: 8 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            ...INPUT,
            paddingRight: right ? 48 : 16,
            borderColor: focused ? 'rgba(0,168,132,0.7)' : 'rgba(255,255,255,0.07)',
            boxShadow: focused ? '0 0 0 3px rgba(0,168,132,0.12), 0 2px 8px rgba(0,0,0,0.1)' : 'none',
          }}
        />
        {right && (
          <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)' }}>
            {right}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const router = useRouter();

  const set = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authApi.login({ email: form.email, password: form.password });
      login(res.data.user, res.data.accessToken);
      ensureKeysUploaded(res.data.user?.public_key).catch(() => {});
      router.push('/chat');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const id = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!id || !(window as any).google?.accounts) return;
    const cb = async (r: { credential: string }) => {
      try {
        const res = await authApi.loginWithGoogle(r.credential);
        login(res.data.user, res.data.accessToken);
        router.push('/chat');
      } catch (err: any) { toast.error(err.response?.data?.error || 'Google login failed'); }
    };
    (window as any).google.accounts.id.initialize({ client_id: id, callback: cb });
    (window as any).google.accounts.id.renderButton(document.getElementById('google-btn'), { theme: 'filled_black', size: 'large', width: 340 });
  }, []);

  const canSubmit = form.email && form.password && !loading;

  return (
    <div style={{ width: '100%' }}>
      <div style={CARD}>
        {/* Top accent */}
        <div style={{ height: 3, background: 'linear-gradient(90deg, transparent, #00a884 30%, #00d4a1 60%, transparent)' }} />

        <div style={{ padding: '32px 32px 28px' }}>
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#e1e6eb', margin: 0 }}>Welcome back</h2>
            <p style={{ color: '#7a909a', fontSize: 14, marginTop: 6 }}>Sign in to continue to ZapChat</p>
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Input label="Email address" name="email" type="email" value={form.email} onChange={set} autoComplete="email" />

            <Input
              label="Password"
              name="password"
              type={showPw ? 'text' : 'password'}
              value={form.password}
              onChange={set}
              autoComplete="current-password"
              right={
                <button type="button" onClick={() => setShowPw((v) => !v)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7a909a', display: 'flex', alignItems: 'center', padding: 0 }}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            />

            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                width: '100%', padding: '15px 24px', borderRadius: 14, border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
                background: canSubmit ? 'linear-gradient(135deg, #00c49a 0%, #00a884 55%, #008f70 100%)' : 'rgba(0,168,132,0.35)',
                boxShadow: canSubmit ? '0 6px 20px rgba(0,168,132,0.35), 0 2px 6px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12)' : 'none',
                color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 0.15s ease', transform: 'translateY(0)',
                marginTop: 4,
              }}
              onMouseEnter={(e) => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
              onMouseDown={(e) => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(1px) scale(0.99)'; }}
            >
              {loading ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : <>Sign in <ArrowRight size={16} /></>}
            </button>
          </form>

          {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
                <span style={{ color: '#7a909a', fontSize: 12, fontWeight: 500 }}>or continue with</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
              </div>
              <div id="google-btn" style={{ display: 'flex', justifyContent: 'center' }} />
            </>
          )}

          <p style={{ textAlign: 'center', fontSize: 14, color: '#7a909a', marginTop: 22 }}>
            Don&apos;t have an account?{' '}
            <Link href="/register" style={{ color: '#00a884', fontWeight: 600, textDecoration: 'none' }}>
              Create one
            </Link>
          </p>
        </div>
      </div>

      <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'rgba(122,144,154,0.5)' }}>
        🔒 Messages are end-to-end encrypted. Only you can read them.
      </p>
    </div>
  );
}
