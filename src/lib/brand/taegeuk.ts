/**
 * 태극 문양 기하 — 한인회 공식 엠블럼(public/brand/logo-emblem.svg)의 중심 도형.
 *
 * 엠블럼 파일을 만든 스크립트와, 회원증의 배경 워터마크(화면 MemberIdCard.tsx ·
 * PNG card-image.tsx)가 **같은 함수**로 곡선을 그린다. 한 곳에서만 곡선을 바꾸면
 * 엠블럼과 워터마크가 다른 모양이 되므로 여기 말고는 태극 path 를 적지 않는다.
 *
 * 기준: 중심 (cx, cy), 반지름 r. 기울기 0 일 때 위쪽이 빨강, 아래쪽이 파랑이고
 * 경계는 왼쪽 반원(지름 r)이 아래로, 오른쪽 반원이 위로 부푸는 S 곡선이다.
 * 기울이려면 호출하는 쪽이 `transform="rotate(각도 cx cy)"` 를 건다.
 */

/** 엠블럼 원본 JPG 의 실제 픽셀(sharp 로 샘플링)에서 읽은 색 */
export const TAEGEUK_RED = "#ed1b24";
export const TAEGEUK_BLUE = "#0065b3";

const f = (n: number): string => String(Math.round(n * 1000) / 1000);

/**
 * 빨강 부분 path(d). 파랑은 같은 중심·반지름의 원을 먼저 깔고 그 위에 이 path 를 올린다.
 *  · 큰 원 윗반원: 왼쪽 끝 → 오른쪽 끝(시계방향)
 *  · 오른쪽 작은 반원 윗부분을 따라 중심으로(반시계) — 파랑이 위로 부푸는 부분
 *  · 왼쪽 작은 반원 아랫부분을 따라 왼쪽 끝으로(시계) — 빨강이 아래로 부푸는 부분
 */
export function taegeukRedPath(cx: number, cy: number, r: number): string {
  const h = r / 2;
  return (
    `M${f(cx - r)} ${f(cy)}` +
    `A${f(r)} ${f(r)} 0 0 1 ${f(cx + r)} ${f(cy)}` +
    `A${f(h)} ${f(h)} 0 0 0 ${f(cx)} ${f(cy)}` +
    `A${f(h)} ${f(h)} 0 0 1 ${f(cx - r)} ${f(cy)}` +
    `Z`
  );
}
