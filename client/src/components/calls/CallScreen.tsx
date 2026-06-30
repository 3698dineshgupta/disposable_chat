'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  PhoneOff, Mic, MicOff, Video, VideoOff, Volume2, VolumeX,
  RotateCcw, Monitor, MonitorOff, MoreHorizontal, UserPlus, Minimize2,
} from 'lucide-react';
import { useCallStore } from '@/store/call';
import { getSocket } from '@/lib/socket';
import { callsApi } from '@/lib/api';
import Avatar from '@/components/ui/Avatar';
import { formatDuration } from '@/lib/utils';
import toast from 'react-hot-toast';

/* ─────────────────────────────────────────────────────
 * Constants
 * ───────────────────────────────────────────────────── */
const CALL_RING_TIMEOUT_MS = 45_000; // give up if no answer after 45 s
const LOG_PREFIX = '[WebRTC]';

const log = (...args: unknown[]) => console.log(LOG_PREFIX, ...args);
const warn = (...args: unknown[]) => console.warn(LOG_PREFIX, ...args);

/* ─────────────────────────────────────────────────────
 * ICE server helper
 * ───────────────────────────────────────────────────── */
const FALLBACK_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await callsApi.iceServers();
    const servers = res.data?.iceServers;
    if (Array.isArray(servers) && servers.length > 0) {
      log('ICE servers loaded from backend:', servers.map(s => JSON.stringify(s.urls)));
      return servers;
    }
  } catch (e) {
    warn('Could not fetch ICE servers from backend, using fallback STUN:', (e as Error).message);
  }
  return FALLBACK_ICE;
}

/* ─────────────────────────────────────────────────────
 * Component
 * ───────────────────────────────────────────────────── */
