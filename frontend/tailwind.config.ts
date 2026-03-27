import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark grey surfaces
        bg: '#111111',
        surface: '#1c1c1c',
        'surface-2': '#252525',
        'surface-3': '#2e2e2e',
        border: '#333333',
        'border-2': '#444444',
        // Text
        primary: '#e8e8e8',
        secondary: '#888888',
        muted: '#a0a0a0',
        // Accent green
        accent: '#4ade80',
        'accent-dim': '#22c55e',
        'accent-muted': '#166534',
        // Status colours
        danger: '#f87171',
        'danger-dim': '#ef4444',
        'danger-muted': '#7f1d1d',
        warn: '#fbbf24',
        // Transfer grey
        transfer: '#6b7280',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
