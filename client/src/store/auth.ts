import { create } from 'zustand';
import type { User } from '@/types';
import { setAccessToken } from '@/lib/api';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isInitializing: boolean;

  setUser: (user: User | null) => void;
  setAccessToken: (token: string | null) => void;
  setInitializing: (v: boolean) => void;
  login: (user: User, token: string) => void;
  logout: () => void;
  updateUser: (partial: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isInitializing: true,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setAccessToken: (token) => {
    setAccessToken(token);
    set({ accessToken: token });
  },
  setInitializing: (v) => set({ isInitializing: v }),
  login: (user, token) => {
    setAccessToken(token);
    set({ user, accessToken: token, isAuthenticated: true });
  },
  logout: () => {
    setAccessToken(null);
    set({ user: null, accessToken: null, isAuthenticated: false });
  },
  updateUser: (partial) => {
    const current = get().user;
    if (current) set({ user: { ...current, ...partial } });
  },
}));
