import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-pretendard)', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Brand-neutral palette for demo (override per customer if cloning)
        brand: {
          50:  '#f5f7fb',
          100: '#e8edf6',
          500: '#3b5bdb',
          600: '#2f49b2',
          900: '#1a2447',
        },
        wow: '#ff6b35', // wow-moment highlight (Cytoscape edge, badge)
      },
      keyframes: {
        pulse_soft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
      animation: {
        'pulse-soft': 'pulse_soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
