/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Set per school at runtime from school_settings (see src/lib/branding.ts)
        brand: "rgb(var(--brand) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
