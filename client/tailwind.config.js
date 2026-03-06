/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Courier New', 'monospace'],
      },
      colors: {
        surface: {
          0: '#0a0a0f',
          1: '#12121a',
          2: '#1a1a26',
          3: '#222232',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#818cf8',
          muted: '#6366f120',
        },
        brand: {
          green: '#10b981',
          red: '#ef4444',
          yellow: '#f59e0b',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.25s ease-out',
        pulse: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};
