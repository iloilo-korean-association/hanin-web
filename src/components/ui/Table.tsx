import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

import { cn } from "./cn";

/**
 * 표.
 *
 * ★ 표는 **반드시** TableScroll 안에 넣는다.
 *   모바일에서 표가 본문을 밀어내면 페이지 전체가 가로로 스크롤되고,
 *   그 순간 화면은 못 쓰게 된다. 가로 스크롤은 표 안에서만 일어나야 한다.
 *
 * 인쇄할 때는 globals.css 가 [data-table-scroll] 의 overflow 를 풀어 전부 펼친다.
 */

export function TableScroll({
  children,
  className,
  /** 스크린리더/키보드 사용자를 위해 스크롤 영역에 접근 가능한 이름을 준다. */
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      data-table-scroll
      // tabIndex=0 : 키보드만 쓰는 사용자도 가로 스크롤할 수 있어야 한다(WCAG 2.1.1)
      tabIndex={0}
      role="region"
      aria-label={label}
      className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}
    >
      {children}
    </div>
  );
}

export function Table({
  children,
  className,
  /** 표가 무엇인지 설명하는 캡션. 시각적으로 숨기려면 captionHidden. */
  caption,
  captionHidden,
}: {
  children: ReactNode;
  className?: string;
  caption?: ReactNode;
  captionHidden?: boolean;
}) {
  return (
    <table className={cn("w-full min-w-max border-collapse text-left", className)}>
      {caption ? (
        <caption className={cn("pb-2 text-sm text-ink-muted", captionHidden && "sr-only")}>
          {caption}
        </caption>
      ) : null}
      {children}
    </table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-inset">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  children,
  className,
  /** 이해관계자 거래 등 눈에 띄어야 하는 행 */
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: "conflict" | "warn" | "muted";
}) {
  const toneClass =
    tone === "conflict"
      ? "bg-conflict-bg"
      : tone === "warn"
        ? "bg-warn-bg"
        : tone === "muted"
          ? "text-ink-muted"
          : "";
  return (
    <tr className={cn("border-b border-line-soft last:border-b-0", toneClass, className)}>
      {children}
    </tr>
  );
}

export interface CellProps {
  children?: ReactNode;
  className?: string;
  /** 금액·수량은 오른쪽 정렬 + 고정폭 숫자 */
  numeric?: boolean;
}

export function TH({
  children,
  className,
  numeric,
  scope = "col",
  ...rest
}: CellProps & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
      scope={scope}
      className={cn(
        "whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-ink-soft",
        numeric && "text-right tnum",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
  numeric,
  ...rest
}: CellProps & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...rest}
      className={cn("px-3 py-2.5 align-top", numeric && "text-right tnum whitespace-nowrap", className)}
    >
      {children}
    </td>
  );
}

/**
 * 표를 카드 안에 꽉 채워 넣는 흔한 조합.
 *   <Card><CardHeader title="지출 내역" /><TableCardBody label="지출 내역"> … </TableCardBody></Card>
 */
export function TableCardBody({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <TableScroll label={label}>{children}</TableScroll>
    </div>
  );
}
