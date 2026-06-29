'use client';

import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { useSocketSetup } from '@/hooks/useSocket';
import { setAccessToken } from '@/lib/api';

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
  const { setInitializing } = useAuthStore();

  useEffect(() => {
    // No session restoration — user must log in fresh on every page load
    setInitializing(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

function SocketManager() {
  useSocketSetup();
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
    useUIStore.persist.rehydrate(); // restore theme preference only
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
