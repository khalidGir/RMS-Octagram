import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--brand-primary) / <alpha-value>)',
          foreground: 'rgb(var(--brand-primary-foreground) / <alpha-value>)',
          accent: 'rgb(var(--brand-accent) / <alpha-value>)',
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          subtle: 'rgb(var(--surface-subtle) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
          warm: 'rgb(var(--surface-warm) / <alpha-value>)',
          cream: 'rgb(var(--surface-cream) / <alpha-value>)',
        },
        dark: {
          DEFAULT: 'rgb(var(--dark) / <alpha-value>)',
          deep: 'rgb(var(--dark-deep) / <alpha-value>)',
          muted: 'rgb(var(--dark-muted) / <alpha-value>)',
        },
        accent: {
          teal: 'rgb(var(--accent-teal) / <alpha-value>)',
          gold: 'rgb(var(--accent-gold) / <alpha-value>)',
          'gold-muted': 'rgb(var(--accent-gold-muted) / <alpha-value>)',
        },
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'text-secondary-light': 'rgb(var(--text-secondary-light) / <alpha-value>)',
        'text-secondary-dark': 'rgb(var(--text-secondary-dark) / <alpha-value>)',
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          surface: 'rgb(var(--success-surface) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
          surface: 'rgb(var(--warning-surface) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          surface: 'rgb(var(--danger-surface) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--info) / <alpha-value>)',
          surface: 'rgb(var(--info-surface) / <alpha-value>)',
        },
        /* Legacy aliases (preserved) */
        line: 'rgb(var(--border-default) / <alpha-value>)',
        muted: 'rgb(var(--surface-muted) / <alpha-value>)',
        panel: 'rgb(var(--surface-card) / <alpha-value>)',
      },
      borderRadius: {
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        panel: 'var(--radius-panel)',
      },
      boxShadow: {
        card: 'var(--shadow-raised)',
        float: 'var(--shadow-floating)',
        modal: 'var(--shadow-modal)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        'ease-out': 'var(--ease-out)',
        'ease-in': 'var(--ease-in)',
      },
    },
  },
  plugins: [],
};

export default config;
