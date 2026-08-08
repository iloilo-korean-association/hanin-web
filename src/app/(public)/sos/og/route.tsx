import { ImageResponse } from "next/og";

import { EMERGENCY_NUMBER, ORG_NAME, ORG_NAME_EN } from "@/lib/site";

import { OG, OG_SIZE, loadKoreanFonts, ogFontOption } from "../../_components/og-font";

/**
 * GET /sos/og — 긴급 연락처 화면의 카톡 썸네일 카드 (1200×630 PNG).
 *
 * 이 링크는 사람이 다쳤을 때 카톡방에 붙는다. 카드만 보고도 번호를 읽을 수 있어야 한다.
 * 그래서 911 을 카드에서 제일 크게 그린다 — 링크를 열지 않아도 정보가 전달된다.
 *
 * ─── 왜 `opengraph-image.tsx` 파일 규약을 쓰지 않았나 (직접 확인한 사실) ──────
 * ① 페이지에서 `metadata.openGraph` 를 정의하면 부모의 og:image 가 통째로 사라진다.
 *    → 어차피 `openGraph.images` 에 주소를 직접 적어야 한다.
 * ② 그런데 라우트 그룹 안의 `opengraph-image.tsx` 는 내용 해시가 붙은 주소
 *    (`/sos/opengraph-image-15ult4`)로 생성된다 — 내용이 바뀌면 주소가 바뀌므로 적을 수가 없다.
 *    (`npm run build` 라우트 목록에서 확인)
 * → 그래서 주소가 고정되는 라우트 핸들러로 만든다. `/sos/og` 는 절대 바뀌지 않는다.
 */
export const alt = `${ORG_NAME} 긴급 연락처 — 필리핀 전국 긴급번호 ${EMERGENCY_NUMBER}`;
export const size = OG_SIZE;

export async function GET() {
  const fonts = loadKoreanFonts();
  const ko = fonts.length > 0;

  const heading = ko ? "긴급 연락처" : "Emergency Contacts";
  const org = ko ? ORG_NAME : ORG_NAME_EN;
  const lead = ko ? "생명이 위험하면 한인회보다 먼저" : "If life is in danger, call first";
  const sub = ko ? "경찰 · 소방 · 구급 / 무료 / 전국" : "Police · Fire · Ambulance / Free";
  const chips = ko
    ? ["주세부분관 야간 +63-917-808-3907", "영사콜센터 +82-2-3210-0404"]
    : ["Cebu Consulate +63-917-808-3907", "Consular Call Center +82-2-3210-0404"];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundColor: OG.danger,
          backgroundImage: `linear-gradient(135deg, ${OG.danger} 0%, ${OG.dangerDeep} 100%)`,
          fontFamily: ko ? "KO" : "sans-serif",
          color: OG.white,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 2, opacity: 0.85 }}>
            {org} · ILOILO · PHILIPPINES
          </div>
          <div style={{ display: "flex", marginTop: 10, fontSize: 54, fontWeight: 700 }}>
            {heading}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "10px 44px",
              borderRadius: 28,
              backgroundColor: OG.white,
              color: OG.danger,
              fontSize: 168,
              fontWeight: 700,
              letterSpacing: 6,
            }}
          >
            {EMERGENCY_NUMBER}
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 520 }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{lead}</div>
            <div style={{ display: "flex", marginTop: 12, fontSize: 28, opacity: 0.9 }}>{sub}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 14 }}>
          {chips.map((c) => (
            <div
              key={c}
              style={{
                display: "flex",
                padding: "12px 22px",
                borderRadius: 999,
                border: "2px solid rgba(255,255,255,0.55)",
                fontSize: 24,
              }}
            >
              {c}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts: ogFontOption(fonts) },
  );
}
