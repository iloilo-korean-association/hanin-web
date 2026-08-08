import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * 큰 숫자 표시 — 공개 회계 요약 3숫자(수입 / 지출 / 잔액)용.
 *
 * 왜 크게 쓰는가:
 *   공개 회계 페이지에서 회원이 알고 싶은 것은 딱 세 가지다.
 *   "얼마 걷혔나 / 얼마 썼나 / 얼마 남았나". 나머지는 그다음이다.
 *   모바일에서 스크롤 없이 이 세 숫자가 보여야 한다.
 *
 * 접근성: 숫자와 라벨을 <dl> 로 묶는다. 스크린리더가 "총수입, 1,234,000페소" 로 읽는다.
 */

export type StatTone = "neutral" | "income" | "expense" | "balance";

const VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-ink",
  income: "text-success",
  expense: "text-danger",
  balance: "text-brand-800",
};

export interface StatItem {
  label: string;
  labelEn?: string;
  /** 이미 포맷된 문자열을 넣는다. formatPeso() 를 쓰면 된다. */
  value: string;
  /** 값 아래 한 줄 보충. 예: "POSTED 거래 128건" */
  sub?: ReactNode;
  tone?: StatTone;
}

export function BigStat({ label, labelEn, value, sub, tone = "neutral", className }: StatItem & { className?: string }) {
  return (
    <div
      data-card
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-surface px-4 py-5 text-center sm:px-5",
        className,
      )}
    >
      <dt className="text-sm font-semibold text-ink-muted">
        {label}
        {labelEn ? <span className="ml-1.5 font-normal text-ink-faint">{labelEn}</span> : null}
      </dt>
      <dd
        className={cn(
          "mt-2 text-3xl leading-none font-bold tnum sm:text-4xl",
          VALUE_TONE[tone],
        )}
      >
        {value}
      </dd>
      {sub ? <dd className="mt-2 text-sm text-ink-muted">{sub}</dd> : null}
    </div>
  );
}

/** 큰 숫자 2~4개를 나란히. 모바일 1열, 640px 이상에서 나열. */
export function StatGrid({
  items,
  className,
  /** dl 전체의 접근 가능한 이름. 예: "2026 회계연도 요약" */
  label,
}: {
  items: StatItem[];
  className?: string;
  label?: string;
}) {
  const cols = items.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";
  return (
    <dl aria-label={label} className={cn("grid grid-cols-1 gap-3", cols, className)}>
      {items.map((it) => (
        <BigStat key={it.label} {...it} />
      ))}
    </dl>
  );
}

/**
 * 작은 통계 한 줄. 카드 안에서 보조 지표를 나열할 때.
 *   <StatLine label="미납 회원" value="12명" tone="expense" />
 */
export function StatLine({
  label,
  value,
  tone = "neutral",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-b-0",
        className,
      )}
    >
      <span className="text-sm text-ink-muted">{label}</span>
      <span className={cn("font-semibold tnum", VALUE_TONE[tone])}>{value}</span>
    </div>
  );
}
