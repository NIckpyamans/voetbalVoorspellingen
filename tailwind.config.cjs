const stateColors = ["yellow", "red", "blue", "slate"];

module.exports = {
  content: [
    "./index.html",
    "./index.tsx",
    "./App.tsx",
    "./components/**/*.{ts,tsx}",
    "./services/**/*.{ts,tsx}",
    "./shared/**/*.{ts,tsx}",
    "./utils/**/*.{ts,tsx}",
    "./types.ts",
  ],
  safelist: [
    ...stateColors.flatMap((color) => [
      `border-${color}-500/60`,
      `border-${color}-500/20`,
      `hover:border-${color}-500/30`,
      `bg-${color}-900/20`,
      `text-${color}-400`,
    ]),
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
