/** @type {import('tailwindcss').Config} */
// Wepluz design system. Product colours are fixed tokens; each school's own
// colour is available as `school` (logo fallback, login page, report cards).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "rgb(var(--brand) / <alpha-value>)", // deep teal: primary actions, sidebar
        accent: "rgb(var(--accent) / <alpha-value>)", // sunflower yellow: highlights, progress, bars
        school: "rgb(var(--school) / <alpha-value>)", // the active school's chosen colour
        mint: "rgb(var(--mint) / <alpha-value>)", // app backdrop
        surface: "rgb(var(--surface) / <alpha-value>)", // card fill
        ink: "rgb(var(--ink) / <alpha-value>)", // primary text
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      borderRadius: {
        "4xl": "2rem",
      },
    },
  },
  plugins: [],
};
