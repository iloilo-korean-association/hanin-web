import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardGrid,
  CardHeader,
  EmptyState,
  LinkButton,
  ButtonRow,
  PageContainer,
  PageHeader,
  Stack,
  StatGrid,
  formatPeso,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  buildPublicLedger,
  buildRealNameList,
  fiscalYearOf,
  hotlineFrom,
  loadSettings,
  monthOf,
  noticesFrom,
  publicPolicyFrom,
  todayManila,
  type AccountRow,
  type CategoryRow,
  type FundRow,
  type TxRow,
} from "@/lib/domain";
import { absoluteUrl, ORG_NAME, ORG_NAME_EN, ORG_TAGLINE, ROUTES } from "@/lib/site";

import { EmergencyBanner } from "./_components/emergency-ui";

export const metadata: Metadata = {
  // 홈은 루트 layout 의 default 제목을 그대로 쓴다(template 이 붙으면 이름이 두 번 나온다).
  title: {
    absolute: `${ORG_NAME} — ${ORG_TAGLINE}`,
  },
  description:
    "필리핀 일로일로 한인 커뮤니티의 공식 창구입니다. 24시간 긴급 연결·통역·동행, 회비와 기부금 전액 공개, 한인 업소 안내.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: absoluteUrl("/"),
    siteName: ORG_NAME,
    title: `${ORG_NAME} · ${ORG_NAME_EN}`,
    description:
      "위급할 때 혼자 두지 않습니다. 회비와 기부금이 어디에 쓰였는지 건별로 전액 공개합니다.",
    // ★ images 를 명시하는 이유 (직접 확인한 사실)
    //   페이지에서 openGraph 객체를 정의하면 루트 layout 의 openGraph 를 **통째로 덮어쓴다.**
    //   그때 파일 규약(src/app/opengraph-image.tsx)으로 붙던 og:image 까지 함께 사라져
    //   카톡에 링크를 붙여도 썸네일이 뜨지 않았다. curl 로 확인하고 여기서 다시 가리킨다.
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${ORG_NAME} — ${ORG_TAGLINE}` }],
  },
};

/** 금액이 항상 최신이어야 한다 — 총무가 수납한 직후 새로고침하면 바뀌어야 한다. */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const today = todayManila();

  const settings = await loadSettings(prisma);
  const policy = publicPolicyFrom(settings);
  const hotline = hotlineFrom(settings);
  const notices = noticesFrom(settings);

  // 회계연도는 설정 문자열이 아니라 FiscalYear 표에서 정한다.
  // OPEN 인 연도가 정본이고, 없으면 가장 최근 연도로 떨어진다.
  const fiscalYears = await prisma.fiscalYear.findMany({ orderBy: { year: "desc" } });
  const fy =
    fiscalYears.find((y) => y.status === "OPEN")?.year ?? fiscalYears[0]?.year ?? fiscalYearOf(today);

  const [txs, accounts, funds, categories, members] = await Promise.all([
    prisma.transaction.findMany({ where: { fiscalYear: fy }, orderBy: { seq: "asc" } }),
    prisma.account.findMany(),
    prisma.fund.findMany(),
    prisma.category.findMany(),
    // ★ 마스킹 대조용으로만 쓴다. 화면으로 절대 내보내지 않는다.
    prisma.member.findMany({ select: { name: true } }),
  ]);

  const ledger = buildPublicLedger(
    txs as unknown as TxRow[],
    accounts as unknown as AccountRow[],
    funds as unknown as FundRow[],
    categories as unknown as CategoryRow[],
    {
      fiscalYear: fy,
      today,
      realNames: buildRealNameList(members.map((m) => m.name)),
      ...policy,
    },
  );

  const thisMonthKey = monthOf(today);
  const thisMonth = ledger.months.find((m) => m.month === thisMonthKey);
  const monthLabel = `${Number(thisMonthKey.slice(5, 7))}월`;

  return (
    <PageContainer>
      <PageHeader
        title={ORG_NAME}
        titleEn={ORG_NAME_EN}
        description={
          <>
            일로일로에 사는 한국인이 사고·질병·재해를 당했을 때 <b>혼자 두지 않는 것</b>이 저희가
            하는 첫 번째 일입니다.
            <br />
            회비와 기부금은 <b>한 건도 빠짐없이 공개</b>합니다. 지출은 건별 전액, 임원과 이해관계가
            있는 거래는 지분율까지 함께 표시합니다.
            <br />
            총회·행사·업소 안내처럼 한인 사회가 서로를 찾는 일을 돕습니다.
          </>
        }
        actions={
          <ButtonRow>
            <LinkButton href={ROUTES.join} variant="primary">
              회원 가입
            </LinkButton>
            <LinkButton href={ROUTES.login}>회원 로그인</LinkButton>
            <LinkButton href={ROUTES.about}>한인회 소개</LinkButton>
          </ButtonRow>
        }
      />

      <Stack gap="lg">
        {/* ── 긴급 연락처 — 최상단. 이게 한인회의 존재 이유다 ───────────────── */}
        <EmergencyBanner hotline={hotline} compact />

        {/* ── 공개 회계 요약 ─────────────────────────────────────────────── */}
        <section aria-labelledby="ledger-summary">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ledger-summary" className="text-xl">
              이번 달 회계{" "}
              <span className="text-base font-normal text-ink-faint">
                {fy}년 {monthLabel} · This month
              </span>
            </h2>
            <Link href={ROUTES.ledger} className="link-ika font-semibold">
              전체 공개 회계 보기 →
            </Link>
          </div>

          <StatGrid
            label={`${fy}년 ${monthLabel} 회계 요약`}
            items={[
              {
                label: `${monthLabel} 수입`,
                labelEn: "Income",
                value: formatPeso(thisMonth?.income ?? 0),
                tone: "income",
                sub: `연간 누계 ${formatPeso(ledger.totalIncome)}`,
              },
              {
                label: `${monthLabel} 지출`,
                labelEn: "Expense",
                value: formatPeso(thisMonth?.expense ?? 0),
                tone: "expense",
                sub: `연간 누계 ${formatPeso(ledger.totalExpense)}`,
              },
              {
                label: "현재 잔액",
                labelEn: "Balance",
                value: formatPeso(ledger.accountTotals.balance),
                tone: "balance",
                sub: `${today} 기준 · 계좌 ${ledger.accounts.length}개 합계`,
              },
            ]}
          />

          <p className="mt-3 text-sm text-ink-muted">
            확정(POSTED)된 거래만 셉니다. 이번 회계연도에 확정 {ledger.metrics.postedCount}건,
            증빙 첨부율{" "}
            <b>{ledger.metrics.evidenceRate === null ? "—" : `${ledger.metrics.evidenceRate}%`}</b>,
            영수증번호 결번{" "}
            <b className={ledger.metrics.gaps.ok ? "text-success" : "text-danger"}>
              {ledger.metrics.gaps.ok ? "없음" : "있음"}
            </b>
            . 자기 계좌 사이의 돈 이동(내부이체)은 수입·지출 어느 쪽에도 넣지 않습니다.
          </p>
        </section>

        {/* ── 공지 ────────────────────────────────────────────────────────── */}
        <section aria-labelledby="notices">
          <h2 id="notices" className="mb-3 text-xl">
            최근 공지 <span className="text-base font-normal text-ink-faint">Notices</span>
          </h2>

          {notices.length === 0 ? (
            <EmptyState
              icon="📭"
              title="아직 올라온 공지가 없습니다"
              description="총회·행사·회비 안내는 이 자리에 표시됩니다."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {notices.map((n) => (
                <li key={n.title}>
                  <Card as="article">
                    <CardBody>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        {n.date ? (
                          <time dateTime={n.date} className="text-sm tnum text-ink-muted">
                            {n.date}
                          </time>
                        ) : null}
                        <h3 className="text-lg">{n.title}</h3>
                      </div>
                      {n.body ? <p className="mt-1.5 text-ink-soft">{n.body}</p> : null}
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── 무엇을 하는 곳인가 ───────────────────────────────────────────── */}
        <section aria-labelledby="what-we-do">
          <h2 id="what-we-do" className="mb-3 text-xl">
            한인회가 하는 일{" "}
            <span className="text-base font-normal text-ink-faint">What we do</span>
          </h2>

          <CardGrid columns={3}>
            <Card as="article">
              <CardHeader
                headingLevel={3}
                title="① 위급할 때 연결합니다"
                description="연결 · 통역 · 동행까지. 그 이상은 하지 않습니다."
              />
              <CardBody>
                <p className="text-ink-soft">
                  경찰서·병원·이민국·공관에 연결하고, 말이 통하게 통역하고, 혼자 가기 어려운 자리에
                  함께 갑니다. 진단·법률 자문·보증·대납은 하지 않습니다.
                </p>
                <p className="mt-3">
                  <Badge tone="success">회비와 무관 · 비회원도 동일</Badge>
                </p>
                <p className="mt-3">
                  <Link href={ROUTES.sos} className="link-ika font-semibold">
                    상황별 행동요령 보기 →
                  </Link>
                </p>
              </CardBody>
            </Card>

            <Card as="article">
              <CardHeader
                headingLevel={3}
                title="② 돈을 전부 공개합니다"
                description="지출은 건별 전액. 수입은 집계."
              />
              <CardBody>
                <p className="text-ink-soft">
                  영수증번호는 1번부터 결번 없이 발행되고, 거래는 삭제되지 않습니다. 잘못 적은
                  거래도 지우지 않고 <b>무효</b>로 표시만 남깁니다.
                </p>
                <p className="mt-3">
                  <Badge tone="conflict">임원 관련 거래는 지분율까지 공시</Badge>
                </p>
                <p className="mt-3">
                  <Link href={ROUTES.ledger} className="link-ika font-semibold">
                    공개 회계 보기 →
                  </Link>
                </p>
              </CardBody>
            </Card>

            <Card as="article">
              <CardHeader
                headingLevel={3}
                title="③ 서로를 찾게 돕습니다"
                description="총회 · 행사 · 업소 안내."
              />
              <CardBody>
                <p className="text-ink-soft">
                  정기총회와 명절·체육 행사를 열고, 한인이 운영하는 업소를 안내합니다. 특정 업소를
                  추천하지는 않습니다 — 목록을 드리고 선택은 본인이 하십니다.
                </p>
                <p className="mt-3">
                  <Link href={ROUTES.biz} className="link-ika font-semibold">
                    업소 안내 보기 →
                  </Link>
                </p>
              </CardBody>
            </Card>
          </CardGrid>
        </section>

        {/* ── 개인정보 한 줄 ──────────────────────────────────────────────── */}
        <Alert tone="info" title="이 사이트에는 회원 이름이 나오지 않습니다">
          <p>
            누가 회비를 얼마 냈는지는 공개하지 않습니다. 미납자를 드러내지 않기 위해서이자, 필리핀
            개인정보보호법(RA 10173)과 한국 개인정보 보호법이 모두 보호하는 정보이기 때문입니다.
            대신 <b>금액은 한 건도 숨기지 않습니다.</b> 여권번호·ACR I-Card·주민등록번호는 아예
            수집하지 않습니다.
          </p>
        </Alert>

        {/* ── 바로가기 ────────────────────────────────────────────────────── */}
        <nav aria-label="바로가기">
          <h2 className="mb-3 text-xl">
            바로가기 <span className="text-base font-normal text-ink-faint">Quick links</span>
          </h2>
          <ButtonRow>
            <LinkButton href={ROUTES.join} variant="primary">
              회원 가입 신청
            </LinkButton>
            <LinkButton href={ROUTES.login}>회원 로그인</LinkButton>
            <LinkButton href={ROUTES.donate}>기부하기</LinkButton>
            <LinkButton href={ROUTES.events}>행사 일정</LinkButton>
            <LinkButton href={ROUTES.biz}>업소 안내</LinkButton>
            <LinkButton href={ROUTES.sos}>긴급 연락처</LinkButton>
            <LinkButton href={ROUTES.help}>문의</LinkButton>
          </ButtonRow>
        </nav>
      </Stack>
    </PageContainer>
  );
}
