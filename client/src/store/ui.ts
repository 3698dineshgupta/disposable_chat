import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light' | 'system';
type ActivePanel = 'chats' | 'status' | 'calls' | 'contacts' | 'settings';

interface UIState {
  theme: Theme;
  activePanel: ActivePanel;
  activeConversationId: string | null;
  showProfilePanel: boolean;
  showSearchPanel: boolean;
  showNewChatModal: boolean;
  showNewGroupModal: boolean;
  showEmojiPicker: boolean;
  isMobileView: boolean;
  showChatOnMobile: boolean;

  setTheme: (theme: Theme) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setActiveConversation: (id: string | null) => void;
  toggleProfilePanel: () => void;
  setProfilePanel: (v: boolean) => void;
  toggleSearchPanel: () => void;
  setNewChatModal: (v: boolean) => void;
  setNewGroupModal: (v: boolean) => void;
  setEmojiPicker: (v: boolean) => void;
  setMobileView: (v: boolean) => void;
  setShowChatOnMobile: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      activePanel: 'chats',
      activeConversationId: null,
      showProfilePanel: false,
      showSearchPanel: false,
      showNewChatModal: false,
      showNewGroupModal: false,
      showEmojiPicker: false,
      isMobileView: false,
      showChatOnMobile: false,

      setTheme: (theme) => set({ theme }),
      setActivePanel: (panel) => set({ activePanel: panel }),
      setActiveConversation: (id) => set({ activeConversationId: id, showChatOnMobile: !!id }),
      toggleProfilePanel: () => set((s) => ({ showProfilePanel: !s.showProfilePanel })),
      setProfilePanel: (v) => set({ showProfilePanel: v }),
      toggleSearchPanel: () => set((s) => ({ showSearchPanel: !s.showSearchPanel })),
      setNewChatModal: (v) => set({ showNewChatModal: v }),
      setNewGroupModal: (v) => set({ showNewGroupModal: v }),
      setEmojiPicker: (v) => set({ showEmojiPicker: v }),
      setMobileView: (v) => set({ isMobileView: v }),
      setShowChatOnMobile: (v) => set({ showChatOnMobile: v }),
    }),
    {
      name: 'zapchat-ui-v2',   // bumped version clears old dark-mode localStorage
      partialize: (state) => ({ theme: state.theme, activePanel: state.activePanel }),
      skipHydration: true,
    }
  )
);
