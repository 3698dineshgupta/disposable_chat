import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#e8fdf5',
          100: '#c3f9e2',
          200: '#8bf2c4',
          300: '#48e5a0',
          400: '#1bd47e',
          500: '#00a884', // WhatsApp green
          600: '#00896c',
          700: '#006d56',
          800: '#005443',
          900: '#003d31',
        },
        chat: {
          bg:        'rgb(var(--chat-bg) / <alpha-value>)',
          sidebar:   'rgb(var(--chat-sidebar) / <alpha-value>)',
          surface:   'rgb(var(--chat-surface) / <alpha-value>)',
          mine:      'rgb(var(--chat-mine) / <alpha-value>)',
          theirs:    'rgb(var(--chat-theirs) / <alpha-value>)',
          border:    'rgb(var(--chat-border) / <alpha-value>)',
          input:     'rgb(var(--chat-input) / <alpha-value>)',
          header:    'rgb(var(--chat-header) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'bounce-dot': 'bounceDot 1.4s infinite ease-in-out',
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'slide-in':   'slideIn 0.3s ease-out',
        'ring':       'ring 1s cubic-bezier(0.215, 0.610, 0.355, 1.000) infinite',
        'pulse-ring': 'pulseRing 1.25s cubic-bezier(0.215, 0.61, 0.355, 1) infinite',
      },
      keyframes: {
        bounceDot: {
          '0%, 80%, 100%': { transform: 'scale(0)', opacity: '0' },
          '40%':           { transform: 'scale(1)', opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to:   { transform: 'translateY(0)', opacity: '1' },
        },
        slideIn: {
          from: { transform: 'translateX(-12px)', opacity: '0' },
          to:   { transform: 'translateX(0)', opacity: '1' },
        },
        ring: {
          '0%':   { transform: 'scale(0.95)' },
          '5%':   { transform: 'scale(1.1)' },
          '39%':  { transform: 'scale(0.85)' },
          '45%':  { transform: 'scale(1.05)' },
          '60%':  { transform: 'scale(0.95)' },
          '100%': { transform: 'scale(0.9)' },
        },
        pulseRing: {
          '0%':   { transform: 'scale(0.33)' },
          '80%, 100%': { opacity: '0' },
        },
      },
      backgroundImage: {
        'chat-pattern-dark':  "url('/chat-bg-dark.png')",
        'chat-pattern-light': "url('/chat-bg-light.png')",
      },
    },
  },
  plugins: [],
};

export default config;
