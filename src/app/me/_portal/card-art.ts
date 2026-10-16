import { taegeukRedPath } from "@/lib/brand/taegeuk";

/**
 * 디지털 회원증의 장식 — 화면(MemberIdCard.tsx)과 PNG(card/image/card-image.tsx)가
 * **같은 문자열**을 쓴다. 두 곳이 각자 그리면 반드시 어긋난다.
 *
 * ── 좌표계 ──────────────────────────────────────────────────────────────
 *  카드 한 장 = 856 × 540 (실물 85.6 × 54mm 의 10배). 카드 안 치수가 em 인 것과 별개로
 *  장식은 카드 전체에 꽉 채우는 SVG 라 비율만 맞으면 된다 — 화면·PNG·인쇄 모두 856:540.
 *
 * ── 모티프 ──────────────────────────────────────────────────────────────
 *  엠블럼의 태극 곡선을 크게 키워 카드 오른쪽 뒤에 깐다. 색은 흰색 두 단계(위 6%·아래 2.5%)
 *  — 남색 위에서 S 곡선만 은은하게 보이고, 빨강·파랑은 엠블럼 안에만 남긴다.
 *  바깥 금빛 호는 엠블럼의 링을 받는다. QR·사진은 자기 흰 바탕이 있어 그 위에서 끊긴다.
 */
export const CARD_ART_SIZE = { width: 856, height: 540 } as const;

/** 카드에서만 쓰는 영문 표기 — 공식 엠블럼의 둘레 글자와 같게. 사이트 전체(site.ts)는 그대로 */
export const CARD_ORG_NAME_EN = "Iloilo Korean United Community Association";

/** 엠블럼 파일 경로(public 기준). PNG 렌더러는 같은 파일을 fs 로 읽는다 */
export const EMBLEM_PUBLIC_PATH = "/brand/logo-emblem.svg";

const WM = { cx: 792, cy: 262, r: 300, tilt: -34 } as const;

/** 배경 워터마크 SVG 마크업(완전한 <svg>). 데이터 URL 로 <img> 에 넣는다 */
export function cardWatermarkSvg(): string {
  const { width, height } = CARD_ART_SIZE;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<g transform="rotate(${WM.tilt} ${WM.cx} ${WM.cy})">` +
    `<circle cx="${WM.cx}" cy="${WM.cy}" r="${WM.r}" fill="#ffffff" fill-opacity="0.025"/>` +
    `<path d="${taegeukRedPath(WM.cx, WM.cy, WM.r)}" fill="#ffffff" fill-opacity="0.06"/>` +
    `</g>` +
    `<circle cx="${WM.cx}" cy="${WM.cy}" r="${WM.r + 26}" fill="none" stroke="#e3a951" stroke-opacity="0.22" stroke-width="2.5"/>` +
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

