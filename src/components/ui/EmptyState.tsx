import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * 빈 상태.
 *
 * "데이터 없음" 만 띄우지 않는다. 왜 비어 있는지, 무엇을 하면 채워지는지 쓴다.
 * 회계 화면에서 빈 표는 "고장" 으로 오해되기 가장 쉬운 화면이다.
 */
export function EmptyState({
  title,
  description,
  action,
  icon = "📄",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** 이모지 한 글자. 외부 아이콘을 쓰지 않는다. */
  icon?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface-sub px-6 py-10 text-center",
        className,
      )}
    >
      <span aria-hidden="true" className="text-3xl">
        {icon}
      </span>
      <p className="text-lg font-semibold">{title}</p>
      {description ? <p className="max-w-prose text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2 no-print">{action}</div> : null}
    </div>
  );
}
