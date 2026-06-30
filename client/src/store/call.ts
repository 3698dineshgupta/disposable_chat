import { create } from 'zustand';
import type { ActiveCall, CallType, CallStatus, IncomingCall } from '@/types';

interface CallState {
  activeCall: ActiveCall | null;
  incomingCall: IncomingCall | null;
  // ICE candidates that arrive before setupWebRTC registers its handler
  pendingIceCandidates: RTCIceCandidateInit[];

  startCall: (call: Omit<ActiveCall, 'startedAt' | 'isMuted' | 'isCameraOn' | 'isSpeakerOn' | 'isScreenSharing' | 'localStream' | 'remoteStream'>) => void;
  setCallStatus: (status: CallStatus) => void;
  setCallId: (callId: string) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  setMuted: (v: boolean) => void;
  setCameraOn: (v: boolean) => void;
  setSpeakerOn: (v: boolean) => void;
  setScreenSharing: (v: boolean) => void;
  endCall: () => void;
  setIncomingCall: (call: IncomingCall | null) => void;
  addPendingIceCandidate: (candidate: RTCIceCandidateInit) => void;
  drainPendingIceCandidates: () => RTCIceCandidateInit[];
}

export const useCallStore = create<CallState>()((set, get) => ({
  activeCall: null,
  incomingCall: null,
  pendingIceCandidates: [],

  startCall: (call) =>
    set({
      pendingIceCandidates: [], // clear any stale candidates from a previous call
      activeCall: {
        ...call,
        startedAt: Date.now(),
        isMuted: false,
        isCameraOn: call.type === 'video',
        isSpeakerOn: true,
        isScreenSharing: false,
        localStream: null,
        remoteStream: null,
      },
    }),
  setCallStatus: (status) =>
    set((s) => s.activeCall ? { activeCall: { ...s.activeCall, status } } : s),
  setCallId: (callId) =>
    set((s) => s.activeCall ? { activeCall: { ...s.activeCall, callId } } : s),
  setLocalStream: (stream) =>
    set((s) => s.activeCall ? { activeCall: { ...s.activeCall, localStream: stream } } : s),
  setRemoteStream: (stream) =>
    set((s) => s.activeCall ? { activeCall: { ...s.activeCall, remoteStream: stream } } : s),
  setMuted: (v) =>
    set((s) => s.activeCall ? { activeCall: { ...s.activeCall, isMuted: v } } : s),
  setCameraOn: (v) =>
    set((s) => s.activeCall ? { activeCall: { ...s.activeCall, isCameraOn: v } } : s),
  setSpeakerOn: (v) =>
    set((s) => s.activeCall ? { activeCall: { ...s.activeCall, isSpeakerOn: v } } : s),
  setScreenSharing: (v) =>
    set((s) => s.activeCall ? { activeCall: { ...s.activeCall, isScreenSharing: v } } : s),
  endCall: () =>
    set((s) => {
      if (s.activeCall?.localStream) {
        s.activeCall.localStream.getTracks().forEach(t => t.stop());
      }
      return { activeCall: null, pendingIceCandidates: [] };
    }),

  setIncomingCall: (call) => set({ incomingCall: call }),

  addPendingIceCandidate: (candidate) =>
    set((s) => ({ pendingIceCandidates: [...s.pendingIceCandidates, candidate] })),

  drainPendingIceCandidates: () => {
    const candidates = get().pendingIceCandidates;
    set({ pendingIceCandidates: [] });
    return candidates;
  },
}));
