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
          soft: '#4752C420',
        },
        card: '#0f172a',
        border: '#1e293b',
      },
      fontFamily: {
        sans: ['system-ui', 'ui-sans-serif', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 rgb(255 255 255 / 0.05) inset, 0 1px 3px rgb(0 0 0 / 0.3)',
      },
    },
  },
  plugins: [],
} satisfies Config;
