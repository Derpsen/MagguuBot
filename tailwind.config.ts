import type { Config } from 'tailwindcss';

export default {
  content: ['./frontend/index.html', './frontend/src/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: {
          500: '#8b98ab',
          600: '#718096',
          700: '#4b586d',
        },
        blurple: {
          DEFAULT: '#7c6df2',
          hover: '#8b7df6',
          soft: 'rgba(124, 109, 242, 0.14)',
          ring: 'rgba(124, 109, 242, 0.42)',
        },
        surface: {
          0: '#080b12',
          1: '#0d121c',
          2: '#131a27',
          3: '#1a2333',
        },
        line: {
          DEFAULT: 'rgba(148, 163, 184, 0.10)',
          strong: 'rgba(148, 163, 184, 0.18)',
        },
        border: 'rgba(255, 255, 255, 0.10)',
        card: '#0f141e',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'ui-sans-serif', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.035) inset, 0 18px 50px rgba(0,0,0,0.16)',
        pop: '0 24px 70px rgba(0,0,0,0.48), 0 6px 18px rgba(0,0,0,0.24)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
