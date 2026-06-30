'use client';

import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { useSocketSetup } from '@/hooks/useSocket';
import { useAutoReply } from '@/hooks/useAutoReply';
import { useAIStore } from '@/store/ai';
import { authApi, aiApi, setAccessToken } from '@/lib/api';
import { getMessages } from '@/lib/db/index';
import { useChatStore } from '@/store/chat';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
    mutations: { retry: 0 },
  },
});

function ThemeManager() {
  const { theme } = useUIStore();
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (dark: boolean) => {
      root.classList.toggle('dark', dark);
    };
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyTheme(theme === 'dark');
    }
  }, [theme]);
  return null;
}

function AuthInitializer() {
  const { user, setInitializing, login, logout } = useAuthStore();

  useEffect(() => {
    const init = async () => {
      if (user) {
        // Persisted user exists — try to get a fresh access token via httpOnly cookie
        try {
          const res = await authApi.refresh();
          const newToken: string = res.data.accessToken;
          setAccessToken(newToken);
          login(user, newToken);
        } catch {
          // Refresh failed — session expired, single-device kicked, or cookie missing
          logout();
        }
      }
      setInitializing(false);
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

function SocketManager() {
  useSocketSetup();
  return null;
}

/* Runs the AI auto-reply loop — always mounted when user is authenticated */
function AIManager() {
  useAutoReply();
  return null;
}

/* Load AI settings (one-time on startup) and refresh writing style profile */
function AIInitializer() {
  const { user } = useAuthStore();
  const { conversations } = useChatStore();
  const { bulkSetAutoReply, setStyleProfile, styleProfileLoaded } = useAIStore();

  // Load all AI settings in a SINGLE batch request — fires once on startup.
  // Using a ref ensures this never re-fires on conversation list updates.
  const settingsLoadedRef = useRef(false);
  useEffect(() => {
    if (!user || settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;
    aiApi.getAllSettings()
      .then((res) => bulkSetAutoReply(res.data.settings ?? {}))
      .catch(() => { /* AI tables may not exist yet — degrade silently */ });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load style profile once per session
  useEffect(() => {
    if (!user || styleProfileLoaded) return;
    aiApi.getStyleProfile()
      .then((res) => setStyleProfile(res.data.profile))
      .catch(() => { /* non-fatal */ });
  }, [user, styleProfileLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh writing style every 10 minutes (non-blocking, low priority)
  useEffect(() => {
    if (!user) return;
    const updateStyle = async () => {
      try {
        const convSnapshot = useChatStore.getState().conversations.slice(0, 8);
        const allMessages: string[] = [];
        for (const conv of convSnapshot) {
          const msgs = await getMessages(conv.id, 25);
          const mine = msgs.filter((m) => m.senderId === user.id && m.text && m.type === 'text');
          allMessages.push(...mine.map((m) => m.text!));
        }
        if (allMessages.length >= 10) {
          await aiApi.updateStyleProfile(allMessages.slice(0, 150));
          const res = await aiApi.getStyleProfile();
          setStyleProfile(res.data.profile);
        }
      } catch { /* non-fatal */ }
    };
    // Delay initial run by 8s to not compete with startup traffic
    const t = setTimeout(updateStyle, 8000);
    const interval = setInterval(updateStyle, 10 * 60 * 1000);
    return () => { clearTimeout(t); clearInterval(interval); };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

function MobileViewDetector() {
  const { setMobileView } = useUIStore();
  useEffect(() => {
    const check = () => setMobileView(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [setMobileView]);
  return null;
}

function StoreHydrator() {
  useEffect(() => {
    useAuthStore.persist.rehydrate();
    useUIStore.persist.rehydrate();
  }, []);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <StoreHydrator />
      <ThemeManager />
      <AuthInitializer />
      <SocketManager />
      <AIManager />
      <AIInitializer />
      <MobileViewDetector />
      {children}
      <Toaster
        position="top-center"
        toastOptions={{
          className: 'dark:bg-gray-800 dark:text-white',
          duration: 3000,
          style: { borderRadius: '12px', fontSize: '14px' },
        }}
      />
    </QueryClientProvider>
  );
}
