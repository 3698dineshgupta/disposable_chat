'use client';

import { useEffect, useRef, useState } from 'react';
import { PhoneOff, Mic, MicOff, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { useCallStore } from '@/store/call';
import { getSocket } from '@/lib/socket';
import Avatar from '@/components/ui/Avatar';
import { formatDuration } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function CallScreen() {
  const {
    activeCall, endCall, setLocalStream, setRemoteStream,
    setMuted, setCameraOn, setCallStatus, setCallId,
  } = useCallStore();
  const [elapsed, setElapsed] = useState(0);
  const [speaker, setSpeaker] = useState(true);
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const peerRef        = useRef<RTCPeerConnection | null>(null);

  // Use startedAt as the key — callId changes after initiate callback which would
  // re-trigger the effect and close the PC prematurely.
  useEffect(() => {
    if (!activeCall) return;
    const timer = setInterval(() =>
      setElapsed(Math.floor((Date.now() - activeCall.startedAt) / 1000)), 1000);

    setupWebRTC().catch((err) => {
      console.error('[WebRTC] unhandled:', err);
      toast.error('Call failed: ' + (err?.message ?? 'unknown'));
      setCallStatus('failed');
    });

    return () => { clearInterval(timer); cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.startedAt]);

  const waitForIce = (pc: RTCPeerConnection): Promise<void> =>
    new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const done = () => { if (pc.iceGatheringState === 'complete') { pc.onicegatheringstatechange = null; resolve(); } };
      pc.onicegatheringstatechange = done;
      setTimeout(() => { pc.onicegatheringstatechange = null; resolve(); }, 6000);
    });

  const setupWebRTC = async () => {
    if (!activeCall) return;
    const socket = getSocket();
    if (!socket?.connected) throw new Error('Socket not connected');

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    peerRef.current = pc;

    // Get media — try with video first, fall back to audio-only
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: activeCall.type === 'video',
      });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } catch {
      // Video might be unavailable — try audio-only
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setLocalStream(stream);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      } catch (err: any) {
        console.warn('[WebRTC] no media available:', err.message);
        toast('Microphone unavailable — others may not hear you', { icon: '🔇' });
      }
    }

    // Attach remote stream to the correct element
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      setRemoteStream(stream);
      // Always wire up the hidden audio element so voice calls work
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      // Also wire the video element for video calls
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
    };

    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[WebRTC] connectionState:', state);

      if (state === 'disconnected') {
        // Give WebRTC 4 seconds to self-recover, then trigger ICE restart
        disconnectTimer = setTimeout(() => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            console.log('[WebRTC] triggering ICE restart');
            pc.restartIce(); // will fire onnegotiationneeded on the initiator side
          }
        }, 4000);
      } else if (state === 'connected') {
        if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
      } else if (state === 'failed') {
        if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
        toast.error('Call connection lost');
        setCallStatus('failed');
      }
    };

    // ICE restart renegotiation — only the initiator creates the new offer
    pc.onnegotiationneeded = async () => {
      if (!activeCall.isInitiator) return;
      if (pc.signalingState === 'closed') return;
      try {
        const restartOffer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(restartOffer);
        await waitForIce(pc);
        socket.emit('call:offer', { peerId: activeCall.peerId, offer: pc.localDescription });
        console.log('[WebRTC] sent ICE restart offer');
      } catch (err) { console.error('[WebRTC] restart offer failed:', err); }
    };

    // Responder handles incoming ICE restart offer
    const restartOfferHandler = async ({ offer }: { offer: RTCSessionDescriptionInit }) => {
      if (activeCall.isInitiator) return; // only responder handles this
      try {
        if (pc.signalingState === 'closed') return;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const restartAnswer = await pc.createAnswer();
        await pc.setLocalDescription(restartAnswer);
        await waitForIce(pc);
        socket.emit('call:answer-sdp', { peerId: activeCall.peerId, answer: pc.localDescription });
        console.log('[WebRTC] sent ICE restart answer');
      } catch (err) { console.error('[WebRTC] restart answer failed:', err); }
    };
    socket.on('call:offer', restartOfferHandler);

    // Initiator handles restart answer
    const restartAnswerHandler = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      if (!activeCall.isInitiator) return;
      try {
        if (pc.signalingState !== 'closed') {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log('[WebRTC] ICE restart complete');
        }
      } catch (err) { console.error('[WebRTC] restart setAnswer failed:', err); }
    };
    socket.on('call:answer-sdp', restartAnswerHandler);

    const iceHandler = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try { if (pc.signalingState !== 'closed') await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    };
    socket.on('call:ice', iceHandler);

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('call:ice', { peerId: activeCall.peerId, candidate: e.candidate });
    };

    if (activeCall.status === 'calling') {
      if (pc.signalingState === 'closed') return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);

      socket.once('call:answered', async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
        try {
          if (pc.signalingState !== 'closed') {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            setCallStatus('answered');
          }
        } catch (err) { console.error('[WebRTC] set answer failed:', err); }
      });

      socket.emit('call:initiate', {
        calleeId: activeCall.peerId,
        type: activeCall.type,
        conversationId: activeCall.conversationId,
        offer: pc.localDescription,
      }, (res: { callId?: string; error?: string }) => {
        if (res?.error) { toast.error('Could not reach the other user'); setCallStatus('failed'); return; }
        if (res?.callId) setCallId(res.callId);
      });

    } else {
      const offer = activeCall.incomingOffer;
      if (!offer) { toast.error('Incoming offer missing'); setCallStatus('failed'); return; }
      if (pc.signalingState === 'closed') return;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce(pc);

      socket.emit('call:answer', {
        callId:   activeCall.callId,
        callerId: activeCall.peerId,
        answer:   pc.localDescription,
      });
    }
  };

  const cleanup = () => {
    activeCall?.localStream?.getTracks().forEach((t) => t.stop());
    peerRef.current?.close();
    peerRef.current = null;
    getSocket()?.off('call:ice');
    getSocket()?.off('call:answered');
    getSocket()?.off('call:offer');
    getSocket()?.off('call:answer-sdp');
  };

  const handleHangup = () => {
    if (activeCall) {
      getSocket()?.emit('call:end', { callId: activeCall.callId, peerId: activeCall.peerId, duration: elapsed });
    }
    cleanup();
    endCall();
  };

  const toggleMute = () => {
    if (!activeCall?.localStream) return;
    const newMuted = !activeCall.isMuted;
    activeCall.localStream.getAudioTracks().forEach((t) => (t.enabled = !newMuted));
    setMuted(newMuted);
  };

  const toggleCamera = () => {
    if (!activeCall?.localStream) return;
    const newOff = activeCall.isCameraOn;
    activeCall.localStream.getVideoTracks().forEach((t) => (t.enabled = !newOff));
    setCameraOn(!newOff);
  };

  if (!activeCall) return null;

  const isVideo   = activeCall.type === 'video';
  const peerName  = activeCall.peerInfo?.display_name ?? 'User';
  const isCalling = activeCall.status === 'calling' || activeCall.status === 'ringing';
  const statusLabel =
    activeCall.status === 'calling'  ? 'Calling…'             :
    activeCall.status === 'ringing'  ? 'Ringing…'             :
    activeCall.status === 'answered' ? formatDuration(elapsed) :
    activeCall.status === 'failed'   ? 'Call failed'          : activeCall.status;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'linear-gradient(135deg, #0a1628 0%, #0d2137 40%, #0a1f1a 100%)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'inherit',
    }}>
      {/* Hidden audio element — always present so remote audio plays in voice calls */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Ambient orbs */}
      <div style={{
        position: 'absolute', top: -120, left: -120, width: 400, height: 400,
        borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,168,132,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -80, right: -80, width: 350, height: 350,
        borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,120,255,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Remote video (video calls) */}
      {isVideo && (
        <video ref={remoteVideoRef} autoPlay playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: activeCall.status === 'answered' ? 1 : 0, transition: 'opacity 0.5s' }} />
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '60px 24px 0' }}>

        {/* Local PiP */}
        {isVideo && (
          <div style={{
            position: 'absolute', top: 16, right: 16, width: 110, height: 150,
            borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            border: '2px solid rgba(255,255,255,0.1)',
          }}>
            <video ref={localVideoRef} autoPlay playsInline muted
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          </div>
        )}

        {/* Avatar + pulse rings */}
        <div style={{ position: 'relative', marginBottom: 28 }}>
          {isCalling && (
            <>
              <div style={{
                position: 'absolute', inset: -20, borderRadius: '50%',
                border: '2px solid rgba(0,168,132,0.25)',
                animation: 'callPulse 2s ease-out infinite',
              }} />
              <div style={{
                position: 'absolute', inset: -40, borderRadius: '50%',
                border: '2px solid rgba(0,168,132,0.12)',
                animation: 'callPulse 2s ease-out infinite 0.5s',
              }} />
            </>
          )}
          <div style={{
            width: 100, height: 100, borderRadius: '50%', overflow: 'hidden',
            boxShadow: '0 0 0 4px rgba(0,168,132,0.3), 0 8px 32px rgba(0,0,0,0.4)',
            position: 'relative',
          }}>
            <Avatar src={activeCall.peerInfo?.avatar_url} name={peerName} size="xl" />
          </div>
        </div>

        <h2 style={{ fontSize: 26, fontWeight: 700, color: '#fff', margin: 0, letterSpacing: '-0.3px' }}>{peerName}</h2>

        <p style={{
          marginTop: 8, fontSize: 14, fontWeight: 500,
          color: activeCall.status === 'answered' ? '#00c49a' : 'rgba(255,255,255,0.55)',
          letterSpacing: '0.02em',
        }}>
          {statusLabel}
          {(activeCall.status === 'calling' || activeCall.status === 'ringing') && (
            <span style={{ display: 'inline-block', animation: 'dotBlink 1.4s infinite' }}>…</span>
          )}
        </p>

        {/* Call type badge */}
        <div style={{
          marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: '6px 14px',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          {isVideo
            ? <Video size={14} style={{ color: '#00c49a' }} />
            : <Volume2 size={14} style={{ color: '#00c49a' }} />}
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
            {isVideo ? 'Video call' : 'Voice call'}
          </span>
        </div>
      </div>

      {/* Controls bar */}
      <div style={{
        padding: '28px 32px 44px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>

          {/* Mute */}
          <CallButton
            onClick={toggleMute}
            active={activeCall.isMuted}
            label={activeCall.isMuted ? 'Unmute' : 'Mute'}
            activeColor="#ef4444"
          >
            {activeCall.isMuted ? <MicOff size={22} color="#fff" /> : <Mic size={22} color="#fff" />}
          </CallButton>

          {/* End call */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <button onClick={handleHangup} style={{
              width: 68, height: 68, borderRadius: '50%',
              background: 'linear-gradient(135deg, #ff3b3b, #e00)',
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 24px rgba(220,0,0,0.5), 0 0 0 8px rgba(220,0,0,0.15)',
              transition: 'transform 0.15s',
            }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <PhoneOff size={26} color="#fff" />
            </button>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>End</span>
          </div>

          {/* Camera / Speaker */}
          {isVideo ? (
            <CallButton
              onClick={toggleCamera}
              active={!activeCall.isCameraOn}
              label={activeCall.isCameraOn ? 'Camera off' : 'Camera on'}
              activeColor="#ef4444"
            >
              {activeCall.isCameraOn ? <Video size={22} color="#fff" /> : <VideoOff size={22} color="#fff" />}
            </CallButton>
          ) : (
            <CallButton onClick={() => {
              setSpeaker((v) => {
                const next = !v;
                if (remoteAudioRef.current) remoteAudioRef.current.muted = !next;
                return next;
              });
            }} active={!speaker} label={speaker ? 'Speaker' : 'Muted spk'}>
              {speaker ? <Volume2 size={22} color="#fff" /> : <VolumeX size={22} color="#fff" />}
            </CallButton>
          )}
        </div>
      </div>

      <style>{`
        @keyframes callPulse {
          0%   { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes dotBlink {
          0%, 80%, 100% { opacity: 1; }
          40%            { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function CallButton({ children, onClick, active, label, activeColor = 'rgba(255,255,255,0.2)' }: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label?: string;
  activeColor?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <button onClick={onClick} style={{
        width: 56, height: 56, borderRadius: '50%',
        background: active ? activeColor : 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.1)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(8px)',
        transition: 'background 0.2s, transform 0.15s',
      }}
        onMouseEnter={(e) => (e.currentTarget.style.background = active ? activeColor : 'rgba(255,255,255,0.2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = active ? activeColor : 'rgba(255,255,255,0.12)')}
      >
        {children}
      </button>
      {label && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{label}</span>}
    </div>
  );
}
