import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardGrid,
  CardHeader,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { cfgStr, hotlineFrom, loadSettings } from "@/lib/domain";
import { EMERGENCY_NUMBER, ORG_NAME, ROUTES, absoluteUrl } from "@/lib/site";

import { ContactGroupCard, EmergencyBanner, GradeBadge } from "../_components/emergency-ui";
import {
  CONTACTS_VERIFIED_ON,
  CONTACT_GROUPS,
  PLAYBOOKS,
  WE_DO,
  WE_DONT,
} from "../_data/emergency";

export const metadata: Metadata = {
  title: "긴급 연락처",
  description:
    "일로일로에서 사고·질병·체포·재해를 당했을 때 어디에 어떤 순서로 연락해야 하는지. 필리핀 전국 긴급번호는 911, 주세부분관 야간 긴급은 +63-917-808-3907 입니다.",
  alternates: { canonical: "/sos" },
  openGraph: {
    type: "article",
    locale: "ko_KR",
    url: absoluteUrl("/sos"),
    siteName: ORG_NAME,
    title: `긴급 연락처 · ${ORG_NAME}`,
    description:
      "생명이 위험하면 먼저 911. 경찰·병원·공관·이민국 연락처와 상황별 1차 행동요령.",
    // ★ 페이지에서 openGraph 를 정의하면 루트의 og:image 가 통째로 사라진다(curl 로 확인).
    //   이 화면 전용 카드는 911 을 크게 그린다 — 카톡에서 카드만 봐도 번호가 읽힌다.
    images: [
      {
        url: "/sos/og",
        width: 1200,
        height: 630,
        alt: `${ORG_NAME} 긴급 연락처 — 필리핀 전국 긴급번호 ${EMERGENCY_NUMBER}`,
      },
    ],
  },
};

/** 핫라인 개통 여부가 설정에서 바뀌면 즉시 반영돼야 한다. 사람 목숨이 걸린 화면이다. */
export const dynamic = "force-dynamic";

