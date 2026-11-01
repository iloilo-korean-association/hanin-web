/**
 * 디지털 회원증의 배경·좌표·색 — 화면(MemberIdCard.tsx)과 PNG(card/image/card-image.tsx)가
 * **같은 값**을 쓴다. 두 곳이 각자 적으면 반드시 어긋난다.
 *
 * ── 배경 플레이트 (대표가 준 디자인, 2026-11) ───────────────────────────
 *  대표가 완성 그림(「회원증 디자인.png」 1579×996)을 줬다. 레이어가 없는 한 장이라
 *  그 그림에서 **가변 요소만 지운 배경**(public/brand/card-plate.jpg — 사진·이름·회원번호
 *  글자·구분 글자·날짜·QR 모듈을 인페인팅으로 지운 것)을 깔고, 그 위에 가변 요소만 다시
 *  그린다. 제목·엠블럼·라벨("성명 · NAME" 등)·아이콘·알약 테·QR 금테·"스캔하면 진위 확인"·
 *  하단 안내문은 전부 플레이트 그림 안에 있다 — DOM 에는 없다.
 *  원본 PNG 는 2.6MB 라 저장소에 넣지 않았다. 플레이트(JPEG q85)만 있다.
 *
 * ── 좌표계 ──────────────────────────────────────────────────────────────
 *  카드 한 장 = 856 × 540 (실물 85.6 × 54mm 의 10배), 1em = 카드 폭 / 34.24 (= 25px@856).
 *  화면은 globals.css 가 `font-size: calc(100cqw / 34.24)` 로, PNG 는 1712px 카드라 1em = 50px 로
 *  같은 비율을 만든다. 아래 CARD_LAYOUT 의 숫자는 전부 **em** — 원본 그림의 픽셀을 46.115
 *  (= 1579 / 34.24) 로 나눈 값이다. 원본에서 잰 픽셀은 각 항목 주석에 남겼다.
 */

/** 배경 플레이트. 화면은 CSS background(globals.css), PNG 는 fs 로 읽어 데이터 URL 로 깐다 */
export const CARD_PLATE_PUBLIC_PATH = "/brand/card-plate.jpg";

/**
 * 회원증 글자 색. globals.css 의 @theme 토큰 `--color-card-ink` 와 **같은 값**이다 —
 * 화면은 Tailwind 클래스(text-card-ink)로, PNG 는 이 상수로 그린다. 바꿀 때 양쪽을 같이 바꾼다.
 *  · ink: 원본 그림의 이름·날짜·회원번호 글자에서 샘플링한 남색
 */
export const CARD_COLORS = {
  ink: "#0b1d47",
  white: "#ffffff",
} as const;

/**
 * 회원증 글꼴 (대표 결정 2026-11-01 — 글꼴 견본 시트를 보고 고른 조합).
 *  · 이름(한글)          : 배민 을지로체 (BM EULJIRO) — 원본 디자인의 붓글씨 느낌에 가장 가깝다
 *  · 회원번호 · 유효기간  : 나눔명조 Bold — 원본의 세리프 숫자
 *  · 회원구분 알약 · 영문 이름 · "사진 없음" : 그대로 고딕(화면 = 시스템 고딕, PNG = Noto Sans KR Bold)
 *
 * 글꼴 파일은 card/image/fonts/ 에 **한 벌**만 있다(서브셋 TTF). PNG 는 fs 로 읽고(card-image.tsx),
 * 화면은 같은 파일을 next/font/local 로 self-host 한다(card-fonts.ts). 같은 파일·같은 배율이라 모양이 같다.
 * family 는 satori 에 등록하는 이름이다 — 화면은 next/font 가 자기 이름을 만들어 className 으로 붙인다.
 *  ★ 을지로체는 굵기 400 하나뿐이다. 700 을 요구하면 브라우저가 가짜 볼드를 만들어 PNG 와 달라진다.
 *  ★ 'IKA Card Name' 은 서브셋 파일 안의 패밀리 이름이기도 하다 — 을지로체 원본은 OFL 로 Reserved Font Name
 *    ('BM EULJIRO')이 걸려 있어 수정본(서브셋)은 그 이름을 쓸 수 없다(fonts/LICENSE_BMEULJIRO.txt).
 */
export const CARD_FONTS = {
  name: { family: "IKA Card Name", weight: 400 },
  number: { family: "Nanum Myeongjo", weight: 700 },
  label: { family: "Noto Sans KR", weight: 700 },
} as const;

