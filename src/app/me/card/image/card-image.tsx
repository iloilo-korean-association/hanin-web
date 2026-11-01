import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { buildQrPath } from "@/components/ui/QrCode";
import { formatPeriodDate, type MembershipPeriod } from "@/lib/domain/membershipPeriod";

import { CARD_COLORS, CARD_FONTS, CARD_LAYOUT, photoPlaceholderSvg, svgToDataUrl } from "../../_portal/card-art";

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
 *  화면 카드는 가변 요소가 전부 em 이고, em = 카드 폭 / 34.24 (globals.css).
 *  여기서는 카드 폭 1712px(실물 85.6mm 의 2x) → 1em = 50px 로 **같은 비율**을 px 로 환산해
 *  그린다. 자리는 card-art.ts 의 CARD_LAYOUT(정본)을 그대로 쓰고, 색은 CARD_COLORS
 *  (= globals.css 의 card-ink 토큰) 그대로다.
 *  satori 는 Tailwind 를 모르고 flex 기반 CSS 서브셋만 알아듣기 때문에 인라인 스타일로
 *  그렸다 — 레이아웃을 바꿀 때는 **MemberIdCard.tsx 와 이 파일을 같이** 고쳐야 한다.
 *
 * ── 배경 플레이트 ───────────────────────────────────────────────────────
 *  대표 디자인에서 가변 요소만 지운 그림(public/brand/card-plate.jpg, 1579×996)을 fs 로 읽어
 *  데이터 URL <img> 로 바닥에 깐다. 1712×1080 으로 8% 키워 깔린다(비율이 같아 잘리지 않는다).
 *  화면은 같은 파일을 CSS background 로 쓴다. 제목·엠블럼·라벨·알약 테·QR 금테·안내문은
 *  전부 그 그림 안에 있어서 여기서 그리지 않는다.
 *
 * ── 글꼴 ────────────────────────────────────────────────────────────────
 *  satori 에는 CJK 폰트가 없다 → 폰트 버퍼를 넘겨야 한다. 운영 서버(Vercel, 리눅스)에는
 *  한글 시스템 폰트가 없고 외부 CDN 호출은 금지라, 서브셋 TTF 를 ./fonts 에 커밋해 두고 fs 로 읽는다.
 *  (출처·라이선스·글자 범위·만든 방법은 fonts/README.md)
 *   · 이름(한글)          : 배민 을지로체 서브셋 — KS X 1001 한글 2350자 + ASCII
 *   · 회원번호·유효기간   : 나눔명조 Bold 서브셋 — 숫자·영문·. ~ - : 만
 *   · 구분 알약·영문 이름·"사진 없음"·폴백 : Noto Sans KR 서브셋(400/700)
 *  어느 글꼴을 어디에 쓰는지·배율은 card-art.ts 의 CARD_FONTS / CARD_LAYOUT(fontScale)이 정본이고,
 *  화면(MemberIdCard.tsx)은 **같은 TTF 파일**을 next/font/local 로 쓴다(card-fonts.ts).
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

/** 바탕 글꼴(폴백·구분 알약·영문 이름·"사진 없음") — 이름·숫자는 요소에서 CARD_FONTS 로 덮는다 */
const FONT_FAMILY = CARD_FONTS.label.family;

/* ───────────────────────── 폰트 ───────────────────────── */

type FontOption = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

let fontsPromise: Promise<FontOption[]> | null = null;

/**
 * 폰트는 프로세스에 한 번만 읽는다(네 파일 합쳐 약 2.3MB — 을지로체 한글 2350자가 1.4MB).
 * 경로를 리터럴로 적는 이유: Next 의 output tracing 이 fs 호출의 **리터럴 인자**를 보고
 * 배포 산출물에 파일을 포함시킨다. 변수로 합치면 추적이 빠진다(next.config.ts 의
 * outputFileTracingIncludes 가 2중 안전장치).
 */
