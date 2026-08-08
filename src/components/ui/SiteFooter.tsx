import Link from "next/link";

import { EMERGENCY_NUMBER, ORG_NAME, ORG_NAME_EN, PUBLIC_PAGES, ROUTES } from "@/lib/site";

/**
 * 사이트 푸터.
 *
 * 여기에 반드시 들어가야 하는 것 두 가지:
 *  1. 긴급번호 911 — 회원이 어느 페이지에 있든 눈에 띄어야 한다.
 *     (필리핀 전국 긴급번호는 911. 117 은 2016-08-01 폐기됐다.)
 *  2. 개인정보 처리 원칙 한 줄 — 필리핀 DPA RA10173 / 한국 PIPA.
 *     "공개 화면에 회원 실명 0건" 이 우리 약속이고, 그 약속을 명시한다.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const links = PUBLIC_PAGES.filter((p) => p.href !== "/");

  return (
    <footer
      data-site-footer
      className="mt-12 border-t border-line bg-surface no-print"
    >
      <div className="mx-auto w-full max-w-[84rem] px-4 py-8 sm:px-6">
        {/* 긴급번호 — 푸터 맨 위. 스크롤 끝까지 간 사람이 가장 먼저 본다. */}
        <div className="mb-6 flex flex-col gap-2 rounded-[var(--radius-card)] border border-danger-line bg-danger-bg px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-bold text-danger">
            생명이 위험한 상황이면 한인회보다 먼저 <span className="text-xl">{EMERGENCY_NUMBER}</span>
          </p>
          <Link href={ROUTES.sos} className="link-ika font-semibold">
            긴급 연락처 전체 보기 →
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div>
            <p className="font-bold">{ORG_NAME}</p>
            <p className="text-sm text-ink-faint">{ORG_NAME_EN}</p>
            <p className="mt-2 text-sm text-ink-muted">
              Iloilo City, Panay Island, Philippines
            </p>
          </div>

          <nav aria-label="푸터 메뉴">
            <p className="mb-2 text-sm font-semibold text-ink-muted">바로가기</p>
            <ul className="flex flex-col gap-1">
              {links.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="link-ika text-sm">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="mb-2 text-sm font-semibold text-ink-muted">개인정보</p>
            <p className="text-sm text-ink-muted">
              이 사이트의 공개 화면에는 <b>회원 실명이 표시되지 않습니다.</b> 수입은 집계로만
              공개하고, 지출은 건별로 전액 공개합니다. 여권번호·ACR I-Card·주민등록번호는
              수집하지 않습니다.
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              필리핀 Data Privacy Act (RA 10173) · 대한민국 개인정보 보호법 준수
            </p>
          </div>
        </div>

        <p className="mt-8 border-t border-line-soft pt-4 text-sm text-ink-faint">
          © {year} {ORG_NAME}. 회계 내역은 누구나 열람할 수 있습니다 —{" "}
          <Link href={ROUTES.ledger} className="link-ika">
            공개 회계
          </Link>
        </p>
      </div>
    </footer>
  );
}
