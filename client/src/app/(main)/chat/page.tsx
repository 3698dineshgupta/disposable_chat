'use client';

import { useUIStore } from '@/store/ui';
import { useCallStore } from '@/store/call';
import Sidebar from '@/components/sidebar/Sidebar';
import ChatWindow from '@/components/chat/ChatWindow';
import CallScreen from '@/components/calls/CallScreen';
import IncomingCallModal from '@/components/calls/IncomingCallModal';

export default function ChatPage() {
  const { activeConversationId, isMobileView, showChatOnMobile } = useUIStore();
  const { activeCall, incomingCall } = useCallStore();

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden', background: 'rgb(var(--chat-bg))' }}>
      {/* Sidebar — fixed width, never shrinks */}
      {!(isMobileView && showChatOnMobile) && (
        <div style={{ flexShrink: 0, height: '100%', display: 'flex' }}>
          <Sidebar />
        </div>
      )}

      {/* Chat area — fills remaining width */}
      {!(isMobileView && !showChatOnMobile) && (
        <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeConversationId ? (
            <ChatWindow conversationId={activeConversationId} key={activeConversationId} />
          ) : (
            <EmptyState />
          )}
        </div>
      )}

      {activeCall   && <CallScreen />}
      {incomingCall && <IncomingCallModal />}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: 'rgb(var(--chat-bg))', position: 'relative', overflow: 'hidden' }}>

      {/* Subtle background glow */}
      <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(0,168,132,0.06) 0%, transparent 65%)',
                    top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', textAlign: 'center', padding: '40px 48px', maxWidth: 440 }}>
        {/* Logo mark */}
        <div style={{ marginBottom: 28, display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', inset: -8, borderRadius: 36, background: 'rgba(0,168,132,0.12)',
                          filter: 'blur(16px)', animation: 'float-orb 8s ease-in-out infinite' }} />
            <div style={{ position: 'relative', width: 88, height: 88, borderRadius: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'linear-gradient(135deg, #00d4a1 0%, #00a884 55%, #007a62 100%)',
                          boxShadow: '0 16px 48px rgba(0,168,132,0.3), 0 4px 16px rgba(0,0,0,0.2)' }}>
              <svg width="44" height="44" fill="white" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
          </div>
        </div>

        <h2 style={{ fontSize: 28, fontWeight: 700, color: 'rgb(var(--text-primary))', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
          ZapChat
        </h2>
        <p style={{ fontSize: 15, color: 'rgb(var(--text-secondary))', lineHeight: 1.6, margin: '0 0 28px' }}>
          Select a conversation from the sidebar, or start a new chat to begin messaging.
        </p>

        {/* Feature pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
          {[
            { icon: '🔒', label: 'End-to-end encrypted' },
            { icon: '⚡', label: 'Real-time delivery' },
            { icon: '📱', label: 'Cross-device' },
          ].map(({ icon, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 100,
                                      background: 'rgba(0,168,132,0.08)', border: '1px solid rgba(0,168,132,0.15)',
                                      fontSize: 13, color: 'rgb(var(--text-secondary))', fontWeight: 500 }}>
              <span style={{ fontSize: 14 }}>{icon}</span> {label}
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, color: 'rgb(var(--text-muted))', letterSpacing: '0.03em' }}>
          Your messages are encrypted before leaving your device
        </div>
      </div>
    </div>
  );
}
