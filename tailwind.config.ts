import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        app: "var(--color-app)",
        panel: "var(--color-panel)",
        muted: "var(--color-muted)",
        ink: "var(--color-ink)",
        line: "var(--color-line)",
        brand: "var(--color-brand)",
        success: "#138a43",
        warn: "#c77700",
        danger: "#c24132"
      },
      boxShadow: {
        panel: "var(--shadow-panel)"
      }
    }
  },
  plugins: []
};

export default config;
