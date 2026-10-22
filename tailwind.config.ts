import type { Config } from 'tailwindcss';

// Tokens mirror MagguuUI-Website (assets/css/main.css + admin.css, dark admin shell).
const brand = {
  50: '#e6faf5',
  100: '#c0f5e6',
  200: '#8aebd4',
  300: '#45e0bb',
  400: '#0cd29d',
  500: '#0aa882',
  600: '#088f6f',
  700: '#0a6b55',
  800: '#0c4f41',
  900: '#0a332c',
  950: '#061f1b',
};

export default {
  content: ['./frontend/index.html', './frontend/src/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand,
        // Legacy accent names now resolve to the Website brand teal.
        violet: brand,
        cyan: brand,
        slate: {
          300: '#c0c8d4',
          400: '#a7b3c2',
          500: '#8b9bb0',
          600: '#8090a4',
          700: '#475569',
        },
        silver: {
          100: '#f1f5f9',
          200: '#e0e6ee',
          300: '#c0c8d4',
          400: '#8090a4',
          500: '#8b9bb0',
        },
        blurple: {
          DEFAULT: '#0cd29d',
          hover: '#45e0bb',
          soft: 'rgba(12, 210, 157, 0.08)',
          ring: 'rgba(12, 210, 157, 0.42)',
        },
        surface: {
          0: '#0b1118',
          1: '#0b1118',
          2: '#121a24',
          3: '#18222e',
        },
        line: {
          DEFAULT: 'rgba(255, 255, 255, 0.10)',
          strong: 'rgba(255, 255, 255, 0.16)',
        },
        border: 'rgba(255, 255, 255, 0.10)',
        card: '#0b1118',
        ink: '#0b1118',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xl: '0.375rem',
        '2xl': '0.375rem',
      },
      boxShadow: {
        card: 'none',
        pop: '0 8px 24px rgb(0 0 0 / 0.4)',
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
        'fade-in': 'fade-in 0.24s cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
