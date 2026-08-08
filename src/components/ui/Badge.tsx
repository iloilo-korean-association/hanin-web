import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * 뱃지.
 *
 * 색만으로 의미를 전달하지 않는다 — 항상 글자가 들어간다(색약 대응, 흑백 인쇄 대응).
 */

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warn"
  | "danger"
  | "conflict"; // 이해관계자 — danger 와 다른 색이어야 한다("틀렸다"가 아니라 "공시 대상")

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-inset text-ink-soft border-line-strong",
  info: "bg-info-bg text-info border-info-line",
  success: "bg-success-bg text-success border-success-line",
  warn: "bg-warn-bg text-warn border-warn-line",
  danger: "bg-danger-bg text-danger border-danger-line",
  conflict: "bg-conflict-bg text-conflict border-conflict-line",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  /** 앞에 붙는 작은 점. 목록에서 상태를 빠르게 훑을 때 도움이 된다. */
  dot,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-0.5",
        "text-xs font-semibold whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/**
 * 이해관계자 배지 — 이 프로젝트의 핵심 통제 장치 중 하나다.
 *
 * 업소 디렉터리와 공개 회계에서 **상시 노출**된다. 숨기거나 접어두지 마라.
 * 대표는 일로일로에서 7개 사업을 운영하고, 배우자가 로펌을 한다. 좁은 한인망에서
 * 이해관계를 먼저 밝히지 않으면 나중에 무슨 설명을 해도 늦는다.
 *
 * @param officer  관련 임원 이름과 직책. 예: "김대표(회장)"
 * @param relation 관계 유형. 예: "본인 운영", "배우자 운영", "지분 보유"
 * @param stakePct 지분율(%). 알 수 없으면 넣지 않는다 — 0 과 미상은 다르다.
 */
export function ConflictBadge({
  officer,
  relation,
  stakePct,
  className,
}: {
  officer: string;
  relation: string;
  stakePct?: number | null;
  className?: string;
}) {
  const stake =
    stakePct === null || stakePct === undefined
      ? null
      : `지분 ${Number.isInteger(stakePct) ? stakePct : stakePct.toFixed(1)}%`;

  const label = [officer, relation, stake].filter(Boolean).join(" · ");

  return (
    <Badge
      tone="conflict"
      className={cn("max-w-full", className)}
      title={`이해관계 공시: ${label}`}
    >
      <span aria-hidden="true">⚠</span>
      <span className="sr-only">이해관계 공시:</span>
      <span className="truncate">{label}</span>
    </Badge>
  );
}

/**
 * 거래 상태 배지. 05_거래.상태 값을 그대로 받는다.
 * POSTED / DRAFT / VOIDED — 문자열로 오므로 알 수 없는 값도 안전하게 표시한다.
 */
export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "POSTED":
      return (
        <Badge tone="success" dot>
          장부반영
        </Badge>
      );
    case "DRAFT":
      return (
        <Badge tone="warn" dot title="증빙 또는 2인 확인이 아직 없어 공개 집계에 잡히지 않습니다">
          미확정
        </Badge>
      );
    case "VOIDED":
      return (
        <Badge tone="danger" dot title="무효 처리됨. 거래는 삭제되지 않고 역분개로 남습니다">
          무효
        </Badge>
      );
    default:
      return <Badge tone="neutral">{status || "—"}</Badge>;
  }
}
