import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  formatDateTime,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
} from "@/components/ui";
import { countOutboxByKind, listOutbox } from "@/lib/mail";

export const metadata: Metadata = {
  title: "메일 발송함",
  description: "실제로 보내지 않고 기록만 한 메일을 확인합니다.",
  robots: { index: false, follow: false },
};

// 발송함은 항상 최신 상태여야 한다 — 수납을 한 직후 새로고침하면 영수증 메일이 보여야 한다.
export const dynamic = "force-dynamic";

/**
 * /dev/outbox — 발송될 메일을 눈으로 보는 화면.
 *
 * 대표가 "영수증 메일이 이렇게 나가는구나" 를 확인하는 곳이다.
 * 매직링크도 여기서 눌러 회원 화면으로 바로 들어갈 수 있다.
 *
 * ─── 본문 렌더 방식 (중요) ────────────────────────────────────────────────
 * 메일 본문은 HTML 이지만 dangerouslySetInnerHTML 을 쓰지 않는다(코드 규약).
 * 대신 <iframe srcDoc sandbox=""> 안에서 렌더한다.
 *   · sandbox 를 빈 문자열로 두면 스크립트·폼·팝업·같은-출처 접근이 전부 차단된다.
 *     innerHTML 보다 안전하다 — innerHTML 은 onerror 같은 인라인 핸들러가 살아난다.
 *   · 메일 클라이언트와 비슷한 격리 환경이라 "실제로 어떻게 보일지" 에도 더 가깝다.
 * 원문이 궁금하면 아래 <details> 에서 이스케이프된 소스를 그대로 볼 수 있다.
 */
export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const [mails, counts] = await Promise.all([
    listOutbox({ limit: 100, kind }),
    countOutboxByKind(),
  ]);
  const total = counts.reduce((s, c) => s + c.count, 0);

  return (
    <PageContainer wide>
      <PageHeader
        title="메일 발송함"
        titleEn="Outbox"
        description="이 프로토타입은 실제 메일을 보내지 않습니다. 발송될 메일을 DB 에 기록하고 여기서 그대로 보여 줍니다. 매직링크는 아래에서 눌러 바로 들어가실 수 있습니다."
      />

      <Stack>
        <Alert tone="info" title="왜 실제로 안 보내나">
          <p>
            로컬 프로토타입은 외부 서비스 계정을 하나도 만들지 않는다는 전제로 만들었습니다(구글·
            메일 프로바이더 모두). 발송 로직은 그대로 있고, 프로덕션에서는 이 발송함 뒤에 실제
            전송 워커만 붙이면 됩니다.
          </p>
        </Alert>

        {/* 종류별 필터 */}
        <nav aria-label="메일 종류 필터" className="flex flex-wrap gap-2">
          <FilterChip href="/dev/outbox" active={!kind} label="전체" count={total} />
          {counts.map((c) => (
            <FilterChip
              key={c.kind}
              href={`/dev/outbox?kind=${encodeURIComponent(c.kind)}`}
              active={kind === c.kind}
              label={c.kind}
              count={c.count}
            />
          ))}
        </nav>

        {mails.length === 0 ? (
          <EmptyState
            icon="📭"
            title={kind ? `"${kind}" 종류의 메일이 아직 없습니다` : "아직 보낸 메일이 없습니다"}
            description={
              kind
                ? "다른 종류를 눌러 보시거나, 전체를 확인해 주십시오."
                : "회원 가입·수납 기록·기부 접수를 하면 여기에 메일이 쌓입니다. npm run db:reset 으로 시드를 다시 넣어도 됩니다."
            }
            action={
              kind ? (
                <LinkButton href="/dev/outbox">전체 보기</LinkButton>
              ) : (
                <LinkButton href="/join" variant="primary">
                  회원 가입 화면 열기
                </LinkButton>
              )
            }
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {mails.map((m) => (
              <li key={m.id}>
                <Card as="article">
                  <CardHeader
                    headingLevel={2}
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone="info">{m.kind}</Badge>
                        <span className="text-lg">{m.subject}</span>
                      </span>
                    }
                    description={
                      <span className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          받는 사람:{" "}
                          <b className="font-semibold text-ink-soft">
                            {m.toName ? `${m.toName} <${m.toEmail}>` : m.toEmail}
                          </b>
                        </span>
                        {m.memberNo ? <span>회원번호: {m.memberNo}</span> : null}
                        {m.notifyLogId ? <span>알림로그: {m.notifyLogId}</span> : null}
                        <time dateTime={m.createdAt.toISOString()}>
                          {formatDateTime(m.createdAt)}
                        </time>
                      </span>
                    }
                    action={
                      m.linkPath ? (
                        <LinkButton href={m.linkPath} variant="primary" size="sm">
                          링크 열기 →
                        </LinkButton>
                      ) : null
                    }
                  />
                  <CardBody>
                    {/*
                      sandbox="" = 스크립트·폼·팝업·같은-출처 전부 차단.
                      title 은 스크린리더가 이 프레임이 무엇인지 읽게 한다(접근성 필수).
                    */}
                    <iframe
                      title={`메일 본문 미리보기: ${m.subject}`}
                      srcDoc={m.bodyHtml}
                      sandbox=""
                      loading="lazy"
                      className="h-72 w-full rounded-[var(--radius-field)] border border-line bg-white"
                    />

                    <details className="mt-3">
                      <summary className="inline-flex min-h-touch cursor-pointer items-center text-sm font-semibold text-brand-700">
                        HTML 원문 보기
                      </summary>
                      {/* React 가 기본 이스케이프하므로 태그가 실행되지 않고 글자로 보인다. */}
                      <pre className="mt-2 max-h-64 overflow-auto rounded border border-line bg-surface-inset p-3 text-xs whitespace-pre-wrap">
                        {m.bodyHtml}
                      </pre>
                    </details>

                    {m.linkPath ? (
                      <p className="mt-3 text-sm text-ink-muted">
                        본문 링크:{" "}
                        <Link href={m.linkPath} className="link-ika font-mono">
                          {m.linkPath}
                        </Link>
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </PageContainer>
  );
}

function FilterChip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        "inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-pill)] border px-3.5 text-sm font-semibold " +
        (active
          ? "border-brand-700 bg-brand-700 text-white"
          : "border-line-strong bg-surface text-ink-soft hover:border-brand-300")
      }
    >
      {label}
      <span className={active ? "text-brand-100" : "text-ink-faint"}>{count}</span>
    </Link>
  );
}