export default async function SosPage() {
  const settings = await loadSettings(prisma);
  const hotline = hotlineFrom(settings);
  const facebook = cfgStr(settings, "웹앱.페이스북", "");
  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");

  return (
    <PageContainer>
      <PageHeader
        title="긴급 연락처"
        titleEn="Emergency"
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
        description={
          <>
            급할 때 사람은 검색하지 않습니다. 이 페이지를 <b>휴대폰 홈 화면에 추가</b>해 두십시오.
            긴급 지원은 <b>회비와 무관</b>합니다 — 회원, 비회원, 미납자, 관광객 모두 같습니다.
          </>
        }
        actions={<LinkButton href={ROUTES.help}>한인회에 문의</LinkButton>}
      />

      <Stack gap="lg">
        <EmergencyBanner hotline={hotline} />

        {/* ── 전화 받은 첫 60초 (SOP §3-0) ─────────────────────────────── */}
        <Card as="section">
          <CardHeader
            title="전화하기 전에 — 이 다섯 가지를 준비하십시오"
            description="한인회 당번이 가장 먼저 묻는 것입니다. 미리 정리하면 30초가 줄어듭니다."
          />
          <CardBody>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              <li>성함 · 여권번호 (모르시면 생년월일)</li>
              <li>지금 계신 위치 — 바랑가이 이름 또는 눈에 보이는 큰 건물</li>
              <li>무슨 일이 있었는지 한 문장으로</li>
              <li>다친 사람이 있는지</li>
              <li>지금 옆에 누가 있는지</li>
            </ol>
            <Alert tone="warn" className="mt-4" title="생명이 위험하면 한인회보다 먼저 911">
              의식이 없거나, 출혈이 심하거나, 숨쉬기가 어려우면 <b>먼저 {EMERGENCY_NUMBER}</b> 에
              걸고 통화를 유지하십시오. 그다음에 한인회로 연락 주십시오.
            </Alert>
          </CardBody>
        </Card>

        {/* ── 상황별 1차 행동 ─────────────────────────────────────────── */}
        <section aria-labelledby="playbooks">
          <h2 id="playbooks" className="mb-1 text-xl">
            상황별 1차 행동{" "}
            <span className="text-base font-normal text-ink-faint">What to do first</span>
          </h2>
          <p className="mb-3 text-ink-muted">
            해당하는 항목을 눌러 펼치십시오. 각 항목 끝에는 <b>한인회가 하지 않는 일</b>도 함께
            적었습니다 — 미리 알고 계시는 편이 서로에게 안전합니다.
          </p>

          <ul className="flex flex-col gap-2">
            {PLAYBOOKS.map((p) => (
              <li key={p.id}>
                {/* JS 없이 <details> 로 접었다 편다. 느린 회선에서도 즉시 동작한다. */}
                <details
                  id={p.id}
                  className="rounded-[var(--radius-card)] border border-line bg-surface"
                >
                  <summary className="flex min-h-touch cursor-pointer list-none items-center gap-3 px-4 py-3 font-bold hover:bg-brand-50 [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className="text-xl">
                      {p.icon}
                    </span>
                    <span className="flex-1">{p.title}</span>
                    <span aria-hidden="true" className="text-ink-faint">
                      펼치기 ▾
                    </span>
                  </summary>

                  <div className="border-t border-line-soft px-4 py-4">
                    <p className="font-semibold text-brand-800">{p.first}</p>

                    <h3 className="mt-4 text-base font-bold">순서</h3>
                    <ol className="mt-1 flex list-decimal flex-col gap-1.5 pl-5 text-ink-soft">
                      {p.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>

                    <h3 className="mt-4 text-base font-bold">이럴 때 반드시 거는 곳</h3>
                    <ul className="mt-1 flex flex-col gap-1 pl-5 text-ink-soft">
                      {p.call.map((c) => (
                        <li key={c} className="list-disc">
                          {c}
                        </li>
                      ))}
                    </ul>

                    <h3 className="mt-4 text-base font-bold text-danger">
                      한인회가 하지 않는 것
                    </h3>
                    <ul className="mt-1 flex flex-col gap-1 pl-5 text-ink-soft">
                      {p.never.map((n) => (
                        <li key={n} className="list-disc">
                          {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>

        {/* ── 연락처 표 ───────────────────────────────────────────────── */}
        <section aria-labelledby="contacts">
          <h2 id="contacts" className="mb-1 text-xl">
            연락처 <span className="text-base font-normal text-ink-faint">Contacts</span>
          </h2>
          <p className="mb-3 text-ink-muted">
            번호를 누르면 바로 전화가 걸립니다. 검증 등급을 함께 표시합니다 —{" "}
            <GradeBadge grade="verified" /> 는 공식 출처 확인, <GradeBadge grade="secondary" /> 는
            2차 출처라 반기마다 다시 확인합니다, <GradeBadge grade="pending" /> 는 아직 확인하지
            못해 <b>번호를 비워 둔</b> 항목입니다.
          </p>
          <p className="mb-4 text-sm text-ink-muted">
            최종 검증일 <b className="tnum">{CONTACTS_VERIFIED_ON}</b> · 번호는 바뀝니다. 통화가 안
            되면 알려 주십시오.
          </p>

          <Stack gap="md">
            {CONTACT_GROUPS.map((g) => (
              <ContactGroupCard key={g.id} group={g} />
            ))}
          </Stack>
        </section>

        {/* ── 한인회 접수 채널 ────────────────────────────────────────── */}
        <Card as="section">
          <CardHeader
            title="한인회에 연락하는 방법"
            description="긴급 핫라인이 개통되기 전까지는 아래 채널로 받습니다."
          />
          <CardBody>
            <ul className="flex flex-col gap-3">
              <li className="flex flex-wrap items-baseline gap-2">
                <b className="w-32">긴급 핫라인</b>
                {hotline.ready && hotline.number ? (
                  <a href={`tel:${hotline.number.replace(/[^\d+]/g, "")}`} className="link-ika font-bold tnum">
                    {hotline.number}
                  </a>
                ) : (
                  <span className="text-ink-muted">
                    개통 준비 중입니다. 지금 위급하시면 <b>{EMERGENCY_NUMBER}</b>.
                  </span>
                )}
              </li>
              {facebook ? (
                <li className="flex flex-wrap items-baseline gap-2">
                  <b className="w-32">페이스북 페이지</b>
                  <a
                    href={facebook}
                    className="link-ika"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {facebook}
                  </a>
                  <span className="text-sm text-ink-muted">
                    근무시간 1시간 이내 / 야간은 익일 오전
                  </span>
                </li>
              ) : null}
              {contactEmail ? (
                <li className="flex flex-wrap items-baseline gap-2">
                  <b className="w-32">이메일</b>
                  <a href={`mailto:${contactEmail}`} className="link-ika">
                    {contactEmail}
                  </a>
                  <span className="text-sm text-ink-muted">비긴급·사후 접수용</span>
                </li>
              ) : null}
            </ul>
            <p className="mt-4 text-sm text-ink-muted">
              임원 개인 연락처는 공식 채널이 아닙니다. 다만 긴급한 상황에서 임원에게 먼저 닿으셨다면
              그대로 처리합니다 — 절차 때문에 도움이 늦어지는 일은 없습니다.
            </p>
          </CardBody>
        </Card>

        {/* ── 면책 · 서비스 범위 (SOP §9-1) ───────────────────────────── */}
        <section aria-labelledby="scope">
          <h2 id="scope" className="mb-1 text-xl">
            저희가 하는 일과 하지 않는 일{" "}
            <span className="text-base font-normal text-ink-faint">Scope &amp; limits</span>
          </h2>
          <p className="mb-3 text-ink-muted">
            사건이 터진 다음에 설명하면 변명이 됩니다. 먼저, 그리고 반복해서 말씀드립니다.
          </p>

          <CardGrid columns={2}>
            <Card as="article">
              <CardHeader
                headingLevel={3}
                title="저희가 하는 일"
                description="초동 연결 · 통역 · 동행"
                action={<Badge tone="success">약속드립니다</Badge>}
              />
              <CardBody>
                <dl className="flex flex-col gap-2.5">
                  {WE_DO.map((d) => (
                    <div key={d.label}>
                      <dt className="font-semibold text-success">{d.label}</dt>
                      <dd className="text-ink-soft">{d.body}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>

            <Card as="article">
              <CardHeader
                headingLevel={3}
                title="저희가 할 수 없는 일"
                description="미리 정확히 말씀드립니다"
                action={<Badge tone="danger">하지 않습니다</Badge>}
              />
              <CardBody>
                <dl className="flex flex-col gap-2.5">
                  {WE_DONT.map((d) => (
                    <div key={d.label}>
                      <dt className="font-semibold text-danger">{d.label}</dt>
                      <dd className="text-ink-soft">{d.body}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          </CardGrid>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Alert tone="warn" title="결과에 대한 책임">
              한인회의 지원은 <b>선의에 기초한 자원봉사</b>입니다. 연결·통역·동행에 최선을 다하지만
              의료 결과, 법률 절차의 결과, 수사 결과, 보상 여부에 대해서는 어떠한 보증도 하지 않으며
              책임을 지지 않습니다. 통역 과정의 의미 차이에 대해서도 법적 책임을 지지 않습니다.
              중요한 법적·의료적 결정은 반드시 자격을 갖춘 전문가의 확인을 받으십시오.
            </Alert>
            <Alert tone="success" title="회비와 무관합니다">
              긴급 지원은 회비 납부 여부와 관계없이 제공됩니다. 회원, 비회원, 미납자, 단기 체류자,
              관광객 <b>모두 동일하게</b> 지원합니다. 접수 단계에서 회비를 묻지 않습니다. 급할 때
              회비를 걱정하지 마시고 먼저 연락 주십시오.
            </Alert>
            <Alert tone="info" title="개인정보">
              접수된 정보는 <b>긴급 대응 목적으로만</b> 사용하며 담당 임원 외에는 열람할 수
              없습니다. 본인 동의 없이 제3자·단톡방·SNS에 공유하지 않습니다. 생명이 위급하거나
              법령상 통보 의무가 있는 경우(공관 통보 등)에는 사후에 알려 드립니다. 기록은 2년 보관 후
              삭제합니다.
            </Alert>
          </div>
        </section>

        {/* ── 이해상충 안내 ───────────────────────────────────────────── */}
        <Alert tone="info" title="이해상충이 있는 사건은 회장이 대응 라인에서 빠집니다">
          <p>
            현 회장은 일로일로에서 여러 사업을 운영합니다. 사건 당사자가 그 사업체의 직원·고객·
            거래처인 경우 <b>회장을 대응 라인에서 제외</b>하고 부회장이 총괄하며, 그 사실을 기록에
            남깁니다. 법률 리퍼럴은 항상 <b>복수 명단</b>으로 드리고, 회장 배우자가 운영하는 로펌을
            단독 추천하는 것은 명시적으로 금지되어 있습니다.
          </p>
          <p className="mt-2">
            <Link href={`${ROUTES.ledger}#conflict`} className="link-ika font-semibold">
              임원 이해상충 공시 전체 보기 →
            </Link>
          </p>
        </Alert>
      </Stack>
    </PageContainer>
  );
}
