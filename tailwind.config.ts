import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          sidebar: "var(--surface-sidebar)",
        },
        border: "var(--border)",
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
        },
        tag: {
          product: { bg: "var(--tag-product-bg)", text: "var(--tag-product-text)" },
          design: { bg: "var(--tag-design-bg)", text: "var(--tag-design-text)" },
          support: { bg: "var(--tag-support-bg)", text: "var(--tag-support-text)" },
          marketing: { bg: "var(--tag-marketing-bg)", text: "var(--tag-marketing-text)" },
        }
      },
      letterSpacing: {
        "super-wide": "0.06em",
        "super-tight": "-0.012em",
      },
      fontSize: {
        xxs: ["11px", { lineHeight: "14px" }],
        xs: ["13px", { lineHeight: "17px" }],
        sm: ["14px", { lineHeight: "19px" }],
        base: ["15px", { lineHeight: "22px" }],
      }
    },
  },
  plugins: [],
} satisfies Config;