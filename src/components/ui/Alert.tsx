import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * 알림 박스 (정보 / 경고 / 성공 / 오류).
 *
 * · 아이콘은 문자 하나로 그린다 — 외부 아이콘 폰트·SVG 라이브러리를 넣지 않는다.
 * · 오류·경고는 role="alert" 로 스크린리더가 즉시 읽게 한다.
 * · 색만으로 구분하지 않는다. 항상 제목 텍스트가 의미를 말한다.
 */

export type AlertTone = "info" | "warn" | "success" | "error";

const TONE: Record<AlertTone, { box: string; icon: string; srLabel: string }> = {
  info: { box: "bg-info-bg border-info-line text-info", icon: "ℹ", srLabel: "안내" },
  warn: { box: "bg-warn-bg border-warn-line text-warn", icon: "⚠", srLabel: "경고" },
  success: { box: "bg-success-bg border-success-line text-success", icon: "✓", srLabel: "완료" },
  error: { box: "bg-danger-bg border-danger-line text-danger", icon: "✕", srLabel: "오류" },
};

export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** 버튼/링크 한두 개. "어떻게 하면 되는가" 를 같이 준다. */
  action?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  const live = tone === "error" || tone === "warn";
  return (
    <div
      role={live ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-[var(--radius-card)] border px-4 py-3.5",
        t.box,
        className,
      )}
    >
      <span aria-hidden="true" className="mt-0.5 text-lg leading-none font-bold">
        {t.icon}
      </span>
      <div className="min-w-0 flex-1">
        <span className="sr-only">{t.srLabel}: </span>
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? (
          <div className={cn("text-ink-soft", title && "mt-1")}>{children}</div>
        ) : null}
        {action ? <div className="mt-3 no-print">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * 인가 거부 화면. GuardError 를 그대로 그린다.
 *
 *   try { await requireOfficer({ permissions: ["확인권"], write: true }); }
 *   catch (e) { if (isGuardError(e)) return <GuardDenied message={e.message} howToFix={e.howToFix} />; throw e; }
 */
export function GuardDenied({
  message,
  howToFix,
  action,
}: {
  message: string;
  howToFix?: string | null;
  action?: ReactNode;
}) {
  return (
    <Alert tone="error" title={message} action={action}>
      {howToFix ? <p>{howToFix}</p> : null}
    </Alert>
  );
}
