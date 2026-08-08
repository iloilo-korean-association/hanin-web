import type { Metadata } from "next";

import { EmptyState, LinkButton, PageContainer, ButtonRow } from "@/components/ui";
import { PUBLIC_PAGES, ROUTES } from "@/lib/site";

export const metadata: Metadata = {
  title: "페이지를 찾을 수 없습니다",
  robots: { index: false, follow: false },
};

/**
 * 404.
 *
 * "Not Found" 만 띄우고 끝내지 않는다. 회원이 링크를 잘못 눌렀을 때
 * 갈 곳을 바로 보여줘야 전화가 안 온다.
 */
export default function NotFound() {
  return (
    <PageContainer>
      <EmptyState
        icon="🧭"
        title="페이지를 찾을 수 없습니다"
        description="주소가 바뀌었거나, 링크가 잘못되었을 수 있습니다. 아래에서 원하시는 곳으로 이동해 주십시오."
        action={
          <ButtonRow className="justify-center">
            <LinkButton href={ROUTES.home} variant="primary">
              홈으로
            </LinkButton>
            <LinkButton href={ROUTES.ledger}>공개 회계</LinkButton>
            <LinkButton href={ROUTES.sos}>긴급 연락처</LinkButton>
          </ButtonRow>
        }
      />

      <nav aria-label="전체 메뉴" className="mt-8">
        <h2 className="mb-3 text-lg">전체 메뉴</h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PUBLIC_PAGES.map((p) => (
            <li key={p.href}>
              <a
                href={p.href}
                className="flex min-h-touch flex-col justify-center rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 hover:border-brand-300"
              >
                <span className="font-semibold">
                  {p.label}
                  <span className="ml-2 text-sm font-normal text-ink-faint">{p.labelEn}</span>
                </span>
                <span className="text-sm text-ink-muted">{p.description}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </PageContainer>
  );
}
