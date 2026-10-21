import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { buildQrPath } from "@/components/ui/QrCode";
import { formatPeriodDate, type MembershipPeriod } from "@/lib/domain/membershipPeriod";
import { ORG_NAME } from "@/lib/site";

import { CARD_ORG_NAME_EN, cardWatermarkSvg, svgToDataUrl } from "../../_portal/card-art";

/**
 * 디지털 회원증 PNG 렌더러 (P3 — "이미지로 저장").
 *
 * ── 왜 서버에서 그리는가 ─────────────────────────────────────────────────
 *  회원 사진은 비공개 Blob 의 **다른 오리진 서명 URL** 이다. 브라우저 canvas 로 카드를
 *  그리면 그 사진 때문에 canvas 가 taint 되어 toBlob 이 막힌다(CORS). 서버는 서명 URL 을
 *  fetch 해 data URL 로 박으면 끝이고, 결과가 브라우저·OS 와 무관하게 똑같다.
 *  next/og(satori + resvg)는 Next 에 내장돼 있어 새 패키지가 없다.
 *
 * ── 화면(MemberIdCard.tsx)과 같은 모습이어야 한다 ───────────────────────
 *  화면 카드는 글자·사진·QR 이 전부 em 이고, em = 카드 폭 / 34.24 (globals.css).
 *  여기서는 카드 폭 1712px(실물 85.6mm 의 2x) → 1em = 50px 로 **같은 비율**을 px 로 환산해
 *  그린다. 색은 globals.css 의 브랜드 토큰 값 그대로다(brand-800/900, accent-200/300).
 *  satori 는 Tailwind 를 모르고 flex 기반 CSS 서브셋만 알아듣기 때문에 인라인 스타일로
 *  다시 그렸다 — 레이아웃을 바꿀 때는 **MemberIdCard.tsx 와 이 파일을 같이** 고쳐야 한다.
 *
 * ── 엠블럼·워터마크 ─────────────────────────────────────────────────────
 *  머리의 공식 엠블럼은 public/brand/logo-emblem.svg(둘레 글자까지 path 로 그린 벡터)를
 *  fs 로 읽어 데이터 URL <img> 로 넣는다. satori 는 <textPath> 를 모르지만 path 만 있는
 *  SVG 는 resvg 가 벡터 그대로 래스터화하므로 1712px 카드에서도 글자가 선명하다 —
 *  sharp 로 미리 PNG 를 만들 필요가 없고(의존성 추가 없음), 화면과 같은 파일을 쓴다.
 *  바탕 워터마크는 card-art.ts 의 문자열을 화면과 그대로 공유한다.
 *
 * ── 한글 폰트 ────────────────────────────────────────────────────────────
 *  satori 에는 CJK 폰트가 없다 → 폰트 버퍼를 넘겨야 한다. 운영 서버(Vercel, 리눅스)에는
 *  한글 시스템 폰트가 없고 외부 CDN 호출은 금지라, OFL 폰트(Noto Sans KR)를 **KS X 1001
 *  한글 2350자 + ASCII 서브셋**으로 잘라 ./fonts 에 커밋해 두고 fs 로 읽는다.
 *  (출처·라이선스·만든 방법은 fonts/README.md)
 *  ★ 2350자 밖의 희귀 한글 음절(예: '똠')은 빈 칸으로 찍힌다 — 회원 이름에 그런 글자가
 *    나오면 fonts/README.md 의 절차로 서브셋에 추가한다.
 *
 * ── 이 파일은 판정하지 않는다 ───────────────────────────────────────────
 *  "누구의 카드를, 발급해도 되는가" 는 route.ts 가 가드(requireMember*)와
 *  loadMemberCardData 의 verdict 로 정한다. 이 파일은 받은 값을 그릴 뿐이다.
 *  (그래서 server-only 를 import 하지 않는다 — 단독 스크립트로도 렌더를 검증할 수 있게.)
 */

/** 실물 카드 비율(856:540) 의 2x. 휴대폰 화면 전체로 봐도 또렷한 크기. */
export const CARD_IMAGE_SIZE = { width: 1712, height: 1080 } as const;

/** globals.css `font-size: calc(100cqw / 34.24)` 와 같은 비율 → 1712px 카드에서 1em = 50px */
const EM = CARD_IMAGE_SIZE.width / 34.24;

