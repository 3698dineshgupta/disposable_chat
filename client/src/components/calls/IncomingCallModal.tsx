'use client';

import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { useCallStore } from '@/store/call';
import Avatar from '@/components/ui/Avatar';

export default function IncomingCallModal() {
  const { incomingCall, setIncomingCall, startCall } = useCallStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!incomingCall) return;
    const audio = new Audio('/ringtone.mp3');
    audio.loop = true;
    audio.play().catch(() => {});
    audioRef.current = audio;
    return () => { audio.pause(); audio.src = ''; };
  }, [!!incomingCall]);

  if (!incomingCall) return null;

  const { callId, callerId, callerInfo, type } = incomingCall;
  const isVideo = type === 'video';

  const accept = () => {
    audioRef.current?.pause();
    startCall({
      callId,
      peerId:        callerId,
      peerInfo:      callerInfo,
      type,
      status:        'answered',
      incomingOffer: incomingCall.offer,
      isInitiator:   false,
    });
    setIncomingCall(null);
  };

  const reject = () => {
    audioRef.current?.pause();
    getSocket()?.emit('call:reject', { callId, callerId });
    setIncomingCall(null);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(16px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      padding: 16,
      fontFamily: 'inherit',
    }}>
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'linear-gradient(160deg, #0d2137 0%, #0a1f1a 100%)',
        borderRadius: 28, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        animation: 'slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {/* Top section */}
        <div style={{ padding: '36px 24px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Pulse rings */}
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <div style={{
              position: 'absolute', inset: -16, borderRadius: '50%',
              border: '2px solid rgba(0,196,154,0.3)',
              animation: 'ringPulse 1.8s ease-out infinite',
            }} />
            <div style={{
              position: 'absolute', inset: -32, borderRadius: '50%',
              border: '2px solid rgba(0,196,154,0.15)',
              animation: 'ringPulse 1.8s ease-out infinite 0.4s',
            }} />
            <div style={{
              width: 80, height: 80, borderRadius: '50%', overflow: 'hidden',
              boxShadow: '0 0 0 4px rgba(0,196,154,0.25)',
            }}>
              <Avatar src={callerInfo?.avatar_url} name={callerInfo?.display_name ?? 'User'} size="xl" />
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6, fontWeight: 500 }}>
            Incoming {isVideo ? 'video' : 'voice'} call
          </p>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 }}>
            {callerInfo?.display_name ?? 'Unknown'}
          </h2>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 24px' }} />

        {/* Buttons */}
        <div style={{ padding: '24px 32px 32px', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
          {/* Decline */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <button onClick={reject} style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'linear-gradient(135deg, #ff3b3b, #c00)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(220,0,0,0.4)',
              transition: 'transform 0.15s',
            }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <PhoneOff size={26} color="#fff" />
            </button>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>Decline</span>
          </div>

          {/* Accept */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <button onClick={accept} style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'linear-gradient(135deg, #00c49a, #00875c)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(0,196,154,0.45)',
              transition: 'transform 0.15s',
            }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {isVideo ? <Video size={26} color="#fff" /> : <Phone size={26} color="#fff" />}
            </button>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>Accept</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(60px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes ringPulse {
          0%   { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function getSocket() {
  try { return require('@/lib/socket').getSocket(); } catch { return null; }
}
