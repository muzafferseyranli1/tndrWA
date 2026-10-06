import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f1f8f4",
          500: "#1f6b46",
          600: "#195a3b",
          700: "#144a31",
        },
      },
    },
  },
  plugins: [],
};

export default config;
