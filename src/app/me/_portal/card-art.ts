import { taegeukRedPath } from "@/lib/brand/taegeuk";

/**
 * 디지털 회원증의 장식 — 화면(MemberIdCard.tsx)과 PNG(card/image/card-image.tsx)가
 * **같은 문자열**을 쓴다. 두 곳이 각자 그리면 반드시 어긋난다.
 *
 * ── 좌표계 ──────────────────────────────────────────────────────────────
 *  카드 한 장 = 856 × 540 (실물 85.6 × 54mm 의 10배). 카드 안 치수가 em 인 것과 별개로
 *  장식은 카드 전체에 꽉 채우는 SVG 라 비율만 맞으면 된다 — 화면·PNG·인쇄 모두 856:540.
 *
 * ── 모티프: 태극기 (대표 요청 "한국스럽게", 2026-11) ───────────────────
 *  태극기 한 장을 **규격 비율 그대로** 카드 오른쪽 뒤에 흐리게 깐다 — 기울어진 태극 원과
 *  네 모서리의 건·곤·감·리. 국기 규격(지름 D 기준: 괘 길이 D/2, 획 굵기 D/12, 획 사이 D/24,
 *  원과 괘 사이 D/4, 괘는 대각선 위에 놓이고 획은 대각선에 수직)을 그대로 쓴다.
 *  색은 흰색 한 가지(원 2.5%·태극 윗조각 6%·괘 5%) — 2020년형 주민등록증의 바탕 문양처럼
 *  "신분증의 격" 을 지키고, 빨강·파랑은 엠블럼과 머리 띠·인장에만 남긴다.
 *  6% 이하라 흑백 프린터에서는 얼룩으로 보이지 않고, QR·사진은 자기 흰 바탕이 있어 그 위에서 끊긴다.
 *  <pattern> 같은 고급 SVG 기능은 쓰지 않는다 — rect·path·transform 만이라 resvg(PNG)와
 *  브라우저가 똑같이 그린다.
 */
export const CARD_ART_SIZE = { width: 856, height: 540 } as const;

/** 카드에서만 쓰는 영문 표기 — 공식 엠블럼의 둘레 글자와 같게. 사이트 전체(site.ts)는 그대로 */
export const CARD_ORG_NAME_EN = "Iloilo Korean United Community Association";

/** 엠블럼 파일 경로 — 정본은 site.ts(헤더도 같은 파일을 쓴다). PNG 렌더러는 fs 로 읽는다 */
export { EMBLEM_PUBLIC_PATH } from "@/lib/site";

/**
 * 회원증 전용 색. globals.css 의 @theme 토큰(--color-card-*, --color-taegeuk-*)과 **같은 값**이다 —
 * 화면은 Tailwind 클래스로, PNG 는 이 상수로 그린다. 바꿀 때 양쪽을 같이 바꾼다.
 *  · navy: 쪽빛에 먹을 섞은 남색 두 단계(brand-800/900 보다 깊다) — 흰 글자·금색이 또렷하다
 *  · hong/cheong: 태극 홍·청. 머리 띠와 "회원증" 인장에만 쓴다 (청은 남색 위에서 보이도록 조금 밝게)
 */
export const CARD_COLORS = {
  navy800: "#10264a",
  navy900: "#0a1730",
  hong: "#c8102e",
  cheong: "#2064c6",
} as const;

/* ───────────────────────── 태극기 기하 ───────────────────────── */

/** 태극 원 중심·반지름. 카드 중앙보다 오른쪽 — 왼쪽은 사진이 가린다 */
const FLAG = { cx: 560, cy: 275, r: 165 } as const;

/** 국기 대각선 기울기(가로 3 : 세로 2) — 태극 S 곡선과 네 괘가 모두 이 각도를 따른다 */
const DIAG_DEG = (Math.atan2(2, 3) * 180) / Math.PI; // 33.69°

