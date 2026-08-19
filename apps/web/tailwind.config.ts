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
        },
        ink: {
          DEFAULT: 'rgb(var(--text-primary) / <alpha-value>)',
          muted: 'rgb(var(--text-secondary) / <alpha-value>)',
        },
        canvas: 'rgb(var(--surface-customer) / <alpha-value>)',
        panel: 'rgb(var(--surface-card) / <alpha-value>)',
        muted: 'rgb(var(--surface-muted) / <alpha-value>)',
        line: 'rgb(var(--border-default) / <alpha-value>)',
      },
      borderRadius: {
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        panel: 'var(--radius-panel)',
      },
      boxShadow: {
        card: '0 12px 40px rgb(37 27 20 / 0.07)',
        float: '0 20px 60px rgb(37 27 20 / 0.14)',
      },
    },
  },
  plugins: [],
};

export default config;
