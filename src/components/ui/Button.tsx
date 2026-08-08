import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

/**
 * 버튼.
 *
 * · 최소 높이 44px (터치 타깃). size="sm" 도 40px 아래로 내려가지 않는다.
 * · disabled 일 때는 **왜 못 누르는지** 를 반드시 같이 보여준다.
 *   회색 버튼만 덩그러니 있으면 60대 회원은 "고장났다" 고 판단하고 전화한다.
 * · 서버 컴포넌트다. onClick 이 필요하면 쓰는 쪽에서 "use client" 를 선언한다.
 */

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-field)] font-semibold " +
  "border transition-colors select-none text-center " +
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

/**
 * 비활성 스타일은 전 변종이 동일하다 — "지금 못 누른다" 는 상태는 하나뿐이므로
 * 모양도 하나여야 한다. 흐린 회색 바탕에 흰 글씨(대비 1.9:1)로 두지 않는다.
 * 노안이 있는 회원이 글자를 아예 못 읽으면 비활성 사유를 읽을 수 없다.
 */
const DISABLED =
  "disabled:bg-surface-inset disabled:text-ink-muted disabled:border-line " +
  "disabled:hover:bg-surface-inset disabled:hover:border-line disabled:brightness-100";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-700 text-white border-brand-700 hover:bg-brand-800 hover:border-brand-800 " +
    "active:bg-brand-900",
  secondary:
    "bg-surface text-brand-800 border-line-strong hover:bg-brand-50 hover:border-brand-300 " +
    "active:bg-brand-100",
  danger: "bg-danger text-white border-danger hover:brightness-95 active:brightness-90",
  ghost: "bg-transparent text-brand-800 border-transparent hover:bg-brand-50 active:bg-brand-100",
};

/** 최소 높이는 전부 44px 이상(터치 타깃). sm 도 40px 아래로 내려가지 않는다. */
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3 text-sm",
  md: "min-h-touch px-4 text-base",
  lg: "min-h-13 px-6 text-lg",
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 가로 100%. 모바일 폼 제출 버튼에 쓴다. */
  block?: boolean;
  /**
   * 비활성 사유. 지정하면 버튼이 자동으로 비활성되고, 사유가
   * title(툴팁) + 버튼 아래 작은 글씨 + aria-describedby 로 셋 다 나간다.
   * 예: "감사 계정은 읽기 전용입니다" / "이해관계가 있어 승인할 수 없습니다"
   */
  disabledReason?: string | null;
  className?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  block,
  disabledReason,
  disabled,
  className,
  children,
  id,
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || Boolean(disabledReason);
  const reasonId = disabledReason ? `${id ?? "btn"}-reason` : undefined;

  const button = (
    <button
      {...rest}
      id={id}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-describedby={reasonId}
      title={disabledReason ?? rest.title}
      className={cn(BASE, DISABLED, VARIANT[variant], SIZE[size], block && "w-full", className)}
    >
      {children}
    </button>
  );

  if (!disabledReason) return button;

  return (
    <span className={cn("inline-flex flex-col gap-1", block && "w-full")}>
      {button}
      <span id={reasonId} className="text-xs text-ink-muted">
        {disabledReason}
      </span>
    </span>
  );
}

/* ───────────────────────── 링크 버튼 ───────────────────────── */

export interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
  children: ReactNode;
  /** 외부 링크면 새 탭 + rel 을 붙인다. */
  external?: boolean;
  prefetch?: boolean;
  title?: string;
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  block,
  className,
  children,
  external,
  prefetch,
  title,
}: LinkButtonProps) {
  const classes = cn(BASE, VARIANT[variant], SIZE[size], block && "w-full", className);

  if (external) {
    return (
      <a
        href={href}
        className={classes}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} prefetch={prefetch} title={title}>
      {children}
    </Link>
  );
}

/** 버튼 여러 개를 나란히. 모바일에서는 세로로 쌓인다. */
export function ButtonRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      {children}
    </div>
  );
}
