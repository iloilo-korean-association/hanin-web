import { existsSync, readFileSync } from "node:fs";

/**
 * og:image 용 한글 폰트 로더.
 *
 * 루트 src/app/opengraph-image.tsx 와 같은 방식이다(계약서가 "루트 파일의 패턴을 복사" 하라고
 * 지시하지만, 같은 코드를 세 번 적는 대신 공개 페이지들끼리는 이 파일 하나를 공유한다).
 *
 * next/og 는 Satori 위에서 돈다. Satori 에는 CJK 폰트가 내장돼 있지 않아서
 * 폰트를 넘기지 않으면 한글이 전부 두부(□□□)로 렌더된다.
 * 외부 CDN 다운로드가 금지돼 있으므로 **OS 에 설치된 시스템 폰트 파일**을 읽어서 넘긴다.
 * 하나도 못 찾으면 영문 카드로 자동 대체한다 — 빌드는 절대 깨지지 않는다.
 *
 * ★ WOFF2 는 Satori 가 못 읽는다. .ttf / .otf / .woff 여야 한다.
 */

export type LoadedFont = { data: Buffer; weight: 400 | 700 };

/**
 * turbopackIgnore 주석이 필요한 이유:
 * 번들러는 fs 호출 인자가 변수면 프로젝트 전체를 output tracing 목록에 넣어 버린다.
 * 여기서 읽는 것은 소스가 아니라 OS 에 설치된 시스템 폰트이므로 추적할 필요가 없다.
 */
function firstExisting(paths: Array<string | undefined>): string | null {
  for (const p of paths) {
    if (!p) continue;
    try {
      if (existsSync(/* turbopackIgnore: true */ p)) return p;
    } catch {
      /* 접근 불가는 없는 것으로 본다 */
    }
  }
  return null;
}

export function loadKoreanFonts(): LoadedFont[] {
  const regular = firstExisting([
    process.env.OG_FONT_PATH,
    "C:\\Windows\\Fonts\\malgun.ttf", // 맑은 고딕 (Windows 기본)
    "C:\\Windows\\Fonts\\NanumGothic.ttf",
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansKR-Regular.otf",
  ]);
  if (!regular) return [];

  const fonts: LoadedFont[] = [];
  try {
    fonts.push({ data: readFileSync(/* turbopackIgnore: true */ regular), weight: 400 });
  } catch {
    return [];
  }

  const bold = firstExisting([
    process.env.OG_FONT_BOLD_PATH,
    "C:\\Windows\\Fonts\\malgunbd.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
  ]);
  if (bold) {
    try {
      fonts.push({ data: readFileSync(/* turbopackIgnore: true */ bold), weight: 700 });
    } catch {
      /* 볼드가 없으면 레귤러만으로 렌더한다 */
    }
  }
  return fonts;
}

/** ImageResponse 의 fonts 옵션 형태로 변환. 폰트가 없으면 undefined 를 준다. */
export function ogFontOption(fonts: LoadedFont[]) {
  if (fonts.length === 0) return undefined;
  return fonts.map((f) => ({
    name: "KO" as const,
    data: f.data,
    weight: f.weight,
    style: "normal" as const,
  }));
}

/** 카드 팔레트 — globals.css 의 브랜드 토큰과 같은 값. */
export const OG = {
  navy: "#153a63",
  navyDeep: "#0f2a49",
  gold: "#e3a951",
  pale: "#b6cfea",
  white: "#ffffff",
  danger: "#a4232b",
  dangerDeep: "#7d1a20",
  success: "#3ddc97",
} as const;

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";
