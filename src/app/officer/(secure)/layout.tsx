import Link from "next/link";
import type { ReactNode } from "react";

import { Badge, GuardDenied, LinkButton, PageContainer } from "@/components/ui";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { OfficerNav, type OfficerTab } from "../_components/OfficerNav";
import { officerLogoutAction } from "../login/actions";

/**
 * 임원 화면의 **관문**.
 *
 * ★ 로그인·임기·상태 검사는 여기서 한 번, 각 페이지에서 권한별로 또 한 번,
 *   그리고 모든 서버 액션의 첫 줄에서 다시 한 번 한다. 세 겹인 이유:
 *   레이아웃은 폼을 직접 POST 하는 요청을 막지 못하고, 페이지 가드는 액션을 막지 못한다.
 *   **화면에서 버튼을 숨기는 것은 통제가 아니다.**
 *
 * ★ 라우트 그룹 `(secure)` 는 URL 에 나타나지 않는다.
 *   /officer · /officer/receipt · /officer/expense · /officer/approve · /officer/audit 그대로다.
 *   로그인 화면(/officer/login)은 이 그룹 밖에 있어서 이 가드를 타지 않는다.
 */
export default async function SecureOfficerLayout({ children }: { children: ReactNode }) {
  let me;
  try {
    me = await requireOfficer({ screen: "임원 화면" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <div className="py-8">
            <GuardDenied
              message={e.message}
              howToFix={e.howToFix}
              action={
                <LinkButton href={ROUTES.officerLogin} variant="primary">
                  임원 로그인으로 가기
                </LinkButton>
              }
            />
          </div>
        </PageContainer>
      );
    }
    throw e;
  }

  const writeBlocked = me.isAuditor
    ? "감사 계정은 읽기 전용입니다. 열 수는 있지만 서버가 저장을 거부합니다."
    : null;

  const tabs: OfficerTab[] = [
    { href: ROUTES.officer, label: "대시보드", blocked: null },
    // 장부 — 수입·지출을 한 화면에서 직접 적는다.
    // 예전의 '수납' + '지출 요청' + '승인·집행' 세 탭이 여기 하나로 합쳐졌다.
    {
      href: `${ROUTES.officer}/book`,
      label: "장부",
      blocked: writeBlocked ?? (me.can("입력권") ? null : "입력권이 없는 직책입니다."),
    },
    { href: `${ROUTES.officer}/audit`, label: "감사", blocked: null },
    // 승인 이력 — 사전 승인 제도를 쓰던 시기의 결재 기록. 열람만 된다.
    { href: `${ROUTES.officer}/approve`, label: "승인 이력", blocked: null },

    // 장부 가져오기 (L3/L4) — 실장부 엑셀을 웹 장부로 옮기는 통로.
    // 목록·대조표는 조회권만 있으면 열리고, 업로드·반영·연결만 입력권이 막는다.
    {
      href: `${ROUTES.officer}/ledger-import`,
      label: "장부 가져오기",
      blocked: writeBlocked ?? (me.can("입력권") ? null : "입력권이 없는 직책입니다."),
    },

    // 회원 명부 — 읽기 전용(v1). 개인정보 화면이라 임원(조회권) 전용이다.
    {
      href: `${ROUTES.officer}/members`,
      label: "회원",
      blocked: me.can("조회권") ? null : '"조회권"이 없는 직책입니다.',
    },

    // ── 자료 관리 ──────────────────────────────────────────────────
    // 권한이 없어도 탭은 보인다. 목록은 열리고 편집만 잠긴다 —
    // 숨기면 "내 권한이 어디까지인지" 를 본인도 확인할 수 없다.
    {
      href: `${ROUTES.officer}/vendors`,
      label: "업소",
      blocked: writeBlocked ?? (me.can("업소관리") ? null : '"업소관리" 권한이 없습니다.'),
    },
    {
      href: `${ROUTES.officer}/events`,
      label: "행사",
      blocked: writeBlocked ?? (me.can("행사관리") ? null : '"행사관리" 권한이 없습니다.'),
    },
    {
      href: `${ROUTES.officer}/services`,
      label: "서비스",
      blocked: writeBlocked ?? (me.can("서비스관리") ? null : '"서비스관리" 권한이 없습니다.'),
    },
    {
      href: `${ROUTES.officer}/contacts`,
      label: "긴급 연락처",
      blocked: writeBlocked ?? (me.can("연락처관리") ? null : '"연락처관리" 권한이 없습니다.'),
    },
    {
      href: `${ROUTES.officer}/officers`,
      label: "권한",
      blocked: me.can("임원관리") ? null : '"임원관리" 권한이 없습니다.',
    },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      {/* 내가 누구로 로그인해 있는지 — 회장·총무·감사 세 시선을 오가며 볼 때 이게 없으면 헷갈린다 */}
      <div className="no-print border-b border-line bg-brand-800 text-ink-invert">
        <div className="mx-auto flex w-full max-w-[84rem] flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold">
              {me.name} <span className="font-normal opacity-80">{me.role}</span>
            </span>
            <span aria-hidden="true" className="opacity-50">
              ·
            </span>
            <span className="opacity-90">{me.permissions.join(" / ") || "권한 없음"}</span>
            <span aria-hidden="true" className="opacity-50">
              ·
            </span>
            <span className="opacity-90 tnum">
              승인한도 ₱{me.approvalLimit.toLocaleString("en-PH")}
            </span>
            {me.isAuditor ? <Badge tone="warn">읽기 전용</Badge> : null}
          </p>
          <div className="flex items-center gap-3 text-sm">
            <Link href={ROUTES.home} className="underline underline-offset-2 hover:opacity-80">
              공개 홈페이지
            </Link>
            <form action={officerLogoutAction}>
              <button
                type="submit"
                className="min-h-9 rounded-[var(--radius-field)] border border-white/40 px-3 font-semibold hover:bg-white/10"
              >
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </div>

      <OfficerNav tabs={tabs} />

      <div className="flex-1">{children}</div>
    </div>
  );
}
