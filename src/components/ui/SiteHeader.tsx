import Link from "next/link";

import { ORG_NAME, ORG_NAME_EN, PUBLIC_PAGES, ROUTES } from "@/lib/site";

import { cn } from "./cn";

/**
 * 사이트 헤더 + 네비게이션.
 *
 * ★ JavaScript 0줄이다.
 *   모바일 메뉴는 <details>/<summary> 로 연다. 자바스크립트 번들이 필요 없고,
 *   느린 회선에서 JS 가 도착하기 전에도 메뉴가 동작한다.
 *
 * ★ 루트 레이아웃에서 DB 를 읽지 않는다.
 *   로그인 상태를 표시하려고 layout 에서 prisma 를 부르면 모든 공개 페이지가
 *   동적 렌더로 바뀐다. 공개 페이지는 정적이어야 빠르고 색인도 잘 된다.
 *   임원 이름 표시는 /officer 레이아웃(임원 화면 담당자)에서 한다.
 */
export function SiteHeader() {
  const navItems = PUBLIC_PAGES.filter((p) => p.inNav);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-sm no-print">
      {/* 키보드 사용자용 건너뛰기 링크. 탭을 처음 눌렀을 때만 나타난다. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-brand-700 focus:px-3 focus:py-2 focus:text-white"
      >
        본문 바로가기
      </a>

      <div className="mx-auto flex w-full max-w-[84rem] items-center gap-3 px-4 py-2.5 sm:px-6">
        <Link
          href={ROUTES.home}
          className="flex min-h-touch items-center gap-2.5 rounded px-1 font-bold"
        >
          <Mark />
          <span className="leading-tight">
            <span className="block text-lg">{ORG_NAME}</span>
            <span className="block text-xs font-normal text-ink-faint">{ORG_NAME_EN}</span>
          </span>
        </Link>

        <div className="flex-1" />

        {/* 데스크톱 네비 */}
        <nav data-site-nav aria-label="주요 메뉴" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-touch items-center rounded-[var(--radius-field)] px-3 font-medium text-ink-soft hover:bg-brand-50 hover:text-brand-800"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={ROUTES.login}
                className="ml-1 inline-flex min-h-touch items-center rounded-[var(--radius-field)] border border-brand-300 px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50"
              >
                회원 로그인
              </Link>
            </li>
            <li>
              <Link
                href={ROUTES.officerLogin}
                className="ml-1 inline-flex min-h-touch items-center rounded-[var(--radius-field)] border border-line-strong px-3 text-sm font-semibold text-ink-muted hover:border-brand-300 hover:text-brand-800"
              >
                임원
              </Link>
            </li>
          </ul>
        </nav>

        {/* 모바일 네비 — JS 없이 <details> 로 연다 */}
        <details className="relative md:hidden" data-site-nav>
          <summary
            className={cn(
              "flex size-touch cursor-pointer list-none items-center justify-center",
              "rounded-[var(--radius-field)] border border-line-strong text-ink-soft",
              "[&::-webkit-details-marker]:hidden",
            )}
            aria-label="메뉴 열기"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </summary>
          <nav
            aria-label="주요 메뉴"
            className="absolute right-0 z-40 mt-2 w-60 rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-[var(--shadow-pop)]"
          >
            <ul className="flex flex-col">
              {navItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-touch items-center justify-between gap-2 rounded-[var(--radius-field)] px-3 font-medium hover:bg-brand-50"
                  >
                    <span>{item.label}</span>
                    <span className="text-xs text-ink-faint">{item.labelEn}</span>
                  </Link>
                </li>
              ))}
              <li className="mt-1 border-t border-line-soft pt-1">
                <Link
                  href={ROUTES.login}
                  className="flex min-h-touch items-center rounded-[var(--radius-field)] px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                >
                  회원 로그인
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.officerLogin}
                  className="flex min-h-touch items-center rounded-[var(--radius-field)] px-3 text-sm font-semibold text-ink-muted hover:bg-brand-50"
                >
                  임원 로그인
                </Link>
              </li>
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
}

/** 로고 마크. 외부 이미지 0개 — 인라인 SVG 다. */
function Mark() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0"
      role="presentation"
    >
      <rect width="32" height="32" rx="8" fill="var(--color-brand-700)" />
      <path
        d="M9 8v16M9 16l8-8M9 16l8 8"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23.5" cy="16" r="3.2" fill="var(--color-accent-300)" />
    </svg>
  );
}
