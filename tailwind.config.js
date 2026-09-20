/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        wilson: {
          violet: "#8B5CF6",
          pink: "#F472B6",
          cyan: "#22D3EE",
          pearl: "#F8F0FF",
        },
      },
    },
  },
  plugins: [],
};
