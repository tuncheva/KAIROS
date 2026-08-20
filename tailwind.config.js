/**
 * Tailwind CSS Configuration
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "rgb(var(--bg-primary) / <alpha-value>)",
          secondary: "rgb(var(--bg-secondary) / <alpha-value>)",
          tertiary: "rgb(var(--bg-tertiary) / <alpha-value>)",
          elevated: "rgb(var(--bg-elevated) / <alpha-value>)",
          surface: "rgb(var(--bg-surface) / <alpha-value>)",
          overlay: "rgb(var(--bg-overlay) / <alpha-value>)",
        },
        fg: {
          primary: "rgb(var(--text-primary) / <alpha-value>)",
          secondary: "rgb(var(--text-secondary) / <alpha-value>)",
          tertiary: "rgb(var(--text-tertiary) / <alpha-value>)",
          quaternary: "rgb(var(--text-quaternary) / <alpha-value>)",
        },
        border: {
          light: "rgb(var(--border-light) / <alpha-value>)",
          medium: "rgb(var(--border-medium) / <alpha-value>)",
          strong: "rgb(var(--border-strong) / <alpha-value>)",
        },
        accent: {
          primary: "rgb(var(--accent-primary) / <alpha-value>)",
          secondary: "rgb(var(--accent-secondary) / <alpha-value>)",
          tertiary: "rgb(var(--accent-tertiary) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
        },
        brand: {
          purple: "rgb(var(--brand-purple) / <alpha-value>)",
          pink: "rgb(var(--brand-pink) / <alpha-value>)",
          caramel: "rgb(var(--brand-caramel) / <alpha-value>)",
          mint: "rgb(var(--brand-mint) / <alpha-value>)",
          sky: "rgb(var(--brand-sky) / <alpha-value>)",
          strawberry: "rgb(var(--brand-strawberry) / <alpha-value>)",
        },
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        error: "rgb(var(--error) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        event: {
          active: "rgb(var(--event-active) / <alpha-value>)",
          upcoming: "rgb(var(--event-upcoming) / <alpha-value>)",
          completed: "rgb(var(--event-completed) / <alpha-value>)",
          cancelled: "rgb(var(--event-cancelled) / <alpha-value>)",
        },
      },
      boxShadow: {
        'xs': 'var(--shadow-xs)',
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
        'xl': 'var(--shadow-xl)',
        '2xl': 'var(--shadow-2xl)',
        'accent': 'var(--shadow-accent)',
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          "KairosEmoji",
          "Segoe UI Emoji",
          "Segoe UI Symbol",
          "Noto Color Emoji",
        ],
        display: [
          "var(--font-display)",
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