/** globals.css 의 토큰 값. 바꿀 때 양쪽을 같이 바꾼다. */
const COLOR = {
  brand800: "#17375d",
  brand900: "#142d4a",
  accent200: "#efc98d",
  accent300: "#e3a951",
  white: "#ffffff",
} as const;

const FONT_FAMILY = "Noto Sans KR";

/* ───────────────────────── 폰트 ───────────────────────── */

type FontOption = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

let fontsPromise: Promise<FontOption[]> | null = null;

/**
 * 폰트는 프로세스에 한 번만 읽는다(두 파일 합쳐 약 830KB).
 * 경로를 리터럴로 적는 이유: Next 의 output tracing 이 fs 호출의 **리터럴 인자**를 보고
 * 배포 산출물에 파일을 포함시킨다. 변수로 합치면 추적이 빠진다(next.config.ts 의
 * outputFileTracingIncludes 가 2중 안전장치).
 */
function loadFonts(): Promise<FontOption[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(join(process.cwd(), "src/app/me/card/image/fonts/NotoSansKR-Regular.subset.ttf")),
      readFile(join(process.cwd(), "src/app/me/card/image/fonts/NotoSansKR-Bold.subset.ttf")),
    ])
      .then(([regular, bold]): FontOption[] => [
        { name: FONT_FAMILY, data: regular, weight: 400, style: "normal" },
        { name: FONT_FAMILY, data: bold, weight: 700, style: "normal" },
      ])
      .catch((e: unknown) => {
        fontsPromise = null; // 다음 요청에서 다시 시도
        throw e;
      });
  }
  return fontsPromise;
}

/* ───────────────────────── 사진 ───────────────────────── */

/** 매직 바이트로 이미지 형식을 알아낸다. Blob 응답의 content-type 이 비어 있을 때의 보험. */
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

/**
 * 서명 URL 의 사진을 서버가 받아 data URL 로 바꾼다. 실패하면 "" (→ 플레이스홀더).
 * ★ 서명 URL 은 여기서 소비되고 끝난다. 응답 PNG 외에는 어디에도 나가지 않는다.
 */
export async function fetchPhotoAsDataUrl(photoViewUrl: string): Promise<string> {
  const url = photoViewUrl.trim();
  if (!url || !/^https?:\/\//i.test(url)) return "";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return "";
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = sniffImageType(bytes) ?? res.headers.get("content-type")?.split(";")[0].trim();
    if (!type || !type.startsWith("image/")) return "";
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return "";
  }
}

/* ───────────────────────── 엠블럼 ───────────────────────── */

let emblemPromise: Promise<string> | null = null;

/**
 * 공식 엠블럼(public/brand/logo-emblem.svg)을 데이터 URL 로. 화면 <img src="/brand/…"> 와
 * 같은 파일이다. 폰트와 같은 이유로 경로를 리터럴로 적는다(next.config 의
 * outputFileTracingIncludes 에도 올라 있다). 프로세스에 한 번만 읽는다.
 */
function loadEmblemDataUrl(): Promise<string> {
  if (!emblemPromise) {
    emblemPromise = readFile(join(process.cwd(), "public/brand/logo-emblem.svg"))
      .then((svg) => `data:image/svg+xml;base64,${svg.toString("base64")}`)
      .catch((e: unknown) => {
        emblemPromise = null;
        throw e;
      });
  }
  return emblemPromise;
}

/* ───────────────────────── SVG 조각 ───────────────────────── */

/** QrCode.tsx 와 같은 매트릭스·여백·오류정정(M). 흰 바탕 포함. */
function qrDataUrl(value: string, px: number): string {
  const { span, d } = buildQrPath(value);
  return svgToDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" width="${px}" height="${px}" shape-rendering="crispEdges">` +
      `<rect width="${span}" height="${span}" fill="#ffffff"/>` +
      `<path d="${d}" fill="#000000"/>` +
      `</svg>`,
  );
}

/* ───────────────────────── 카드 ───────────────────────── */

export type MemberCardImageInput = {
  name: string;
  memberNo: string;
  memberType: string;
  /** 오늘 유효한 회원 기간 — verdict.period. 화면 카드와 같은 값 */
  period: MembershipPeriod;
  /** fetchPhotoAsDataUrl 결과. "" 이면 "사진 없음" 플레이스홀더 */
  photoDataUrl: string;
  /** QR 이 가리킬 절대 주소 — /verify/<난수토큰> */
  verifyUrl: string;
};

