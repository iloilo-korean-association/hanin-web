import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { devToolsEnabled } from "@/lib/auth";
import { ROUTES } from "@/lib/site";

export const metadata: Metadata = {
  title: "개발 도구",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /dev/* 공통 레이아웃 — **프로덕션 차단 지점**.
 *
 * ★ 이 가드는 서버에서 돈다. 화면에서 링크를 숨기는 것이 아니라
 *   라우트 자체가 404 가 된다. NODE_ENV=production 이면 하위 페이지 전부 사라진다.
 *   (DEV_TOOLS=off 로도 끌 수 있다 — .env 참조)
 *
 * 여기 있는 화면은 대표가 "여러 역할을 오가며 눈으로 확인" 하기 위한 것이다.
 * 실제 제품 화면이 아니다.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!devToolsEnabled()) notFound();

  return (
    <div>
      {/* 이 화면이 제품이 아니라는 것을 한눈에 알 수 있게 경고 띠를 둔다. */}
      <div className="border-b-2 border-warn-line bg-warn-bg px-4 py-2 text-center text-sm font-semibold text-warn">
        개발 전용 화면입니다 · 프로덕션에서는 열리지 않습니다 (NODE_ENV=production → 404)
      </div>

      <nav
        aria-label="개발 도구 메뉴"
        className="border-b border-line bg-surface px-4 py-2 no-print"
      >
        <ul className="mx-auto flex max-w-[84rem] flex-wrap items-center gap-1">
          <li>
            <Link
              href={ROUTES.devLogin}
              className="inline-flex min-h-touch items-center rounded-[var(--radius-field)] px-3 font-medium hover:bg-brand-50"
            >
              빠른 로그인
            </Link>
          </li>
          <li>
            <Link
              href={ROUTES.devOutbox}
              className="inline-flex min-h-touch items-center rounded-[var(--radius-field)] px-3 font-medium hover:bg-brand-50"
            >
              메일 발송함
            </Link>
          </li>
          <li className="ml-auto">
            <Link
              href={ROUTES.home}
              className="inline-flex min-h-touch items-center rounded-[var(--radius-field)] px-3 text-sm text-ink-muted hover:bg-brand-50"
            >
              사이트로 나가기 →
            </Link>
          </li>
        </ul>
      </nav>

      {children}
    </div>
  );
}