/**
 * 가변 요소 자리 (em). 원본 픽셀(1579 폭 기준) → em = px / 46.115.
 *
 * 글자 크기: fontSize 는 **Noto Sans KR Bold 기준**으로 원본 글자의 잉크 높이를 맞춘 값이고,
 * fontScale 은 CARD_FONTS 의 글꼴로 바꿨을 때 같은 잉크 높이가 되는 배율이다(실제 크기 = fontSize × fontScale).
 * 배율과 top 은 PNG 를 원본 디자인과 같은 좌표계(1579px)로 맞춰 잉크 bbox 를 비교해 정했다(2026-11-01):
 *  · 이름 "박정우" 2.24em: Noto 잉크 316×104 → 을지로 ×0.990 → 원본 293×97 / 결과 262×94, 세로 중심 차 0.5px
 *  · 숫자 "0" 1em: Noto 잉크 25×39 → 나눔명조 Bold ×1.000 → 회원번호 원본 167×39 / 결과 164×39 (차 0px)
 *  · top: 글꼴마다 글자가 줄 상자 안에 앉는 높이가 달라서 Noto 기준 top 에 을지로 +0.195em, 명조 +0.076/+0.087em
 *    을 더해 원본 글자의 세로 중심에 맞췄다(이름 8.457→8.652, 회원번호 12.902→12.978, 유효기간 16.004→16.091).
 * 글꼴을 바꾸면 fontScale 과 top 을 다시 잰다 — 두 렌더러(화면·PNG)가 이 숫자를 그대로 쓴다.
 */
export const CARD_LAYOUT = {
  /** 사진: 금테 안쪽 x 95~406, y 337~751. 테와 사이에 틈이 안 보이게 사방 1px 겹친다 */
  photo: { left: 2.038, top: 7.286, width: 6.809, height: 9.043, radius: 0.3 },
  /** 이름 줄: 잉크 x 467~759, y 396~492 (3자). 한글 이름(을지로체) + (있을 때만) 영문 이름(고딕)이 한 줄 */
  name: { left: 9.975, top: 8.652, maxWidth: 14.1, fontSize: 2.24, fontScale: 0.99, tracking: 0.08 },
  /** 영문 이름: 한글 이름 오른쪽, 아래 정렬. 디자인에 자리가 없어 작게 */
  nameEn: { fontSize: 0.6, gap: 0.5 },
  /** 회원번호 알약(플레이트에 있음) x 461~721, y 595~659 — 그 안에 글자(나눔명조 Bold)만 가운데 */
  memberNo: { left: 9.997, top: 12.978, width: 5.638, height: 1.388, fontSize: 1.1, fontScale: 1, tracking: 0.05 },
  /** 회원구분 알약(플레이트에 있음) x 798~1036, y 596~658 — 그 안에 흰 글자만 가운데 */
  memberType: { left: 17.305, top: 12.924, width: 5.161, height: 1.344, fontSize: 1 },
  /** 유효기간: 숫자 잉크 x 470~1018, y 745~779 (나눔명조 Bold) */
  period: { left: 10.149, top: 16.091, fontSize: 1, fontScale: 1 },
  /** QR: 금테 안 흰 상자 x 1140~1477, y 348~676 — 그 안에 정사각형으로 가운데 */
  qr: { left: 24.822, top: 7.546, size: 7.134 },
  /** 카드 모서리. 원본의 둥근 모서리(반지름 40px)보다 조금 작게 잘라 바깥 흰 귀퉁이가 안 보이게 */
  radius: 0.8,
} as const;

/**
 * 사진이 없을 때 금테 안에 넣는 연한 실루엣(머리 + 어깨). 바탕은 플레이트의 크림 질감 그대로.
 * 글자("사진 없음")는 SVG 에 넣지 않는다 — PNG 쪽 resvg 에는 폰트가 없다. 양쪽 렌더러가 DOM 글자로 쓴다.
 */
export function photoPlaceholderSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 134" width="100" height="134">` +
    `<g fill="${CARD_COLORS.ink}" fill-opacity="0.12">` +
    `<circle cx="50" cy="46" r="20"/>` +
    `<path d="M10 134C10 100 30 88 50 88C70 88 90 100 90 134Z"/>` +
    `</g>` +
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