const f = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * 괘 하나. 가로 획을 세로로 쌓은 모양을 원점 중심으로 그린 뒤, 호출자가 옮기고 기울인다.
 * `bars` 는 획 셋을 바깥→안쪽 순서로 적은 것 — 1 = 이어진 획(양), 0 = 끊어진 획(음).
 */
function trigram(bars: readonly [0 | 1, 0 | 1, 0 | 1], D: number): string {
  const L = D / 2; // 획 길이
  const t = D / 12; // 획 굵기
  const g = D / 24; // 획 사이·끊어진 획의 틈
  const H = 3 * t + 2 * g;
  const seg = (L - g) / 2; // 끊어진 획 한 쪽 길이
  return bars
    .map((bar, i) => {
      const y = -H / 2 + i * (t + g);
      if (bar === 1) return `<rect x="${f(-L / 2)}" y="${f(y)}" width="${f(L)}" height="${f(t)}"/>`;
      return (
        `<rect x="${f(-L / 2)}" y="${f(y)}" width="${f(seg)}" height="${f(t)}"/>` +
        `<rect x="${f(g / 2)}" y="${f(y)}" width="${f(seg)}" height="${f(t)}"/>`
      );
    })
    .join("");
}

/**
 * 건·곤·감·리 넷을 국기 자리에 놓는다.
 *  건 ☰ 좌상, 곤 ☷ 우하 ("\" 대각선 — 획은 "/" 방향으로 기운다)
 *  감 ☵ 우상, 리 ☲ 좌하 ("/" 대각선 — 획은 "\" 방향으로 기운다)
 */
function trigramsSvg(): string {
  const D = FLAG.r * 2;
  const H = 3 * (D / 12) + 2 * (D / 24);
  const dist = FLAG.r + D / 4 + H / 2; // 원 중심 → 괘 중심
  const ux = Math.cos((DIAG_DEG * Math.PI) / 180);
  const uy = Math.sin((DIAG_DEG * Math.PI) / 180);
  const dx = dist * ux;
  const dy = dist * uy;

  const place = (x: number, y: number, rot: number, bars: readonly [0 | 1, 0 | 1, 0 | 1]): string =>
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})">${trigram(bars, D)}</g>`;

  return (
    `<g fill="#ffffff" fill-opacity="0.05">` +
    place(FLAG.cx - dx, FLAG.cy - dy, -DIAG_DEG, [1, 1, 1]) + // 건
    place(FLAG.cx + dx, FLAG.cy + dy, -DIAG_DEG, [0, 0, 0]) + // 곤
    place(FLAG.cx + dx, FLAG.cy - dy, DIAG_DEG, [0, 1, 0]) + // 감
    place(FLAG.cx - dx, FLAG.cy + dy, DIAG_DEG, [1, 0, 1]) + // 리
    `</g>`
  );
}

/** 배경 워터마크 SVG 마크업(완전한 <svg>). 데이터 URL 로 <img> 에 넣는다 */
export function cardWatermarkSvg(): string {
  const { width, height } = CARD_ART_SIZE;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    // 태극: 시계방향으로 기울여 S 곡선 양끝이 좌상·우하에 오게 (국기와 같은 방향, 빨강 자리가 위)
    `<g transform="rotate(${f(DIAG_DEG)} ${FLAG.cx} ${FLAG.cy})">` +
    `<circle cx="${FLAG.cx}" cy="${FLAG.cy}" r="${FLAG.r}" fill="#ffffff" fill-opacity="0.025"/>` +
    `<path d="${taegeukRedPath(FLAG.cx, FLAG.cy, FLAG.r)}" fill="#ffffff" fill-opacity="0.06"/>` +
    `</g>` +
    trigramsSvg() +
    `</svg>`
  );
}

/**
 * <img src> 용 데이터 URL(base64). satori 는 `;charset=` 같은 매개변수가 붙은 데이터 URL 을
 * 못 읽으므로 base64 로 통일한다. btoa 는 Node·브라우저 양쪽에 있다 — 넣는 SVG 는 ASCII 뿐이어야 한다.
 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
