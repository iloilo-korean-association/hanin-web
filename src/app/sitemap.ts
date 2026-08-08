import type { MetadataRoute } from "next";

import { absoluteUrl, PUBLIC_PAGES } from "@/lib/site";

/**
 * /sitemap.xml — 공개 페이지만.
 *
 * 회원·임원·개발 화면은 절대 넣지 않는다. 사이트맵에 URL 을 넣는 것은
 * "이 주소를 크롤링해 달라" 는 초대장이다.
 *
 * lastModified 를 빌드 시각으로 둔다. 콘텐츠가 DB 에서 오는 페이지
 * (행사·업소)는 나중에 각 담당자가 실제 갱신시각으로 바꾸면 된다.
 * [확인 필요] 행사·업소 상세 페이지가 생기면 여기에 동적 항목을 추가한다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(page.href),
    lastModified: now,
    changeFrequency: page.href === "/ledger" ? ("daily" as const) : ("weekly" as const),
    priority: page.priority,
  }));
}
