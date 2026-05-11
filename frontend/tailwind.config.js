/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101828",
        brand: "#2563eb",
        mint: "#0f766e"
      }
    }
  },
  plugins: []
};