export default function CallScreen() {
  const {
    activeCall, endCall, setLocalStream, setRemoteStream,
    setMuted, setCameraOn, setCallStatus, setCallId,
  } = useCallStore();

  const [elapsed, setElapsed]                 = useState(0);
  const [speaker, setSpeaker]                 = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showMoreMenu, setShowMoreMenu]       = useState(false);
  const [facingMode, setFacingMode]           = useState<'user' | 'environment'>('user');
  const [isMinimized, setIsMinimized]         = useState(false);

  /* ── DOM refs ── */
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const moreMenuRef    = useRef<HTMLDivElement>(null);

  /* ── WebRTC state refs (not state — no re-render needed) ── */
  const peerRef        = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);     // BUG FIX: use ref, not store closure
  const screenStreamRef = useRef<MediaStream | null>(null);

  /* ── ICE buffering ── */
  const iceCandidateBuffer = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef   = useRef(false);

  /* ── Named socket handler refs (required for precise cleanup) ── */
  const iceHandlerRef           = useRef<((d: { candidate: RTCIceCandidateInit; from: string }) => void) | null>(null);
  const answeredHandlerRef      = useRef<((d: { callId: string; answer: RTCSessionDescriptionInit }) => void) | null>(null);
  const restartOfferHandlerRef  = useRef<((d: { offer: RTCSessionDescriptionInit; from: string }) => void) | null>(null);
  const restartAnswerHandlerRef = useRef<((d: { answer: RTCSessionDescriptionInit; from: string }) => void) | null>(null);

  /* ── Misc refs ── */
  const callTimeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialNegDoneRef   = useRef(false);
  const activeCallRef       = useRef(activeCall); // keep current ref for callbacks
  activeCallRef.current = activeCall;

  /* ─────────────────────────────────────────────────────
   * cleanup — stable ref, uses only refs (no stale closures)
   * ───────────────────────────────────────────────────── */
  const cleanup = useCallback(() => {
    log('cleanup called');

    // Cancel pending timers
    if (callTimeoutRef.current)     { clearTimeout(callTimeoutRef.current);     callTimeoutRef.current = null; }
    if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }

    // Stop media tracks via refs (not store closures — store may be stale)
    localStreamRef.current?.getTracks().forEach(t => { t.stop(); log(`stopped local track: ${t.kind}`); });
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    // Remove named socket handlers
    const socket = getSocket();
    if (iceHandlerRef.current)           { socket?.off('call:ice',        iceHandlerRef.current);           iceHandlerRef.current = null; }
    if (answeredHandlerRef.current)      { socket?.off('call:answered',   answeredHandlerRef.current);      answeredHandlerRef.current = null; }
    if (restartOfferHandlerRef.current)  { socket?.off('call:offer',      restartOfferHandlerRef.current);  restartOfferHandlerRef.current = null; }
    if (restartAnswerHandlerRef.current) { socket?.off('call:answer-sdp', restartAnswerHandlerRef.current); restartAnswerHandlerRef.current = null; }

    // Clear ICE buffer and flags
    iceCandidateBuffer.current = [];
    remoteDescSetRef.current   = false;
    initialNegDoneRef.current  = false;

    // Close RTCPeerConnection
    if (peerRef.current) {
      peerRef.current.onicecandidate       = null;
      peerRef.current.ontrack              = null;
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.onnegotiationneeded  = null;
      peerRef.current.onicegatheringstatechange = null;
      peerRef.current.close();
      peerRef.current = null;
    }

    // Clear media elements
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current)  localVideoRef.current.srcObject = null;
  }, []); // stable — only uses refs

  /* ─────────────────────────────────────────────────────
   * ICE candidate helpers
   * ───────────────────────────────────────────────────── */
  const addIceCandidate = async (pc: RTCPeerConnection, candidate: RTCIceCandidateInit) => {
    try {
      if (pc.signalingState !== 'closed' && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        iceCandidateBuffer.current.push(candidate);
      }
    } catch (e) {
      warn('addIceCandidate failed:', (e as Error).message);
    }
  };

  const flushIceCandidates = async (pc: RTCPeerConnection) => {
    remoteDescSetRef.current = true;
    const buffered = [...iceCandidateBuffer.current];
    iceCandidateBuffer.current = [];
    log(`flushing ${buffered.length} buffered ICE candidates`);
    for (const c of buffered) {
      try {
        if (pc.signalingState !== 'closed') await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) { warn('flush ICE candidate failed:', (e as Error).message); }
    }
  };

  /* ─────────────────────────────────────────────────────
   * setupWebRTC
   * ───────────────────────────────────────────────────── */
  const setupWebRTC = async () => {
    const call = activeCallRef.current;
    if (!call) return;

    const socket = getSocket();
    if (!socket?.connected) throw new Error('Socket not connected');

    log(`setupWebRTC: callId=${call.callId} isInitiator=${call.isInitiator} type=${call.type}`);

    /* Fetch ICE servers (includes TURN if configured on backend) */
    const iceServers = await getIceServers();

    const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 10 });
    peerRef.current = pc;
    initialNegDoneRef.current = false;

    /* ── Get local media ── */
    let localStream: MediaStream | null = null;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: call.type === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
    } catch {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (call.type === 'video') toast('Camera unavailable — audio only', { icon: '🎤' });
      } catch (e) {
        warn('no media available:', (e as Error).message);
        toast('Microphone unavailable', { icon: '🔇' });
      }
    }

    if (localStream) {
      localStreamRef.current = localStream;
      setLocalStream(localStream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
        localVideoRef.current.play().catch(() => {});
      }
      localStream.getTracks().forEach(t => {
        pc.addTrack(t, localStream!);
        log(`added local track: ${t.kind}`);
      });
    }

    /* ── Remote track routing ── */
    pc.ontrack = (e) => {
      log(`ontrack: kind=${e.track.kind} streams=${e.streams.length}`);
      const track = e.track;
      if (track.kind === 'audio') {
        if (remoteAudioRef.current) {
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
      if (e.streams?.[0]) setRemoteStream(e.streams[0]);
    };

    /* ── Trickle ICE — send candidates as they arrive ── */
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        log(`sending ICE candidate: ${e.candidate.type} ${e.candidate.protocol}`);
        socket.emit('call:ice', { peerId: call.peerId, candidate: e.candidate });
      } else {
        log('ICE gathering complete');
      }
    };

    /* ── Receive ICE candidates from peer ── */
    const iceHandler = ({ candidate }: { candidate: RTCIceCandidateInit; from: string }) => {
      addIceCandidate(pc, candidate);
    };
    iceHandlerRef.current = iceHandler;
    socket.on('call:ice', iceHandler);

    /* ── Connection state monitoring ── */
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      log(`connection state: ${state}`);
      if (state === 'disconnected') {
        disconnectTimerRef.current = setTimeout(() => {
          if (peerRef.current?.connectionState === 'disconnected' || peerRef.current?.connectionState === 'failed') {
            log('attempting ICE restart after disconnect');
            peerRef.current?.restartIce();
          }
        }, 4000);
      } else if (state === 'connected') {
        if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }
        log('peers connected!');
      } else if (state === 'failed') {
        if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }
        warn('connection failed');
        toast.error('Call connection lost');
        setCallStatus('failed');
      }
    };

    /* ── ICE restart (renegotiation after initial setup) ── */
    pc.onnegotiationneeded = async () => {
      if (!initialNegDoneRef.current) return; // skip first fire from addTrack
      const currentCall = activeCallRef.current;
      if (!currentCall?.isInitiator || pc.signalingState === 'closed') return;
      log('onnegotiationneeded: sending restart offer');
      try {
        const restartOffer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(restartOffer);
        socket.emit('call:offer', { peerId: currentCall.peerId, offer: pc.localDescription });
      } catch (err) { warn('restart offer failed:', (err as Error).message); }
    };

    /* ── ICE restart handlers (responder side) ── */
    const restartOfferHandler = async ({ offer }: { offer: RTCSessionDescriptionInit; from: string }) => {
      const currentCall = activeCallRef.current;
      if (currentCall?.isInitiator || pc.signalingState === 'closed') return;
      log('received restart offer, sending restart answer');
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushIceCandidates(pc);
        const restartAnswer = await pc.createAnswer();
        await pc.setLocalDescription(restartAnswer);
        socket.emit('call:answer-sdp', { peerId: currentCall!.peerId, answer: pc.localDescription });
      } catch (err) { warn('restart answer failed:', (err as Error).message); }
    };
    restartOfferHandlerRef.current = restartOfferHandler;
    socket.on('call:offer', restartOfferHandler);

    const restartAnswerHandler = async ({ answer }: { answer: RTCSessionDescriptionInit; from: string }) => {
      const currentCall = activeCallRef.current;
      if (!currentCall?.isInitiator || pc.signalingState === 'closed') return;
      log('received restart answer');
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await flushIceCandidates(pc);
      } catch (err) { warn('restart setAnswer failed:', (err as Error).message); }
    };
    restartAnswerHandlerRef.current = restartAnswerHandler;
    socket.on('call:answer-sdp', restartAnswerHandler);

    /* ────────────────────────────────────────────────────
     * TRICKLE ICE: send offer/answer IMMEDIATELY after
     * setLocalDescription — do NOT wait for ICE gathering.
     * ICE candidates stream via separate call:ice events.
     * ──────────────────────────────────────────────────── */
    if (call.isInitiator) {
      /* ─── CALLER path ─── */
      if (pc.signalingState === 'closed') return;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      initialNegDoneRef.current = true;
      log('created offer, sending call:initiate');

      /* Register answer handler BEFORE emitting — avoids race if callee answers instantly */
      const answeredHandler = async ({ callId: incomingCallId, answer }: { callId: string; answer: RTCSessionDescriptionInit }) => {
        log(`received call:answered callId=${incomingCallId}`);
        try {
          if (pc.signalingState !== 'closed') {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            await flushIceCandidates(pc);
            setCallStatus('answered');
            if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
            log('remote description set from answer');
          }
        } catch (err) { warn('set answer failed:', (err as Error).message); }
      };
      answeredHandlerRef.current = answeredHandler;
      socket.on('call:answered', answeredHandler);

      /* Ring timeout — emit missed and clean up if no answer */
      callTimeoutRef.current = setTimeout(() => {
        const c = activeCallRef.current;
        if (c && (c.status === 'calling' || c.status === 'ringing')) {
          log('call ring timeout — missed');
          toast('No answer', { icon: '📵' });
          socket.emit('call:missed', { callId: c.callId });
          socket.emit('call:end',    { callId: c.callId, peerId: c.peerId, duration: 0 });
          cleanup();
          endCall();
        }
      }, CALL_RING_TIMEOUT_MS);

      /* Emit the initiate event with the offer — trickle ICE starts flowing */
      socket.emit('call:initiate', {
        calleeId:       call.peerId,
        type:           call.type,
        conversationId: call.conversationId,
        offer:          pc.localDescription,  // send immediately, don't wait for ICE
      }, (res: { callId?: string; error?: string }) => {
        if (res?.error) {
          warn('call:initiate error:', res.error);
          toast.error('Could not reach the other user');
          setCallStatus('failed');
          cleanup();
          endCall();
          return;
        }
        if (res?.callId) {
          setCallId(res.callId);
          log('call:initiate ack, callId=', res.callId);
        }
      });

    } else {
      /* ─── CALLEE path ─── */
      const incomingOffer = call.incomingOffer;
      if (!incomingOffer) {
        warn('incoming offer missing');
        toast.error('Call failed: no offer received');
        setCallStatus('failed');
        return;
      }
      if (pc.signalingState === 'closed') return;

      log('setting remote description from incoming offer');
      await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
      await flushIceCandidates(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      initialNegDoneRef.current = true;
      log('created answer, sending call:answer');

      socket.emit('call:answer', {
        callId:   call.callId,
        callerId: call.peerId,
        answer:   pc.localDescription,  // send immediately, don't wait for ICE
      });
    }
  };

  /* ─────────────────────────────────────────────────────
   * Effect: run WebRTC when a call starts
   * ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!activeCall) return;

    const timer = setInterval(() =>
      setElapsed(Math.floor((Date.now() - activeCall.startedAt) / 1000)), 1000);

    setupWebRTC().catch((err) => {
      warn('unhandled setupWebRTC error:', err);
      toast.error('Call failed: ' + ((err as Error)?.message ?? 'unknown'));
      setCallStatus('failed');
    });

    return () => { clearInterval(timer); cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.startedAt]);

  /* ── Close more-menu on outside click ── */
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

  /* ─────────────────────────────────────────────────────
   * Control handlers
   * ───────────────────────────────────────────────────── */
  const handleHangup = () => {
    if (activeCall) {
      getSocket()?.emit('call:end', { callId: activeCall.callId, peerId: activeCall.peerId, duration: elapsed });
    }
    cleanup();
    endCall();
  };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const newMuted = !(activeCall?.isMuted ?? false);
    stream.getAudioTracks().forEach(t => (t.enabled = !newMuted));
    setMuted(newMuted);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const newOff = activeCall?.isCameraOn ?? false;
    stream.getVideoTracks().forEach(t => (t.enabled = !newOff));
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
    if (!localStreamRef.current || !peerRef.current) return;
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: newFacing },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = peerRef.current.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
      if (localVideoRef.current) {
        const combined = new MediaStream([...localStreamRef.current.getAudioTracks(), newTrack]);
        localVideoRef.current.srcObject = combined;
        localVideoRef.current.play().catch(() => {});
      }
      setFacingMode(newFacing);
    } catch { toast.error('Could not switch camera'); }
  }, [facingMode]);

  const startScreenShare = async () => {
    if (!peerRef.current) return;
    setShowMoreMenu(false);
    try {
      const screenStream = await (navigator.mediaDevices as unknown as { getDisplayMedia: (c: object) => Promise<MediaStream> })
        .getDisplayMedia({ video: true, audio: false });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = peerRef.current.getSenders().find(s => s.track?.kind === 'video');
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
    if (!peerRef.current || !localStreamRef.current) return;
    const cameraTrack = localStreamRef.current.getVideoTracks()[0];
    const sender = peerRef.current.getSenders().find(s => s.track?.kind === 'video');
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch(() => {});
    }
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    setIsScreenSharing(false);
  };

  if (!activeCall) return null;

  const isVideo    = activeCall.type === 'video';
  const peerName   = activeCall.peerInfo?.display_name ?? 'User';
  const isCalling  = activeCall.status === 'calling' || activeCall.status === 'ringing';
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
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      <video ref={remoteVideoRef} autoPlay playsInline muted
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', display: isVideo ? 'block' : 'none',
          opacity: isVideo && isAnswered ? 1 : 0,
          transition: 'opacity 0.6s',
        }}
      />

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
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px' }}>{peerName}</div>
          <div style={{
            fontSize: 13, fontWeight: 500, marginTop: 2,
            color: isAnswered ? '#00e5b0' : 'rgba(255,255,255,0.6)',
          }}>{statusLabel}</div>
          {isScreenSharing && (
            <div style={{ fontSize: 11, color: '#60d9b0', marginTop: 2 }}>● Sharing screen</div>
          )}
        </div>
        <TopBtn title="Add participant"><UserPlus size={18} color="#fff" /></TopBtn>
      </div>

      {/* ── CENTER AVATAR ── */}
      {(!isVideo || !isAnswered) && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ position: 'relative', marginBottom: 24 }}>
            {isCalling && (
              <>
                <div style={{ position: 'absolute', inset: -20, borderRadius: '50%', border: '2px solid rgba(0,168,132,0.25)', animation: 'callPulse 2s ease-out infinite' }} />
                <div style={{ position: 'absolute', inset: -40, borderRadius: '50%', border: '2px solid rgba(0,168,132,0.12)', animation: 'callPulse 2s ease-out infinite 0.5s' }} />
              </>
            )}
            <div style={{ width: 100, height: 100, borderRadius: '50%', overflow: 'hidden', boxShadow: '0 0 0 4px rgba(0,168,132,0.3), 0 8px 32px rgba(0,0,0,0.4)' }}>
              <Avatar src={activeCall.peerInfo?.avatar_url} name={peerName} size="xl" />
            </div>
          </div>
        </div>
      )}

      {/* ── LOCAL VIDEO PiP ── */}
      {isVideo && (
        <div style={{
          position: 'absolute', bottom: 110, right: 12,
          width: 110, height: 150, borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 6px 28px rgba(0,0,0,0.5)', border: '2px solid rgba(255,255,255,0.12)',
        }}>
          <video ref={localVideoRef} autoPlay playsInline muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          <button onClick={flipCamera} style={{
            position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: '50%',
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
        padding: '18px 20px 40px', background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-evenly' }}>

          {/* ⋯ More options */}
          <div style={{ position: 'relative' }}>
            <CtrlBtn onClick={() => setShowMoreMenu(v => !v)} active={showMoreMenu}>
              <MoreHorizontal size={22} color="#fff" />
            </CtrlBtn>
            {showMoreMenu && (
              <div ref={moreMenuRef} style={{
                position: 'absolute', bottom: 64, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(24,24,24,0.97)', borderRadius: 14,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)',
                minWidth: 180, overflow: 'hidden', animation: 'ctxMenuIn 0.12s ease-out',
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
              {activeCall.isCameraOn ? <Video size={22} color="#fff" /> : <VideoOff size={22} color="#fff" />}
            </CtrlBtn>
          ) : (
            <CtrlBtn onClick={toggleSpeaker} active={!speaker}>
              {speaker ? <Volume2 size={22} color="#fff" /> : <VolumeX size={22} color="#fff" />}
            </CtrlBtn>
          )}

          {/* End call */}
          <button onClick={handleHangup} style={{
            width: 62, height: 62, borderRadius: '50%',
            background: '#e53935', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(229,57,53,0.55)', transition: 'transform 0.12s, box-shadow 0.12s',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(229,57,53,0.75)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(229,57,53,0.55)'; }}
          >
            <PhoneOff size={24} color="#fff" />
          </button>

          {/* Mute mic */}
          <CtrlBtn onClick={toggleMute} active={activeCall.isMuted}>
            {activeCall.isMuted ? <MicOff size={22} color="#fff" /> : <Mic size={22} color="#fff" />}
          </CtrlBtn>

          {/* Speaker (video calls only) */}
          {isVideo && (
            <CtrlBtn onClick={toggleSpeaker} active={!speaker}>
              {speaker ? <Volume2 size={22} color="#fff" /> : <VolumeX size={22} color="#fff" />}
            </CtrlBtn>
          )}
        </div>
      </div>

      <style>{`
        @keyframes callPulse {
          0%   { transform: scale(1);   opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes ctxMenuIn {
          from { opacity: 0; transform: translateX(-50%) scale(0.94) translateY(6px); }
          to   { opacity: 1; transform: translateX(-50%) scale(1)    translateY(0);   }
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
 * Sub-components
 * ───────────────────────────────────────────────────── */
function TopBtn({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 40, height: 40, borderRadius: '50%',
      background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)',
      cursor: onClick ? 'pointer' : 'default',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(8px)', transition: 'background 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.35)')}
    >
      {children}
    </button>
  );
}

function CtrlBtn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} style={{
      width: 52, height: 52, borderRadius: '50%',
      background: active ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)',
      border: '1px solid rgba(255,255,255,0.08)',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(8px)', transition: 'background 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.22)')}
      onMouseLeave={e => (e.currentTarget.style.background = active ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)')}
    >
      {children}
    </button>
  );
}

function MoreMenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
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