function loadFonts(): Promise<FontOption[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(join(process.cwd(), "src/app/me/card/image/fonts/NotoSansKR-Regular.subset.ttf")),
      readFile(join(process.cwd(), "src/app/me/card/image/fonts/NotoSansKR-Bold.subset.ttf")),
      readFile(join(process.cwd(), "src/app/me/card/image/fonts/BMEuljiro.subset.ttf")),
      readFile(join(process.cwd(), "src/app/me/card/image/fonts/NanumMyeongjo-Bold.subset.ttf")),
    ])
      .then(([regular, bold, euljiro, myeongjoBold]): FontOption[] => [
        { name: FONT_FAMILY, data: regular, weight: 400, style: "normal" },
        { name: FONT_FAMILY, data: bold, weight: 700, style: "normal" },
        { name: CARD_FONTS.name.family, data: euljiro, weight: CARD_FONTS.name.weight, style: "normal" },
        { name: CARD_FONTS.number.family, data: myeongjoBold, weight: CARD_FONTS.number.weight, style: "normal" },
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

/* ───────────────────────── 배경 플레이트 ───────────────────────── */

let platePromise: Promise<string> | null = null;

/**
 * 배경 플레이트(public/brand/card-plate.jpg)를 데이터 URL 로. 화면의 CSS background 와
 * 같은 파일이다. 폰트와 같은 이유로 경로를 리터럴로 적는다(next.config 의
 * outputFileTracingIncludes 에도 올라 있다). 프로세스에 한 번만 읽는다(약 280KB).
 */
function loadPlateDataUrl(): Promise<string> {
  if (!platePromise) {
    platePromise = readFile(join(process.cwd(), "public/brand/card-plate.jpg"))
      .then((jpg) => `data:image/jpeg;base64,${jpg.toString("base64")}`)
      .catch((e: unknown) => {
        platePromise = null;
        throw e;
      });
  }
  return platePromise;
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
  /** 성명_영문(대문자). "" 이면 영문을 그리지 않는다 — 한글 이름 위치는 그대로 */
  nameEn: string;
  memberNo: string;
  memberType: string;
  /** 오늘 유효한 회원 기간 — verdict.period. 화면 카드와 같은 값 */
  period: MembershipPeriod;
  /** fetchPhotoAsDataUrl 결과. "" 이면 실루엣 플레이스홀더 */
  photoDataUrl: string;
  /** QR 이 가리킬 절대 주소 — /verify/<난수토큰> */
  verifyUrl: string;
};

/** 화면 컴포넌트의 em 값을 px 로. 소수 둘째 자리까지 — satori 는 소수 px 를 받는다. */
const px = (em: number): number => Math.round(em * EM * 100) / 100;

/** 한 줄 말줄임 — 화면의 truncate */
const truncate = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const;

/** PNG 를 담은 Response(스트림). 호출자가 arrayBuffer() 로 끝까지 받아야 렌더 오류가 드러난다. */
export async function renderMemberCardImage(input: MemberCardImageInput): Promise<ImageResponse> {
  const [fonts, plateDataUrl] = await Promise.all([loadFonts(), loadPlateDataUrl()]);
  const { width, height } = CARD_IMAGE_SIZE;
  const L = CARD_LAYOUT;

  const photoBox = {
    position: "absolute",
    left: px(L.photo.left),
    top: px(L.photo.top),
    width: px(L.photo.width),
    height: px(L.photo.height),
    borderRadius: px(L.photo.radius),
  } as const;
  const qrPx = px(L.qr.size);
  // 글꼴별 보정 배율을 곱한 실제 글자 크기(em) — 화면(MemberIdCard.tsx)과 같은 식
  const nameFs = L.name.fontSize * L.name.fontScale;
  const memberNoFs = L.memberNo.fontSize * L.memberNo.fontScale;
  const periodFs = L.period.fontSize * L.period.fontScale;

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width,
          height,
          borderRadius: px(L.radius),
          overflow: "hidden",
          backgroundColor: "#f6f1ea",
          color: CARD_COLORS.ink,
          fontFamily: FONT_FAMILY,
          fontSize: EM,
        }}
      >
        {/* ── 바탕: 플레이트 그림 (화면의 CSS background 와 같은 파일) ── */}
        <img
          src={plateDataUrl}
          width={width}
          height={height}
          alt=""
          style={{ position: "absolute", left: 0, top: 0, width, height, objectFit: "cover" }}
        />

        {/* ── 사진 (플레이트의 금테 안) ── */}
        {input.photoDataUrl ? (
          <img
            src={input.photoDataUrl}
            width={photoBox.width}
            height={photoBox.height}
            alt=""
            style={{ ...photoBox, objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              ...photoBox,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              overflow: "hidden",
            }}
          >
            <img
              src={svgToDataUrl(photoPlaceholderSvg())}
              width={photoBox.width}
              height={photoBox.height}
              alt=""
              style={{ position: "absolute", left: 0, top: 0, width: photoBox.width, height: photoBox.height }}
            />
            <div
              style={{
                marginBottom: px(0.7 * 0.6),
                fontSize: px(0.7),
                fontWeight: 700,
                lineHeight: 1,
                color: "rgba(11,29,71,0.55)",
              }}
            >
              사진 없음
            </div>
          </div>
        )}

        {/* ── 이름 (+ 영문, 있을 때만). 아래 정렬이라 영문이 있든 없든 한글 자리는 같다 ── */}
        <div
          style={{
            position: "absolute",
            left: px(L.name.left),
            top: px(L.name.top),
            maxWidth: px(L.name.maxWidth),
            display: "flex",
            alignItems: "flex-end",
            fontSize: px(nameFs),
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {/* 한글 이름 — 을지로체(400 하나뿐. 700 을 적으면 satori 가 폴백으로 넘어간다) */}
          <div
            style={{
              flexShrink: 0,
              fontFamily: CARD_FONTS.name.family,
              fontWeight: CARD_FONTS.name.weight,
              letterSpacing: px(nameFs * L.name.tracking),
            }}
          >
            {input.name}
          </div>
          {input.nameEn ? (
            <div
              style={{
                marginLeft: px(L.nameEn.gap),
                fontFamily: FONT_FAMILY,
                fontSize: px(L.nameEn.fontSize),
                fontWeight: 700,
                letterSpacing: px(L.nameEn.fontSize * 0.04),
                lineHeight: 1,
                color: "rgba(11,29,71,0.7)",
                minWidth: 0,
                ...truncate,
              }}
            >
              {input.nameEn}
            </div>
          ) : null}
        </div>

        {/* ── 회원번호 (플레이트의 금테 알약 안) ── */}
        <div
          style={{
            position: "absolute",
            left: px(L.memberNo.left),
            top: px(L.memberNo.top),
            width: px(L.memberNo.width),
            height: px(L.memberNo.height),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: CARD_FONTS.number.family,
            fontWeight: CARD_FONTS.number.weight,
            fontSize: px(memberNoFs),
            letterSpacing: px(memberNoFs * L.memberNo.tracking),
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {input.memberNo}
        </div>

        {/* ── 회원구분 (플레이트의 남색 알약 안, 흰 글자) ── */}
        <div
          style={{
            position: "absolute",
            left: px(L.memberType.left),
            top: px(L.memberType.top),
            width: px(L.memberType.width),
            height: px(L.memberType.height),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: px(L.memberType.fontSize),
            fontWeight: 700,
            lineHeight: 1,
            color: CARD_COLORS.white,
            whiteSpace: "nowrap",
          }}
        >
          {input.memberType}
        </div>

        {/* ── 유효기간 — satori: 자식이 둘 이상인 div 는 display:flex 가 있어야 한다 → 한 문자열로 ── */}
        <div
          style={{
            position: "absolute",
            left: px(L.period.left),
            top: px(L.period.top),
            fontFamily: CARD_FONTS.number.family,
            fontWeight: CARD_FONTS.number.weight,
            fontSize: px(periodFs),
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {`${formatPeriodDate(input.period.validFrom)} ~ ${formatPeriodDate(input.period.validUntil)}`}
        </div>

        {/* ── QR (플레이트의 금테 흰 상자 안). 자체 흰 여백(quiet zone)을 갖는다 ── */}
        <img
          src={qrDataUrl(input.verifyUrl, qrPx)}
          width={qrPx}
          height={qrPx}
          alt=""
          style={{ position: "absolute", left: px(L.qr.left), top: px(L.qr.top), width: qrPx, height: qrPx }}
        />
      </div>
    ),
    { width, height, fonts },
  );
}
