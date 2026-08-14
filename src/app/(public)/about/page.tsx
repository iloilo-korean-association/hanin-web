import type { Metadata } from "next";
import { SYSTEM_ADMIN_ROLE } from "@/lib/validators";
import Link from "next/link";

import {
  Alert,
  Badge,
  ButtonRow,
  Card,
  CardBody,
  CardGrid,
  CardHeader,
  EmptyState,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableCardBody,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { cfgStr, loadSettings } from "@/lib/domain";
import { EMERGENCY_NUMBER, ORG_NAME, ORG_NAME_EN, ROUTES, absoluteUrl } from "@/lib/site";

import { Anchor } from "../_components/anchor";

export const metadata: Metadata = {
  title: "한인회 소개",
  description:
    "일로일로 한인회가 무엇을 하는 곳인지, 임원이 누구인지, 돈을 어떤 규칙으로 다루는지. 회계 6대 불변식과 이해상충 관리 원칙을 공개합니다.",
  alternates: { canonical: "/about" },
  openGraph: {
    type: "article",
    locale: "ko_KR",
    url: absoluteUrl("/about"),
    siteName: ORG_NAME,
    title: `한인회 소개 · ${ORG_NAME}`,
    description:
      "연결·통역·동행까지. 그 이상은 하지 않습니다. 돈은 6대 불변식으로 다루고 전액 공개합니다.",
    // ★ 페이지에서 openGraph 를 정의하면 루트의 og:image 가 통째로 사라진다(curl 로 확인).
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${ORG_NAME} 소개` }],
  },
};

/** 임원 명단이 바뀌면 바로 반영돼야 한다. */
export const dynamic = "force-dynamic";

/** 재무회계규정 제9조 — 회계의 6대 불변식. 문구를 임의로 바꾸지 마라. */
const INVARIANTS: { id: string; title: string; body: string; how: string }[] = [
  {
    id: "I1",
    title: "거래는 삭제되지 않는다",
    body: "확정된 거래는 어떤 경우에도 지우거나 덮어쓸 수 없습니다. 오류가 났을 때는 무효(VOID) 표시를 남기거나, 금액이 같고 부호가 반대인 정정 거래를 새로 만들어 상쇄합니다.",
    how: "시스템에 삭제 기능 자체가 없습니다. 공개 회계에서 무효 거래는 취소선과 무효 사유가 함께 보입니다.",
  },
  {
    id: "I2",
    title: "영수증번호에 결번이 없다",
    body: "영수증 번호는 회계연도마다 1번부터 빈틈없이 이어집니다. 잘못 발행한 영수증도 번호를 없애지 않고 무효로 등재합니다.",
    how: "번호를 뽑는 일과 거래를 기록하는 일이 하나의 트랜잭션 안에서 일어납니다. 도중에 실패하면 번호도 함께 되돌아가 결번이 생기지 않습니다.",
  },
  {
    id: "I3",
    title: "증빙 없이 확정할 수 없다",
    body: "영수증·계산서가 없는 거래는 확정되지 않습니다. 확정되지 않은 거래는 잔액과 공개 집계에서 빠집니다.",
    how: "저장할 때 서버가 다시 확인합니다. 화면에서 버튼을 숨기는 것만으로는 통제라고 보지 않습니다.",
  },
  {
    id: "I4",
    title: "현금은 2인이 확인한다",
    body: "현금을 받거나 줄 때는 반드시 두 사람이 관여하고, 돈을 만진 사람과 장부에 적는 사람이 서로 달라야 합니다. 혼자뿐이면 현금을 받지 않고 계좌이체로 대신합니다.",
    how: "확인자가 입력자와 같으면 서버가 확정을 거부하고 미확정 상태로 남깁니다. 인원 부족을 이유로 면제되지 않습니다.",
  },
  {
    id: "I5",
    title: "마감된 회계연도는 불변이다",
    body: "마감한 연도의 거래는 조회만 됩니다. 나중에 오류를 발견해도 과거 장부를 고치지 않고, 발견한 해에 정정 거래를 세우고 그 사유를 결산보고서에 적습니다.",
    how: "마감 연도 날짜로는 새 거래를 만들 수 없습니다. 마감 해제는 총회 의결로만 가능합니다.",
  },
  {
    id: "I6",
    title: "개시잔액은 전기 마감잔액과 같다",
    body: "새 회계연도의 개시잔액은 직전 연도의 마감잔액과 반드시 같아야 합니다. 다르면 그 해 장부를 열 수 없습니다.",
    how: "공개 회계 첫 화면에서 전기 마감잔액과 당기 개시잔액을 나란히 보여 주고 일치 여부를 표시합니다.",
  },
];

export default async function AboutPage() {
  const settings = await loadSettings(prisma);
  const declaredAt = cfgStr(settings, "개시선언.기준일시", "");
  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");
  const facebook = cfgStr(settings, "웹앱.페이스북", "");

  const [officers, conflicts, vendors] = await Promise.all([
    // 관리자 계정은 실제 사람이 아니므로 공개 임원 명단에서 뺀다.
    prisma.officer.findMany({
      where: { status: "ACTIVE", role: { not: SYSTEM_ADMIN_ROLE } },
      orderBy: { officerId: "asc" },
    }),
    prisma.conflictOfInterest.findMany({ where: { disclosed: true } }),
    prisma.vendor.findMany({ where: { relatedParty: true } }),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="한인회 소개"
        titleEn="About"
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
        description={
          <>
            {ORG_NAME}({ORG_NAME_EN})는 필리핀 파나이섬 일로일로에 사는 한국인의 공식 창구입니다.
            무엇을 하고 무엇을 하지 않는지, 돈을 어떤 규칙으로 다루는지 먼저 말씀드립니다.
          </>
        }
        actions={
          <ButtonRow>
            <LinkButton href={ROUTES.join} variant="primary">
              회원 가입
            </LinkButton>
            <LinkButton href={ROUTES.ledger}>공개 회계</LinkButton>
          </ButtonRow>
        }
      />

      <Stack gap="lg">
        {/* ── 3대 원칙 ────────────────────────────────────────────────── */}
        <section aria-labelledby="principles">
          <h2 id="principles" className="mb-3 text-xl">
            운영 3원칙 <span className="text-base font-normal text-ink-faint">Principles</span>
          </h2>

          <CardGrid columns={3}>
            <Card as="article">
              <CardHeader
                headingLevel={3}
                title="① 연결 · 통역 · 동행까지"
                description="그 이상은 하지 않습니다."
              />
              <CardBody>
                <p className="text-ink-soft">
                  한인회는 병원이 아니고, 경찰이 아니고, 변호사가 아니고, 보험사가 아니고,
                  영사관이 아닙니다. 전화를 받고 → 맞는 기관에 연결하고 → 말이 통하게 통역하고 →
                  혼자 두지 않습니다.
                </p>
                <p className="mt-2 text-ink-soft">
                  진단·치료 판단, 법률 자문, 합의 중재, 보석금·치료비 대납, 신원 보증은 하지
                  않습니다.
                </p>
                <p className="mt-3">
                  <Link href={ROUTES.sos} className="link-ika font-semibold">
                    상세 범위와 면책 보기 →
                  </Link>
                </p>
              </CardBody>
            </Card>

            <Card as="article">
              <CardHeader
                headingLevel={3}
                title="② 긴급 대응은 무료"
                description="회비와 무관합니다."
              />
              <CardBody>
                <p className="text-ink-soft">
                  회비 미납자, 비회원, 관광객, 단기 체류자 — 전부 동일하게 지원합니다. 접수
                  단계에서 회비 납부 여부를 묻지 않습니다. 묻는 순간 이 조직은 다른 조직이 됩니다.
                </p>
                <p className="mt-3">
                  <Badge tone="success">지금 위급하면 {EMERGENCY_NUMBER}</Badge>
                </p>
              </CardBody>
            </Card>

            <Card as="article">
              <CardHeader
                headingLevel={3}
                title="③ 한 사람이 없어도 돌아간다"
                description="특정 개인에게 사건이 몰리는 구조를 금지합니다."
              />
              <CardBody>
                <p className="text-ink-soft">
                  당번이 받지 못하면 15분 뒤 백업으로 넘어갑니다. 회장이 해외에 있어도, 특정 임원이
                  그만두어도 체계는 작동합니다. 회장은 상황총괄을 맡지 않고, 핫라인 당번도 분기 1회
                  이하로만 섭니다.
                </p>
              </CardBody>
            </Card>
          </CardGrid>
        </section>

        {/* ── 임원 ────────────────────────────────────────────────────── */}
        <Anchor id="officers">
          <Card as="section">
            <CardHeader
              title="임원"
              description="임원은 회원의 대표로서 이름과 직책, 권한 범위를 공개합니다. 연락은 아래 문의처로 해 주십시오."
            />
            {officers.length === 0 ? (
              <CardBody>
                <EmptyState icon="🧑‍⚖️" title="등록된 임원이 없습니다" />
              </CardBody>
            ) : (
              <TableCardBody label="임원 명단">
                <Table caption="임원 명단과 권한" captionHidden>
                  <THead>
                    <TR>
                      <TH>직책</TH>
                      <TH>성명</TH>
                      <TH>임기</TH>
                      <TH>권한</TH>
                      <TH numeric>전결 한도</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {officers.map((o) => (
                      <TR key={o.officerId}>
                        <TD className="font-medium whitespace-nowrap">{o.role}</TD>
                        <TD>{o.name}</TD>
                        <TD className="tnum whitespace-nowrap text-sm text-ink-muted">
                          {o.termStart} ~ {o.termEnd}
                        </TD>
                        <TD className="text-sm">
                          <span className="flex flex-wrap gap-1">
                            {o.permissions
                              .split(",")
                              .map((p) => p.trim())
                              .filter(Boolean)
                              .map((p) => (
                                <Badge key={p} tone={p === "확인권" ? "info" : "neutral"}>
                                  {p}
                                </Badge>
                              ))}
                          </span>
                        </TD>
                        <TD numeric className="tnum">
                          {o.approvalLimit > 0 ? `₱${o.approvalLimit.toLocaleString("en-PH")}` : "—"}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableCardBody>
            )}
            <CardBody className="border-t border-line-soft">
              <p className="text-sm text-ink-muted">
                전결 한도를 넘는 지출은 1차·2차 두 단계 승인을 거칩니다. 이해관계가 있는 거래는 금액과
                무관하게 2단계 승인이며, 해당 임원은 승인 버튼을 누를 수 없습니다.
              </p>
            </CardBody>
          </Card>
        </Anchor>

        {/* ── 회계 6대 불변식 ─────────────────────────────────────────── */}
        <section aria-labelledby="invariants">
          <h2 id="invariants" className="mb-1 text-xl">
            돈을 다루는 규칙 — 회계 6대 불변식{" "}
            <span className="text-base font-normal text-ink-faint">Six invariants</span>
          </h2>
          <p className="mb-3 text-ink-muted">
            「재무회계규정」 제9조입니다. <b>어떠한 사유로도 예외를 두지 않습니다.</b> 시스템으로
            운영하든 수기 장부로 운영하든 똑같이 적용합니다.
          </p>

          <ul className="flex flex-col gap-3">
            {INVARIANTS.map((iv) => (
              <li key={iv.id}>
                <Card as="article">
                  <CardBody>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Badge tone="info">{iv.id}</Badge>
                      <h3 className="text-lg">{iv.title}</h3>
                    </div>
                    <p className="mt-2 text-ink-soft">{iv.body}</p>
                    <p className="mt-2 text-sm text-ink-muted">
                      <b>어떻게 지키나 · </b>
                      {iv.how}
                    </p>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        {/* ── 개시잔액 선언 ───────────────────────────────────────────── */}
        <Alert tone="info" title="이 장부는 언제부터 시작하는가">
          <p>
            본회의 공개 원장은{" "}
            <b>{declaredAt ? declaredAt : "(개시 시점 미설정 — 확인 중)"}</b> 을 개시 시점으로
            시작합니다. 이 시점의 잔액은 전임 집행부가 실사하여 선언한 「개시잔액 선언서」에 따른
            것이며, <b>이 선언서는 감사보고서가 아닙니다.</b> 개시 시점 이전 기간의 회계는 이
            시스템의 감사 대상이 아니며, 본회는 전임 집행부의 과거 회계 처리에 대하여 어떠한 소급
            책임도 묻지 않습니다. 개시 시점 이후의 모든 거래는 「재무회계규정」에 따라 전액
            공개됩니다.
          </p>
          <p className="mt-2">
            <Link href={ROUTES.ledger} className="link-ika font-semibold">
              공개 회계에서 개시잔액 확인하기 →
            </Link>
          </p>
        </Alert>

        {/* ── 이해상충 ────────────────────────────────────────────────── */}
        <Anchor id="conflict-policy">
          <Card as="section">
            <CardHeader
              title="이해상충을 숨기지 않습니다"
              description="좁은 한인 사회에서는 실수 한 건에 신뢰가 역회전합니다. 먼저 밝히는 것이 유일한 방법입니다."
              action={
                <Badge tone="conflict">
                  신고 {conflicts.length}건 · 관련 업소 {vendors.length}곳
                </Badge>
              }
            />
            <CardBody>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-soft">
                <li>
                  임원은 본인·가족·지분 보유 업체와의 관계를 <b>스스로 신고</b>하고, 그 내용은 공개
                  회계와 업소 안내에 <b>상시</b> 표시됩니다. 접거나 숨기지 않습니다.
                </li>
                <li>
                  한인회 지출 상대가 임원 관련 업체이면 시스템이 자동으로 표시하고,{" "}
                  <b>해당 임원의 승인 버튼을 잠급니다(회피).</b> 화면에서 감추는 것으로 끝내지 않고
                  저장 단계에서 서버가 다시 확인합니다.
                </li>
                <li>
                  이해관계 거래는 금액과 무관하게 <b>2단계 승인</b>과 <b>복수 견적</b>을 거칩니다.
                </li>
                <li>
                  변호사·병원·업체는 <b>단독 추천하지 않습니다.</b> 특히 회장 배우자가 운영하는 로펌의
                  단독 추천은 명시적으로 금지되어 있습니다.
                </li>
                <li>
                  사건 당사자가 회장의 사업체 관계자이면 회장을 대응 라인에서 제외하고 부회장이
                  총괄합니다.
                </li>
              </ul>
              <p className="mt-4">
                <Link href={`${ROUTES.ledger}#conflict`} className="link-ika font-semibold">
                  이해상충 공시 전체 보기 →
                </Link>
                <span className="mx-2 text-ink-faint">·</span>
                <Link href={ROUTES.biz} className="link-ika font-semibold">
                  업소 안내에서 배지 확인 →
                </Link>
              </p>
            </CardBody>
          </Card>
        </Anchor>

        {/* ── 개인정보 ────────────────────────────────────────────────── */}
        <Anchor id="privacy">
          <Card as="section">
            <CardHeader
              title="개인정보를 어떻게 다루나"
              description="필리핀 Data Privacy Act (RA 10173) · 대한민국 개인정보 보호법"
            />
            <CardBody>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-soft">
                <li>
                  <b>공개 화면에 회원 실명이 나오지 않습니다.</b> 누가 회비를 얼마 냈는지는 공개하지
                  않습니다 — 미납자를 드러내지 않기 위해서입니다. 대신 금액은 하나도 숨기지 않습니다.
                </li>
                <li>
                  <b>여권번호·ACR I-Card 번호·주민등록번호는 수집하지 않습니다.</b> 애초에 저장하지
                  않으면 유출될 수 없습니다.
                </li>
                <li>
                  명부는 <b>공개에 동의하신 분만</b>, 그것도 로그인한 회원에게만 보입니다.
                </li>
                <li>
                  기부자 이름은 본인이 공개에 동의하고 직접 정한 표기(예: 김OO)만 나옵니다. 동의하지
                  않으신 분의 금액은 이름만 빼고 합계에 그대로 들어갑니다.
                </li>
                <li>
                  긴급 대응으로 접수된 정보는 그 목적으로만 쓰고 2년 보관 후 삭제합니다.
                </li>
                <li>
                  본인 정보의 열람·정정·삭제는 아래 문의처로 요청하실 수 있습니다.
                </li>
              </ul>
            </CardBody>
          </Card>
        </Anchor>

        {/* ── 문의 ────────────────────────────────────────────────────── */}
        <Anchor id="contact">
          <Card as="section">
            <CardHeader title="문의" />
            <CardBody>
              <dl className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <dt className="w-28 shrink-0 font-semibold">이메일</dt>
                  <dd>
                    {contactEmail ? (
                      <a href={`mailto:${contactEmail}`} className="link-ika">
                        {contactEmail}
                      </a>
                    ) : (
                      <span className="text-ink-muted">준비 중입니다.</span>
                    )}
                  </dd>
                </div>
                {facebook ? (
                  <div className="flex flex-wrap gap-2">
                    <dt className="w-28 shrink-0 font-semibold">페이스북</dt>
                    <dd>
                      <a
                        href={facebook}
                        className="link-ika"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {facebook}
                      </a>
                    </dd>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <dt className="w-28 shrink-0 font-semibold">긴급</dt>
                  <dd>
                    <Link href={ROUTES.sos} className="link-ika">
                      긴급 연락처 페이지
                    </Link>{" "}
                    · 생명이 위험하면 먼저 <b>{EMERGENCY_NUMBER}</b>
                  </dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="w-28 shrink-0 font-semibold">소재</dt>
                  <dd className="text-ink-soft">Iloilo City, Panay Island, Philippines</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </Anchor>
      </Stack>
    </PageContainer>
  );
}
