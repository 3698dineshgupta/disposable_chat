import type { Metadata, Viewport } from 'next';
import Providers from '@/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZapChat — Secure Messaging',
  description: 'End-to-end encrypted messaging platform',
  manifest: '/manifest.json',
  icons: { icon: '/icon.png', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'ZapChat' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111b21' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <script src="https://accounts.google.com/gsi/client" async defer></script>
        {/* Service Worker registration */}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').catch(function(err) {
                console.warn('[SW] Registration failed:', err);
              });
            });
          }
        ` }} />
      </head>
      <body className="h-screen overflow-hidden bg-chat-bg text-gray-900 dark:text-gray-100 font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
