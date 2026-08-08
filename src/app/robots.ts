import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";

/**
 * /robots.txt
 *
 * ★ Apps Script 를 버린 이유 1번이 여기다.
 *   script.google.com/robots.txt 는 `Disallow: /` 였다 → 검색 노출 영구 0.
 *   회원이 "일로일로 한인회" 를 검색해서 우리 사이트를 찾을 수 없었다.
 *
 * 공개 경로는 전부 Allow, 개인정보가 있는 경로는 Disallow.
 * robots.txt 는 신사협정일 뿐이므로 next.config.ts 에서 X-Robots-Tag 헤더로
 * 한 번 더 막고, 실제 접근 통제는 guard.ts 가 한다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/me/", // 회원 매직링크 — 토큰이 색인되면 남이 열 수 있다
          "/officer", // 임원 화면
          "/dev", // 개발용 화면(빠른 로그인·아웃박스)
          "/api/", // Route Handler
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
