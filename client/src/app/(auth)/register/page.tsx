'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, ArrowRight, Check, X } from 'lucide-react';
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

const BASE_INPUT: React.CSSProperties = {
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

function Field({
  label, name, type = 'text', value, onChange, autoComplete, right, error,
}: {
  label: string; name: string; type?: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string; right?: React.ReactNode; error?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7a909a', marginBottom: 7 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          name={name} type={type} value={value} onChange={onChange} autoComplete={autoComplete} required
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={{
            ...BASE_INPUT,
            paddingRight: right ? 48 : 16,
            borderColor: error ? 'rgba(239,68,68,0.6)' : focused ? 'rgba(0,168,132,0.7)' : 'rgba(255,255,255,0.07)',
            boxShadow: error ? '0 0 0 3px rgba(239,68,68,0.08)' : focused ? '0 0 0 3px rgba(0,168,132,0.1)' : 'none',
          }}
        />
        {right && (
          <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
            {right}
          </div>
        )}
      </div>
    </div>
  );
}

function PwStrength({ pwd }: { pwd: string }) {
  if (!pwd) return null;
  const checks = [
    { label: '8+ chars', ok: pwd.length >= 8 },
    { label: 'Uppercase', ok: /[A-Z]/.test(pwd) },
    { label: 'Number', ok: /[0-9]/.test(pwd) },
  ];
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
      {checks.map((c) => (
        <span key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: c.ok ? '#00a884' : '#7a909a' }}>
          {c.ok ? <Check size={11} /> : <X size={11} />} {c.label}
        </span>
      ))}
    </div>
  );
}

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', username: '', display_name: '', password: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const router = useRouter();

  const set = (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const pwMatch = !form.confirm || form.password === form.confirm;
  const canSubmit = form.email && form.username && form.display_name && form.password.length >= 8 && form.password === form.confirm && !loading;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    try {
      const res = await authApi.register({
        email: form.email, username: form.username.toLowerCase(),
        display_name: form.display_name, password: form.password,
      });
      login(res.data.user, res.data.accessToken);
      // Generate & upload E2E keys in background — don't block navigation
      ensureKeysUploaded(res.data.user?.public_key).catch(() => {});
      toast.success('Welcome to ZapChat!');
      router.push('/chat');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally { setLoading(false); }
  };

  const eyeBtn = (
    <button type="button" onClick={() => setShowPw((v) => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7a909a', padding: 0, display: 'flex' }}>
      {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );

  return (
    <div style={{ width: '100%' }}>
      <div style={CARD}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, transparent, #00a884 30%, #00d4a1 60%, transparent)' }} />

        <div style={{ padding: '28px 32px 24px' }}>
          <div style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#e1e6eb', margin: 0 }}>Create account</h2>
            <p style={{ color: '#7a909a', fontSize: 14, marginTop: 5 }}>Join ZapChat — free &amp; encrypted</p>
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Row: name + username side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Full name" name="display_name" value={form.display_name} onChange={set} />
              <Field label="Username" name="username" type="text" value={form.username} onChange={set} />
            </div>

            <Field label="Email address" name="email" type="email" value={form.email} onChange={set} autoComplete="email" />

            <div>
              <Field label="Password" name="password" type={showPw ? 'text' : 'password'} value={form.password} onChange={set} autoComplete="new-password" right={eyeBtn} />
              <PwStrength pwd={form.password} />
            </div>

            <Field label="Confirm password" name="confirm" type={showPw ? 'text' : 'password'} value={form.confirm} onChange={set} autoComplete="new-password" error={!pwMatch} />

            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                width: '100%', padding: '15px 24px', borderRadius: 14, border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
                background: canSubmit ? 'linear-gradient(135deg, #00c49a 0%, #00a884 55%, #008f70 100%)' : 'rgba(0,168,132,0.3)',
                boxShadow: canSubmit ? '0 6px 20px rgba(0,168,132,0.35), 0 2px 6px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12)' : 'none',
                color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 0.15s ease', marginTop: 4,
              }}
              onMouseEnter={(e) => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
              onMouseDown={(e) => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(1px) scale(0.99)'; }}
            >
              {loading ? <><Loader2 size={16} className="animate-spin" /> Creating account…</> : <>Create account <ArrowRight size={16} /></>}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 14, color: '#7a909a', marginTop: 18 }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: '#00a884', fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
          </p>
        </div>
      </div>

      <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'rgba(122,144,154,0.5)' }}>
        🔒 Your messages are encrypted before they leave your device.
      </p>
    </div>
  );
}
