import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * /officer 서브트리 공통 껍데기.
 *
 * ★ 여기서는 인가를 하지 않는다. `/officer/login` 도 이 레이아웃 아래에 있기 때문이다.
 *   실제 관문은 `(secure)/layout.tsx` 에 있고, 로그인 화면은 그 그룹 밖에 둔다.
 *   (라우트 그룹 `(secure)` 는 URL 에 나타나지 않는다 — /officer, /officer/receipt … 그대로다)
 *
 * ★ robots 를 레이아웃에서 한 번 못 박는다. 하위 페이지가 title 만 지정해도
 *   noindex 가 상속된다 — 임원 화면이 검색에 걸리는 사고를 구조적으로 막는다.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function OfficerRootLayout({ children }: { children: ReactNode }) {
  return <div className="bg-surface-app">{children}</div>;
}
