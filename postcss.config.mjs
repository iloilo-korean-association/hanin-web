/** Tailwind v4 는 PostCSS 플러그인 하나로 끝난다. tailwind.config.js 는 없다 — 토큰은 globals.css 의 @theme 에 있다. */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