/** 화면 컴포넌트의 em 값을 px 로. 소수 둘째 자리까지 — satori 는 소수 px 를 받는다. */
const px = (em: number): number => Math.round(em * EM * 100) / 100;

/** 흐린 흰색 — Tailwind text-white/60 등과 같은 값 */
const white = (alpha: number): string => `rgba(255,255,255,${alpha})`;

/** 작은 안내 라벨(성명 · NAME 등) 공통 스타일 — 화면의 text-[0.62em] font-semibold tracking-[0.08em] text-white/60 */
const labelStyle = {
  fontSize: px(0.62),
  fontWeight: 700,
  letterSpacing: px(0.62 * 0.08),
  color: white(0.6),
  lineHeight: 1,
} as const;

/** 한 줄 말줄임 — 화면의 truncate */
const truncate = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const;

/** PNG 를 담은 Response(스트림). 호출자가 arrayBuffer() 로 끝까지 받아야 렌더 오류가 드러난다. */
export async function renderMemberCardImage(input: MemberCardImageInput): Promise<ImageResponse> {
  const [fonts, emblemDataUrl] = await Promise.all([loadFonts(), loadEmblemDataUrl()]);
  const { width, height } = CARD_IMAGE_SIZE;

  // 머리 엠블럼(지름 4.3em + 금색 링 0.14em)·사진·QR — MemberIdCard.tsx 의 em 값과 같다
  const emblemPx = px(4.3);
  const emblemRing = px(0.14);
  const photoW = px(7.95);
  const photoH = px(10.6);
  const qrPx = px(8.6);

  // 꼬리 글: 자기 글자 크기(0.68em)가 기준인 여백들
  const footFont = px(0.68);

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width,
          height,
          padding: `${px(0.9)}px ${px(1.2)}px ${px(0.8)}px`,
          borderRadius: px(1.2),
          overflow: "hidden",
          backgroundColor: COLOR.brand800,
          backgroundImage: `linear-gradient(135deg, ${COLOR.brand800} 0%, ${COLOR.brand900} 100%)`,
          color: COLOR.white,
          fontFamily: FONT_FAMILY,
          fontSize: EM,
        }}
      >
        {/* ── 바탕 장식: 태극 워터마크 (정보 요소 아래 한 겹) — 화면과 같은 SVG 문자열 ── */}
        <img
          src={svgToDataUrl(cardWatermarkSvg())}
          width={width}
          height={height}
          alt=""
          style={{ position: "absolute", left: 0, top: 0, width, height }}
        />

        {/* ── 머리: 엠블럼 + 워드마크 | 카드 종류 ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: px(0.8),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: px(0.7), minWidth: 0, flexShrink: 1 }}>
            {/* 흰 엠블럼 원판 + 금색 링. 화면의 rounded-full border-accent-300 bg-white shadow 와 같다 */}
            <div
              style={{
                display: "flex",
                flexShrink: 0,
                borderRadius: "50%",
                border: `${emblemRing}px solid ${COLOR.accent300}`,
                backgroundColor: COLOR.white,
                boxShadow: `0 ${px(0.3)}px ${px(0.9)}px rgba(0,0,0,0.35)`,
              }}
            >
              <img
                src={emblemDataUrl}
                width={emblemPx}
                height={emblemPx}
                alt=""
                style={{ width: emblemPx, height: emblemPx, borderRadius: "50%" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div
                style={{
                  fontSize: px(1.2),
                  fontWeight: 700,
                  letterSpacing: -px(1.2 * 0.01),
                  lineHeight: 1,
                  ...truncate,
                }}
              >
                {ORG_NAME}
              </div>
              <div
                style={{
                  marginTop: px(0.5 * 0.35),
                  fontSize: px(0.5),
                  fontWeight: 700,
                  letterSpacing: px(0.5 * 0.12),
                  color: white(0.7),
                  lineHeight: 1,
                  ...truncate,
                }}
              >
                {CARD_ORG_NAME_EN.toUpperCase()}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
            <div style={{ fontSize: px(0.85), fontWeight: 700, lineHeight: 1 }}>회원증</div>
            <div
              style={{
                marginTop: px(0.55 * 0.35),
                fontSize: px(0.55),
                fontWeight: 700,
                letterSpacing: px(0.55 * 0.18),
                color: COLOR.accent300,
                lineHeight: 1,
              }}
            >
              MEMBERSHIP CARD
            </div>
          </div>
        </div>

        {/* 금색 머리선 */}
        <div
          style={{
            marginTop: px(0.55),
            height: px(0.1),
            backgroundImage: `linear-gradient(90deg, ${COLOR.accent300} 0%, rgba(227,169,81,0.7) 50%, rgba(227,169,81,0) 100%)`,
          }}
        />

        {/* ── 몸통 ── */}
        <div style={{ display: "flex", alignItems: "center", gap: px(1), paddingTop: px(0.65), flexGrow: 1 }}>
          {input.photoDataUrl ? (
            <img
              src={input.photoDataUrl}
              width={photoW}
              height={photoH}
              alt=""
              style={{
                width: photoW,
                height: photoH,
                flexShrink: 0,
                borderRadius: px(0.55),
                border: `${px(0.14)}px solid ${COLOR.accent300}`,
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: photoW,
                height: photoH,
                flexShrink: 0,
                borderRadius: px(0.55),
                border: `${px(0.12)}px dashed rgba(255,255,255,0.35)`,
                backgroundColor: "rgba(255,255,255,0.05)",
                fontSize: px(0.8),
                color: white(0.6),
              }}
            >
              사진 없음
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              alignSelf: "stretch",
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              padding: `${px(0.2)}px 0`,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={labelStyle}>성명 · NAME</div>
              <div
                style={{
                  marginTop: px(2.1 * 0.25),
                  fontSize: px(2.1),
                  fontWeight: 700,
                  letterSpacing: -px(2.1 * 0.02),
                  lineHeight: 1.15,
                  ...truncate,
                }}
              >
                {input.name}
              </div>
            </div>

            {/* 화면의 dl grid-cols-2: 1줄 = 회원번호 | 회원구분, 2줄 = 유효기간(전체 폭) */}
            <div style={{ display: "flex", flexDirection: "column", gap: px(0.5), lineHeight: 1 }}>
              <div style={{ display: "flex", gap: px(1) }}>
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                  <div style={labelStyle}>회원번호 · NO.</div>
                  <div
                    style={{
                      marginTop: px(1.15 * 0.3),
                      fontSize: px(1.15),
                      fontWeight: 700,
                      letterSpacing: px(1.15 * 0.12),
                      color: COLOR.accent200,
                      ...truncate,
                    }}
                  >
                    {input.memberNo}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                  <div style={labelStyle}>회원구분</div>
                  <div style={{ marginTop: px(0.3), fontSize: px(1), fontWeight: 700, ...truncate }}>
                    {input.memberType}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={labelStyle}>유효기간</div>
                {/* satori: 자식이 둘 이상인 div 는 display:flex 가 있어야 한다 — 기간을 한 문자열로 */}
                <div style={{ marginTop: px(0.3), fontSize: px(1), fontWeight: 700, ...truncate }}>
                  {`${formatPeriodDate(input.period.validFrom)} ~ ${formatPeriodDate(input.period.validUntil)}`}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: px(0.35), flexShrink: 0 }}>
            {/* QR 은 자체 흰 바탕을 갖지만, 남색 위에서 경계가 또렷하도록 흰 상자에 한 번 더 담는다 */}
            <div style={{ display: "flex", borderRadius: px(0.5), backgroundColor: COLOR.white, padding: px(0.3) }}>
              <img src={qrDataUrl(input.verifyUrl, qrPx)} width={qrPx} height={qrPx} alt="" />
            </div>
            <div style={{ fontSize: px(0.68), fontWeight: 700, color: white(0.75), lineHeight: 1 }}>
              스캔하면 진위 확인
            </div>
          </div>
        </div>

        {/* ── 꼬리 ── */}
        <div
          style={{
            marginTop: px(0.6),
            paddingTop: px(0.4),
            borderTop: `${footFont * 0.08}px solid rgba(255,255,255,0.15)`,
            fontSize: footFont,
            fontWeight: 400,
            lineHeight: 1.3,
            color: white(0.65),
          }}
        >
          {"회비 납부일부터 1년간 유효합니다. " +
            "진위는 QR 로 확인해 주십시오 — 화면 캡처는 확인 근거가 되지 않습니다."}
        </div>
      </div>
    ),
    { width, height, fonts },
  );
}
