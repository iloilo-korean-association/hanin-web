import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * 카드. data-card 속성이 붙어 있어서 인쇄 스타일(globals.css)이 테두리를 살린다.
 */
export function Card({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  /** 의미에 맞는 태그로 바꿀 수 있다. 시맨틱 HTML = 검색 색인 품질. */
  as?: "section" | "article" | "div" | "aside";
}) {
  return (
    <Tag
      data-card
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
  /** h2 가 기본. 페이지 구조에 맞춰 h3 로 낮출 수 있다(제목 레벨 건너뛰기 = 접근성 문제). */
  headingLevel = 2,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3 | 4;
}) {
  const H = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b border-line-soft px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5",
        className,
      )}
    >
      <div className="min-w-0">
        <H className={headingLevel === 2 ? "text-xl" : "text-lg"}>{title}</H>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0 no-print">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
  /** 표를 꽉 채워 넣을 때는 padding 을 없앤다. */
  flush,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return <div className={cn(flush ? "" : "px-4 py-4 sm:px-5", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-line-soft bg-surface-sub px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 카드 여러 장을 반응형 그리드로. 기본 1열 → 640px 2열 → 1024px 3열. */
export function CardGrid({
  children,
  columns = 3,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";
  return <div className={cn("grid grid-cols-1 gap-4", cols, className)}>{children}</div>;
}
