import { existsSync, readFileSync } from "node:fs";

import { ImageResponse } from "next/og";

import { ORG_NAME, ORG_NAME_EN, ORG_TAGLINE, SITE_URL } from "@/lib/site";

/**
 * og:image — 1200×630 카드를 동적으로 생성한다.
 *
 * ★ Apps Script 로는 불가능했던 것.
 *   HtmlOutput.addMetaTag 허용 목록에 og: 가 없어서 카톡에 링크를 붙여도
 *   제목·설명·썸네일이 하나도 안 떴다. 한인회 공지가 카톡으로 도는 커뮤니티에서
 *   이건 치명적이다. 여기서는 실제 PNG 카드를 만들어 붙인다.
 *
 * ─── 한글 폰트 문제 (직접 확인한 사실) ─────────────────────────────────────
 * next/og 는 Satori 위에서 돈다. Satori 에는 **CJK 폰트가 내장돼 있지 않다**
 * (기본 폰트는 라틴 전용 Noto Sans). 폰트를 넘기지 않으면 한글이 전부
 * 빈 네모(두부)로 렌더된다.
 *
 * 이 프로젝트는 외부 CDN 다운로드가 금지돼 있으므로(오프라인 원칙),
 * **로컬에 이미 설치된 시스템 폰트 파일을 읽어서** 넘긴다.
 *   · Windows: C:\Windows\Fonts\malgun.ttf (맑은 고딕) — 대표 PC 에서 확인함
 *   · 환경변수 OG_FONT_PATH 로 다른 파일을 지정할 수 있다
 *   · 하나도 없으면 **영문 전용 카드로 자동 대체**한다. 빌드는 절대 깨지지 않는다.
 * ★ WOFF2 는 Satori 가 못 읽는다. .ttf / .otf / .woff 여야 한다.
 *
 * 프로덕션(리눅스 서버)으로 옮길 때는 프로젝트 안에 서브셋 한글 TTF 를 하나
 * 커밋해 두고 OG_FONT_PATH 로 가리키는 것이 가장 안전하다.
 * 13MB 짜리 시스템 폰트를 그대로 쓰면 빌드가 느려진다.
 */

export const alt = `${ORG_NAME} — ${ORG_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type LoadedFont = { data: Buffer; weight: 400 | 700 };

/**
 * ★ turbopackIgnore 주석이 필요한 이유:
 *   번들러는 fs 호출의 인자가 변수면 "이 모듈이 무슨 파일을 읽을지 모르겠다" 고 판단해
 *   프로젝트 전체를 output tracing 목록에 넣어 버린다(빌드 경고 + 배포 산출물 비대).
 *   여기서 읽는 것은 소스가 아니라 **OS 에 설치된 시스템 폰트**이므로 추적할 필요가 없다.
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

/** 한글 폰트를 찾아 읽는다. 못 찾으면 빈 배열(→ 영문 카드로 대체). */
function loadKoreanFonts(): LoadedFont[] {
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

const NAVY = "#153a63";
const NAVY_DEEP = "#0f2a49";
const GOLD = "#e3a951";
const PALE = "#b6cfea";

export default async function OpengraphImage() {
  const fonts = loadKoreanFonts();
  const hasKorean = fonts.length > 0;

  // 한글 폰트를 못 찾은 환경에서는 라틴 문자만 그린다.
  // 두부(□□□)가 박힌 카드를 내보내느니 영문 카드가 낫다.
  const title = hasKorean ? ORG_NAME : ORG_NAME_EN;
  const subtitle = hasKorean ? ORG_NAME_EN : "Korean Community of Iloilo, Philippines";
  const chips = hasKorean
    ? ["회계 전액 공개", "긴급 연락처", "한인 업소 안내"]
    : ["Open Ledger", "Emergency Contacts", "Business Directory"];
  const host = SITE_URL.replace(/^https?:\/\//, "");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          backgroundColor: NAVY,
          backgroundImage: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DEEP} 100%)`,
          fontFamily: hasKorean ? "KO" : "sans-serif",
          color: "#ffffff",
        }}
      >
        {/* 상단: 마크 + 조직 성격 */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              width: 72,
              height: 72,
              borderRadius: 20,
              backgroundColor: "#ffffff",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: GOLD,
              }}
            />
          </div>
          <div style={{ display: "flex", fontSize: 30, color: PALE, letterSpacing: 2 }}>
            ILOILO · PANAY · PHILIPPINES
          </div>
        </div>

        {/* 가운데: 이름 */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 104, fontWeight: 700, lineHeight: 1.1 }}>
            {title}
          </div>
          <div style={{ display: "flex", marginTop: 16, fontSize: 40, color: PALE }}>
            {subtitle}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 34,
              width: 140,
              height: 8,
              borderRadius: 4,
              backgroundColor: GOLD,
            }}
          />
        </div>

        {/* 하단: 무엇을 하는 곳인지 + 주소 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: 14 }}>
            {chips.map((c) => (
              <div
                key={c}
                style={{
                  display: "flex",
                  padding: "12px 24px",
                  borderRadius: 999,
                  border: `2px solid ${PALE}`,
                  fontSize: 28,
                  color: "#ffffff",
                }}
              >
                {c}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 26, color: PALE }}>{host}</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: hasKorean
        ? fonts.map((f) => ({
            name: "KO",
            data: f.data,
            weight: f.weight,
            style: "normal" as const,
          }))
        : undefined,
    },
  );
}
