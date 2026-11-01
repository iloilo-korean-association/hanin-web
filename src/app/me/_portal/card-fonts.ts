import localFont from "next/font/local";

/**
 * 회원증 **화면** 용 글꼴 (next/font/local) — PNG(card/image/card-image.tsx)가 fs 로 읽는
 * **같은 TTF 파일**을 self-host 한다. 글꼴 파일은 card/image/fonts/ 에 한 벌만 있다.
 *
 * ── 왜 next/font/local 인가 ─────────────────────────────────────────────
 *  · 이 모듈을 import 하는 컴포넌트(MemberIdCard)가 들어간 라우트(/me, /me/<토큰>, /me/card)에서만
 *    @font-face 와 <link rel=preload> 가 나간다. 홈·가입 등 다른 화면은 1.4MB 글꼴을 받지 않는다.
 *  · 빌드가 파일을 해시 이름으로 /_next/static/media 에 올리고 영구 캐시한다. 외부 CDN 호출 0.
 *  · 글꼴 이름(font-family)은 next 가 자기 것을 만든다 — 아래 className 을 요소에 붙이면 끝.
 *    글꼴 선택·배율의 정본은 card-art.ts 의 CARD_FONTS · CARD_LAYOUT(fontScale)이다.
 *
 * ── 굵기 ─────────────────────────────────────────────────────────────────
 *  을지로체는 400 하나뿐이다. 요소에 font-bold 를 주면 브라우저가 가짜 볼드(faux bold)를 만들어
 *  PNG(satori 는 합성 볼드를 안 한다)와 달라진다 → 이름 요소는 반드시 font-normal.
 *  나눔명조는 Bold(700) 파일이므로 font-bold 와 짝이 맞는다.
 *
 * ── display: swap · adjustFontFallback: false ─────────────────────────────
 *  느린 회선(태풍·정전 뒤)에서 글꼴이 늦게 와도 글자가 안 보이는 시간은 없어야 한다 → swap.
 *  Next 의 자동 폴백(Arial 메트릭 보정)은 한글이 없는 Arial 기준이라 의미가 없어 끄고,
 *  폴백은 사이트 본문과 같은 시스템 한글 고딕(이름) / 시스템 세리프(숫자) 로 둔다.
 */
export const cardNameFont = localFont({
  src: "../card/image/fonts/BMEuljiro.subset.ttf",
  weight: "400",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", "Noto Sans KR", "sans-serif"],
});

export const cardNumberFont = localFont({
  src: "../card/image/fonts/NanumMyeongjo-Bold.subset.ttf",
  weight: "700",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Georgia", "Times New Roman", "serif"],
});
