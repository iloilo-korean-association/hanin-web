import type { Metadata, Viewport } from "next";

import { SiteFooter } from "@/components/ui/SiteFooter";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { ORG_NAME, ORG_NAME_EN, ORG_TAGLINE, SITE_URL } from "@/lib/site";

import "./globals.css";

/**
 * 루트 메타데이터.
 *
 * ★ 이게 Apps Script 로는 불가능했던 부분이다.
 *   HtmlOutput.addMetaTag 는 허용 목록이 4개뿐이라 og: 태그를 넣을 수 없었고,
 *   그래서 카톡에 링크를 붙여도 썸네일 카드가 뜨지 않았다.
 *   여기서는 Metadata API 로 og:/twitter: 를 전부 내보낸다.
 *
 * metadataBase 가 없으면 og:image 가 상대경로로 나가고, 카카오톡·페이스북은
 * 상대경로 이미지를 무시한다 → 카드에 이미지가 안 뜬다. 반드시 절대주소여야 한다.
 *
 * 페이지별 title/description 은 각 page.tsx 에서 export const metadata 로 덮는다.
 *   export const metadata: Metadata = { title: "공개 회계", description: "…" };
 *   → <title>공개 회계 | 일로일로 한인회</title>
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${ORG_NAME} — ${ORG_TAGLINE}`,
    template: `%s | ${ORG_NAME}`,
  },
  description:
    "필리핀 일로일로 지역 한인 커뮤니티의 공식 홈페이지입니다. 회비와 기부금 사용 내역을 건별로 전액 공개하고, 긴급 상황 연락처와 한인 업소 정보를 제공합니다.",
  applicationName: ORG_NAME,
  keywords: [
    "일로일로 한인회",
    "필리핀 한인회",
    "Iloilo Korean Association",
    "일로일로 교민",
    "파나이 한인",
    "일로일로 긴급 연락처",
  ],
  authors: [{ name: ORG_NAME }],
  creator: ORG_NAME,
  publisher: ORG_NAME,
  formatDetection: { telephone: false, address: false, email: false },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    alternateLocale: ["en_PH"],
    url: SITE_URL,
    siteName: ORG_NAME,
    title: `${ORG_NAME} · ${ORG_NAME_EN}`,
    description:
      "회비와 기부금이 어디에 쓰였는지 건별로 공개합니다. 긴급 상황 연락처, 한인 업소 안내, 회원 가입.",
    // og:image 는 src/app/opengraph-image.tsx 가 자동으로 붙인다(1200×630 동적 생성).
  },
  twitter: {
    card: "summary_large_image",
    title: `${ORG_NAME} · ${ORG_NAME_EN}`,
    description: "회비와 기부금 사용 내역 전액 공개 · 긴급 연락처 · 업소 안내",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  category: "community",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale 을 막지 않는다 — 확대를 막으면 노안이 있는 회원이 글자를 못 읽는다.
  viewportFit: "cover",
  themeColor: "#1b4373",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="flex min-h-dvh flex-col">
        <SiteHeader />
        {/* id="main" 은 헤더의 '본문 바로가기' 링크가 가리키는 곳이다. */}
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
