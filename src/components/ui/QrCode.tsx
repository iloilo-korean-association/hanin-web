import qrcode from "qrcode-generator";

import { cn } from "./cn";

/**
 * QR 코드 — 인라인 SVG.
 *
 * ── 왜 이미지가 아니라 SVG 인가 ─────────────────────────────────────────
 *  · 외부 API(api.qrserver.com 등)로 만들면 **회원증 확인 주소가 제3자 서버에
 *    통째로 넘어간다.** 개인정보 원칙(계정 0개·외부 호출 0개)에 어긋난다.
 *  · PNG 로 만들어 두면 종이에 뽑을 때 뭉갠다. SVG 는 프린터 해상도로 찍힌다 —
 *    회원증은 인쇄해서 제휴 업소에 내미는 물건이다.
 *  · 라이브러리는 qrcode-generator(의존성 0개, MIT). 매트릭스만 받아
 *    우리가 직접 그린다 — createSvgTag() 가 주는 HTML 문자열을
 *    dangerouslySetInnerHTML 로 꽂지 않는다.
 *
 * ── 인코딩 ──────────────────────────────────────────────────────────────
 *  qrcode-generator 의 기본 stringToBytes 는 charCode & 0xff(라틴-1)이다.
 *  우리가 넣는 값은 https://…/verify/<토큰> 형태의 **ASCII URL** 뿐이라
 *  UTF-8 과 결과가 같다. 한글이 섞이면 스캐너가 깨진 글자를 읽게 되므로
 *  ASCII 가 아니면 여기서 잡아 던진다(조용히 깨진 QR 을 인쇄하지 않는다).
 *
 * ── 오류정정 레벨 M ─────────────────────────────────────────────────────
 *  지갑에 넣고 다니는 카드다. 긁힘·접힘을 견뎌야 하므로 L(7%)이 아니라 M(15%).
 *  H(30%)까지 올리면 같은 데이터에 모듈 수가 늘어 카드 위에서 셀이 너무 작아진다.
 */

/** 여백(quiet zone). QR 규격 권장 최소 4모듈 — 좁히면 스캐너가 경계를 못 찾는다. */
const QUIET_ZONE = 4;

export function QrCode({
  value,
  /** 화면 표시 크기(px). 인쇄 크기는 CSS 로 따로 정한다. */
  size = 128,
  /** 스크린리더가 읽을 설명. "무엇을 여는 QR 인가" 를 적는다. */
  label,
  className,
}: {
  value: string;
  size?: number;
  label: string;
  className?: string;
}) {
  // eslint-disable-next-line no-control-regex -- ASCII 범위 검사에 제어문자 경계가 필요하다
  if (!/^[\x20-\x7E]+$/.test(value)) {
    throw new Error(
      `QR 에 넣을 수 있는 값은 ASCII 문자뿐입니다(현재: ${value.slice(0, 40)}). ` +
        "한글이 들어가면 스캐너가 깨진 글자를 읽습니다.",
    );
  }

  const qr = qrcode(0 /* 자동 버전 */, "M");
  qr.addData(value); // 모드 생략 = Byte
  qr.make();

  const count = qr.getModuleCount();
  const span = count + QUIET_ZONE * 2;

  // 어두운 모듈을 path 하나로 합친다. <rect> 를 수백 개 만들면 DOM 이 무거워진다.
  let d = "";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      // 화면 축소·인쇄 확대에서 셀 경계가 흐려지지 않게
      shapeRendering="crispEdges"
      className={cn("block", className)}
    >
      {/* 흰 바탕을 직접 깐다 — 카드 배경이 무슨 색이든 QR 대비가 보장돼야 한다 */}
      <rect width={span} height={span} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
