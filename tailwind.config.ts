import type { Config } from 'tailwindcss';

export default {
  content: ['./frontend/index.html', './frontend/src/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        blurple: {
          DEFAULT: '#5865F2',
          hover: '#4752C4',
          soft: 'rgba(88, 101, 242, 0.15)',
          ring: 'rgba(88, 101, 242, 0.5)',
        },
        surface: {
          0: '#0b0f17',
          1: '#0f141e',
          2: '#141a26',
          3: '#1a2132',
        },
        line: {
          DEFAULT: 'rgba(255, 255, 255, 0.06)',
          strong: 'rgba(255, 255, 255, 0.10)',
        },
        border: 'rgba(255, 255, 255, 0.10)',
        card: '#0f141e',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'ui-sans-serif', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.3)',
        pop: '0 10px 30px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.3)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
