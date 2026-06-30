import { create } from 'zustand';
import type { WritingStyleProfile } from '@/types';

interface AIState {
  /* Per-conversation: is AI auto-reply on? */
  autoReplyEnabled: Record<string, boolean>;
  /* Per-conversation: is AI currently generating a reply? */
  isGenerating: Record<string, boolean>;
  /* User's writing style profile (loaded once, updated periodically) */
  styleProfile: WritingStyleProfile | null;
  styleProfileLoaded: boolean;
  /* Global AI availability flag */
  aiAvailable: boolean;

  setAutoReply: (convId: string, enabled: boolean) => void;
  setGenerating: (convId: string, generating: boolean) => void;
  setStyleProfile: (profile: WritingStyleProfile | null) => void;
  setAIAvailable: (available: boolean) => void;
  bulkSetAutoReply: (settings: Record<string, boolean>) => void;
}

export const useAIStore = create<AIState>()((set) => ({
  autoReplyEnabled: {},
  isGenerating: {},
  styleProfile: null,
  styleProfileLoaded: false,
  aiAvailable: true,

  setAutoReply: (convId, enabled) =>
    set((s) => ({ autoReplyEnabled: { ...s.autoReplyEnabled, [convId]: enabled } })),

  setGenerating: (convId, generating) =>
    set((s) => ({ isGenerating: { ...s.isGenerating, [convId]: generating } })),

  setStyleProfile: (profile) =>
    set({ styleProfile: profile, styleProfileLoaded: true }),

  setAIAvailable: (available) => set({ aiAvailable: available }),

  bulkSetAutoReply: (settings) =>
    set((s) => ({ autoReplyEnabled: { ...s.autoReplyEnabled, ...settings } })),
}));
