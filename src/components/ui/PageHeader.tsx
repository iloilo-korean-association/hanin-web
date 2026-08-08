import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * 페이지 제목 + 설명 + 액션.
 *
 * 페이지마다 h1 이 정확히 하나 있어야 한다 — 접근성이자 검색 색인 품질이다.
 * 이 컴포넌트가 그 h1 을 담당한다. 화면에서 h1 을 따로 쓰지 마라.
 */
export function PageHeader({
  title,
  titleEn,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: ReactNode;
  /** 핵심 항목 영문 병기. 예: "공개 회계" + "Open Ledger" */
  titleEn?: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: Array<{ href: string; label: string }>;
  className?: string;
}) {
  return (
    <header className={cn("mb-6", className)}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav aria-label="현재 위치" className="mb-2 no-print">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
            {breadcrumb.map((b, i) => (
              <li key={b.href} className="flex items-center gap-1">
                {i > 0 ? <span aria-hidden="true">›</span> : null}
                <Link href={b.href} className="link-ika">
                  {b.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl">
            {title}
            {titleEn ? (
              <span className="ml-2 align-middle text-base font-normal text-ink-faint">
                {titleEn}
              </span>
            ) : null}
          </h1>
          {description ? (
            <p className="mt-2 max-w-prose text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0 no-print">{actions}</div> : null}
      </div>
    </header>
  );
}

/** 페이지 본문 컨테이너. 모든 화면이 같은 좌우 여백·최대폭을 쓰게 한다. */
export function PageContainer({
  children,
  className,
  wide,
}: {
  children: ReactNode;
  className?: string;
  /** 표가 넓은 화면(회계·승인)은 wide 로 여유를 준다. */
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-6 sm:px-6 sm:py-8",
        wide ? "max-w-[84rem]" : "max-w-[var(--container-page)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 섹션 사이 세로 간격을 통일한다. */
export function Stack({
  children,
  className,
  gap = "md",
}: {
  children: ReactNode;
  className?: string;
  gap?: "sm" | "md" | "lg";
}) {
  const g = gap === "sm" ? "gap-3" : gap === "lg" ? "gap-8" : "gap-5";
  return <div className={cn("flex flex-col", g, className)}>{children}</div>;
}
