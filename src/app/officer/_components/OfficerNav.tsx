"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui";

/**
 * 임원 화면 탭.
 *
 * ★ 권한이 없는 탭도 **숨기지 않는다.** 눌러 보면 서버가 왜 막는지 문장으로 알려준다.
 *   숨기면 "나는 왜 이 화면이 없지?" 가 되고, 통제가 동작하는지 아무도 확인할 수 없다.
 *   (감사 계정으로 수납 화면에 들어가 보면 서버 거부 화면이 그대로 뜬다 — 그게 증거다)
 */
export interface OfficerTab {
  href: string;
  label: string;
  /** 이 계정에서 막히는 이유. 있으면 탭에 회색 표시 + title 로 사유를 붙인다. */
  blocked: string | null;
}

export function OfficerNav({ tabs }: { tabs: OfficerTab[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="임원 업무 메뉴" className="no-print border-b border-line bg-surface">
      <ul className="mx-auto flex w-full max-w-[84rem] gap-1 overflow-x-auto px-2 sm:px-4">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                title={t.blocked ?? undefined}
                className={cn(
                  "flex min-h-touch items-center gap-1.5 whitespace-nowrap border-b-2 px-3 font-semibold",
                  active
                    ? "border-brand-700 text-brand-800"
                    : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {t.label}
                {t.blocked ? (
                  <span
                    aria-hidden="true"
                    className="rounded-[var(--radius-pill)] border border-line-strong bg-surface-inset px-1.5 text-xs font-semibold text-ink-muted"
                  >
                    잠김
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
