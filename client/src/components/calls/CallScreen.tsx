'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  PhoneOff, Mic, MicOff, Video, VideoOff, Volume2, VolumeX,
  RotateCcw, Monitor, MonitorOff, MoreHorizontal, UserPlus, Minimize2,
} from 'lucide-react';
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

  const [elapsed, setElapsed]               = useState(0);
  const [speaker, setSpeaker]               = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showMoreMenu, setShowMoreMenu]     = useState(false);
  const [facingMode, setFacingMode]         = useState<'user' | 'environment'>('user');
  const [isMinimized, setIsMinimized]       = useState(false);

  const localVideoRef   = useRef<HTMLVideoElement>(null);
  const remoteVideoRef  = useRef<HTMLVideoElement>(null);  // muted — video only
  const remoteAudioRef  = useRef<HTMLAudioElement>(null);  // audio only
  const peerRef         = useRef<RTCPeerConnection | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const moreMenuRef     = useRef<HTMLDivElement>(null);

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

  /* Close more-menu on outside click */
  useEffect(() => {
    if (!showMoreMenu) return;
    const close = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showMoreMenu]);

  const waitForIce = (pc: RTCPeerConnection): Promise<void> =>
    new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const done = () => {
        if (pc.iceGatheringState === 'complete') { pc.onicegatheringstatechange = null; resolve(); }
      };
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

    /* Get local media */
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: activeCall.type === 'video',
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setLocalStream(stream);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      } catch (err: any) {
        console.warn('[WebRTC] no media available:', err.message);
        toast('Microphone unavailable', { icon: '🔇' });
      }
    }

    /*
     * Route remote tracks separately:
     * - audio → hidden <audio> element (avoids browser autoplay restrictions on <video> with audio)
     * - video → muted <video> element (autoplay always works for muted video)
     */
    pc.ontrack = (e) => {
      const track = e.track;
      if (track.kind === 'audio') {
        if (remoteAudioRef.current) {
          // Build or reuse a MediaStream for audio
          if (!(remoteAudioRef.current.srcObject instanceof MediaStream)) {
            remoteAudioRef.current.srcObject = new MediaStream();
          }
          (remoteAudioRef.current.srcObject as MediaStream).addTrack(track);
          remoteAudioRef.current.muted = !speaker;
          remoteAudioRef.current.play().catch(() => {});
        }
      } else if (track.kind === 'video') {
        if (remoteVideoRef.current) {
          if (!(remoteVideoRef.current.srcObject instanceof MediaStream)) {
            remoteVideoRef.current.srcObject = new MediaStream();
          }
          (remoteVideoRef.current.srcObject as MediaStream).addTrack(track);
          remoteVideoRef.current.play().catch(() => {});
        }
      }
      // Also store in call store for external consumers
      if (e.streams?.[0]) setRemoteStream(e.streams[0]);
    };

    /* ICE candidate exchange */
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('call:ice', { peerId: activeCall.peerId, candidate: e.candidate });
    };

    const iceHandler = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try {
        if (pc.signalingState !== 'closed') await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    };
    socket.on('call:ice', iceHandler);

    /* Connection state monitoring */
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'disconnected') {
        disconnectTimer = setTimeout(() => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            pc.restartIce();
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

    /*
     * onnegotiationneeded is used ONLY for ICE restarts after initial setup.
     * We skip the first fire (triggered by addTrack) to avoid conflicting with
     * the manual offer/answer below.
     */
    let initialNegotiationDone = false;
    pc.onnegotiationneeded = async () => {
      if (!initialNegotiationDone) return;
      if (!activeCall.isInitiator || pc.signalingState === 'closed') return;
      try {
        const restartOffer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(restartOffer);
        await waitForIce(pc);
        socket.emit('call:offer', { peerId: activeCall.peerId, offer: pc.localDescription });
      } catch (err) { console.error('[WebRTC] restart offer failed:', err); }
    };

    /* ICE restart handlers (responder side) */
    const restartOfferHandler = async ({ offer }: { offer: RTCSessionDescriptionInit }) => {
      if (activeCall.isInitiator || pc.signalingState === 'closed') return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const restartAnswer = await pc.createAnswer();
        await pc.setLocalDescription(restartAnswer);
        await waitForIce(pc);
        socket.emit('call:answer-sdp', { peerId: activeCall.peerId, answer: pc.localDescription });
      } catch (err) { console.error('[WebRTC] restart answer failed:', err); }
    };
    socket.on('call:offer', restartOfferHandler);

    const restartAnswerHandler = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      if (!activeCall.isInitiator || pc.signalingState === 'closed') return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) { console.error('[WebRTC] restart setAnswer failed:', err); }
    };
    socket.on('call:answer-sdp', restartAnswerHandler);

    /* ── Initial offer/answer exchange ── */
    if (activeCall.status === 'calling') {
      /* CALLER: create offer, send to callee */
      if (pc.signalingState === 'closed') return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);
      initialNegotiationDone = true;

      socket.once('call:answered', async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
        try {
          if (pc.signalingState !== 'closed') {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            setCallStatus('answered');
          }
        } catch (err) { console.error('[WebRTC] set answer failed:', err); }
      });

      socket.emit('call:initiate', {
        calleeId:       activeCall.peerId,
        type:           activeCall.type,
        conversationId: activeCall.conversationId,
        offer:          pc.localDescription,
      }, (res: { callId?: string; error?: string }) => {
        if (res?.error) { toast.error('Could not reach the other user'); setCallStatus('failed'); return; }
        if (res?.callId) setCallId(res.callId);
      });

    } else {
      /* CALLEE: answer the incoming offer */
      const offer = activeCall.incomingOffer;
      if (!offer) { toast.error('Incoming offer missing'); setCallStatus('failed'); return; }
      if (pc.signalingState === 'closed') return;

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce(pc);
      initialNegotiationDone = true;

      socket.emit('call:answer', {
        callId:   activeCall.callId,
        callerId: activeCall.peerId,
        answer:   pc.localDescription,
      });
    }
  };

  const cleanup = () => {
    activeCall?.localStream?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    getSocket()?.off('call:ice');
    getSocket()?.off('call:answered');
    getSocket()?.off('call:offer');
    getSocket()?.off('call:answer-sdp');
    // Clear media elements
    if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = null; }
    if (remoteVideoRef.current)  { remoteVideoRef.current.srcObject = null; }
    if (localVideoRef.current)   { localVideoRef.current.srcObject = null; }
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

  const toggleSpeaker = () => {
    const next = !speaker;
    setSpeaker(next);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !next;
      if (next) remoteAudioRef.current.play().catch(() => {});
    }
  };

  const flipCamera = useCallback(async () => {
    if (!activeCall?.localStream || !peerRef.current) return;
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: newFacing },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = peerRef.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
      if (localVideoRef.current) {
        const combined = new MediaStream([...activeCall.localStream.getAudioTracks(), newTrack]);
        localVideoRef.current.srcObject = combined;
        localVideoRef.current.play().catch(() => {});
      }
      setFacingMode(newFacing);
    } catch {
      toast.error('Could not switch camera');
    }
  }, [facingMode, activeCall]);

  const startScreenShare = async () => {
    if (!peerRef.current) return;
    setShowMoreMenu(false);
    try {
      const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = peerRef.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(screenTrack);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = screenStream;
        localVideoRef.current.play().catch(() => {});
      }
      screenStreamRef.current = screenStream;
      setIsScreenSharing(true);
      screenTrack.onended = stopScreenShare;
    } catch { /* user cancelled */ }
  };

  const stopScreenShare = async () => {
    if (!peerRef.current || !activeCall?.localStream) return;
    const cameraTrack = activeCall.localStream.getVideoTracks()[0];
    const sender = peerRef.current.getSenders().find((s) => s.track?.kind === 'video');
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = activeCall.localStream;
      localVideoRef.current.play().catch(() => {});
    }
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setIsScreenSharing(false);
  };

  if (!activeCall) return null;

  const isVideo   = activeCall.type === 'video';
  const peerName  = activeCall.peerInfo?.display_name ?? 'User';
  const isCalling = activeCall.status === 'calling' || activeCall.status === 'ringing';
  const isAnswered = activeCall.status === 'answered';
  const statusLabel =
    activeCall.status === 'calling'  ? 'Calling…'             :
    activeCall.status === 'ringing'  ? 'Ringing…'             :
    isAnswered                        ? formatDuration(elapsed) :
    activeCall.status === 'failed'   ? 'Call failed'          : activeCall.status;

  /* ── Minimized floating bubble ── */
  if (isMinimized) {
    return (
      <div onClick={() => setIsMinimized(false)} style={{
        position: 'fixed', bottom: 80, right: 16, zIndex: 100,
        width: 72, height: 72, borderRadius: '50%', cursor: 'pointer',
        overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        border: '2px solid rgba(0,168,132,0.6)',
      }}>
        <Avatar src={activeCall.peerInfo?.avatar_url} name={peerName} size="xl" />
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 6,
        }}>
          <span style={{ fontSize: 10, color: '#fff', fontWeight: 600 }}>
            {isAnswered ? formatDuration(elapsed) : '…'}
          </span>
        </div>
        {/* Keep audio alive in minimized mode */}
        <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'linear-gradient(160deg, #0d1b2a 0%, #0d2137 60%, #071a14 100%)',
      fontFamily: 'inherit', userSelect: 'none',
    }}>
      {/* Audio element for remote voice — always present, never muted by default */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Remote video — full screen, muted (audio handled by audio element above) */}
      <video ref={remoteVideoRef} autoPlay playsInline muted
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', display: isVideo ? 'block' : 'none',
          opacity: isVideo && isAnswered ? 1 : 0,
          transition: 'opacity 0.6s',
        }}
      />

      {/* Overlay gradient */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 28%, transparent 62%, rgba(0,0,0,0.7) 100%)',
      }} />

      {/* ── TOP BAR ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '52px 16px 16px',
      }}>
        <TopBtn onClick={() => setIsMinimized(true)} title="Minimize">
          <Minimize2 size={18} color="#fff" />
        </TopBtn>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px' }}>
            {peerName}
          </div>
          <div style={{
            fontSize: 13, fontWeight: 500, marginTop: 2,
            color: isAnswered ? '#00e5b0' : 'rgba(255,255,255,0.6)',
          }}>
            {statusLabel}
          </div>
          {isScreenSharing && (
            <div style={{ fontSize: 11, color: '#60d9b0', marginTop: 2 }}>● Sharing screen</div>
          )}
        </div>

        <TopBtn title="Add participant">
          <UserPlus size={18} color="#fff" />
        </TopBtn>
      </div>

      {/* ── CENTER AVATAR (voice calls always; video calls while waiting) ── */}
      {(!isVideo || !isAnswered) && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ position: 'relative', marginBottom: 24 }}>
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
            }}>
              <Avatar src={activeCall.peerInfo?.avatar_url} name={peerName} size="xl" />
            </div>
          </div>
        </div>
      )}

      {/* ── LOCAL VIDEO PiP (video calls only) ── */}
      {isVideo && (
        <div style={{
          position: 'absolute', bottom: 110, right: 12,
          width: 110, height: 150, borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 6px 28px rgba(0,0,0,0.5)',
          border: '2px solid rgba(255,255,255,0.12)',
        }}>
          <video ref={localVideoRef} autoPlay playsInline muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          <button onClick={flipCamera} style={{
            position: 'absolute', top: 6, right: 6,
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} title="Flip camera">
            <RotateCcw size={13} color="#fff" />
          </button>
        </div>
      )}

      {/* ── BOTTOM CONTROL BAR ── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '18px 20px 40px',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-evenly' }}>

          {/* ⋯ More options */}
          <div style={{ position: 'relative' }}>
            <CtrlBtn onClick={() => setShowMoreMenu((v) => !v)} active={showMoreMenu}>
              <MoreHorizontal size={22} color="#fff" />
            </CtrlBtn>
            {showMoreMenu && (
              <div ref={moreMenuRef} style={{
                position: 'absolute', bottom: 64, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(24,24,24,0.97)', borderRadius: 14,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                border: '1px solid rgba(255,255,255,0.1)',
                minWidth: 180, overflow: 'hidden',
                animation: 'ctxMenuIn 0.12s ease-out',
              }}>
                {isVideo && (
                  <MoreMenuItem
                    icon={isScreenSharing ? <MonitorOff size={16} /> : <Monitor size={16} />}
                    label={isScreenSharing ? 'Stop sharing' : 'Share screen'}
                    onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                  />
                )}
                <MoreMenuItem
                  icon={activeCall.isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                  label={activeCall.isMuted ? 'Unmute' : 'Mute microphone'}
                  onClick={() => { toggleMute(); setShowMoreMenu(false); }}
                />
              </div>
            )}
          </div>

          {/* Camera (video) or Speaker (audio) */}
          {isVideo ? (
            <CtrlBtn onClick={toggleCamera} active={!activeCall.isCameraOn}>
              {activeCall.isCameraOn
                ? <Video size={22} color="#fff" />
                : <VideoOff size={22} color="#fff" />}
            </CtrlBtn>
          ) : (
            <CtrlBtn onClick={toggleSpeaker} active={!speaker}>
              {speaker ? <Volume2 size={22} color="#fff" /> : <VolumeX size={22} color="#fff" />}
            </CtrlBtn>
          )}

          {/* End call — red, center */}
          <button onClick={handleHangup} style={{
            width: 62, height: 62, borderRadius: '50%',
            background: '#e53935', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(229,57,53,0.55)',
            transition: 'transform 0.12s, box-shadow 0.12s',
          }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              e.currentTarget.style.boxShadow = '0 6px 28px rgba(229,57,53,0.75)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(229,57,53,0.55)';
            }}
          >
            <PhoneOff size={24} color="#fff" />
          </button>

          {/* Mute mic */}
          <CtrlBtn onClick={toggleMute} active={activeCall.isMuted}>
            {activeCall.isMuted ? <MicOff size={22} color="#fff" /> : <Mic size={22} color="#fff" />}
          </CtrlBtn>

          {/* Speaker (video calls only — separate from camera toggle) */}
          {isVideo && (
            <CtrlBtn onClick={toggleSpeaker} active={!speaker}>
              {speaker ? <Volume2 size={22} color="#fff" /> : <VolumeX size={22} color="#fff" />}
            </CtrlBtn>
          )}
        </div>
      </div>

      <style>{`
        @keyframes callPulse {
          0%   { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes ctxMenuIn {
          from { opacity: 0; transform: translateX(-50%) scale(0.94) translateY(6px); }
          to   { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

function TopBtn({ children, onClick, title }: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 40, height: 40, borderRadius: '50%',
      background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)',
      cursor: onClick ? 'pointer' : 'default',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(8px)', transition: 'background 0.15s',
    }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.35)')}
    >
      {children}
    </button>
  );
}

function CtrlBtn({ children, onClick, active }: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      width: 52, height: 52, borderRadius: '50%',
      background: active ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)',
      border: '1px solid rgba(255,255,255,0.08)',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(8px)', transition: 'background 0.15s',
    }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.22)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = active ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)')}
    >
      {children}
    </button>
  );
}

function MoreMenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '12px 16px', border: 'none', cursor: 'pointer',
        background: hov ? 'rgba(255,255,255,0.1)' : 'transparent',
        color: '#fff', fontSize: 13.5, fontWeight: 500, fontFamily: 'inherit',
        textAlign: 'left', transition: 'background 0.1s',
      }}
    >
      {icon} {label}
    </button>
  );
}
