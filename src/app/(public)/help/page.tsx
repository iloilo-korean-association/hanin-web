import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Card,
  CardBody,
  CardGrid,
  CardHeader,
  PageContainer,
  PageHeader,
  Stack,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { cfgStr, hotlineFrom, loadSettings } from "@/lib/domain";
import { EMERGENCY_NUMBER, ORG_NAME, ROUTES } from "@/lib/site";

import { newFormToken } from "../_shared";
import { HelpForm } from "./HelpForm";

export const metadata: Metadata = {
  title: "도움 요청 · 문의",
  description:
    "사고·질병·체포·재해 등 어려움에 처하셨을 때 한인회에 지원을 요청하는 곳입니다. 생명이 위험하면 먼저 911.",
  alternates: { canonical: ROUTES.help },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: ORG_NAME,
    title: `도움 요청 · ${ORG_NAME}`,
    description: "24시간 초동 연결 · 통역 · 동행. 회비 납부 여부와 관계없이 지원합니다.",
    url: ROUTES.help,
    // ★ 페이지에서 openGraph 를 정의하면 루트의 og:image 가 통째로 사라진다.
    //   images 를 빼면 카톡에 링크를 붙여도 썸네일 카드가 뜨지 않는다(curl 로 확인).
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${ORG_NAME} 도움 요청` }],
  },
};

/** 폼 토큰을 요청마다 새로 내리고, 담당 임원 연락처를 DB 에서 읽는다. */
export const dynamic = "force-dynamic";

/**
 * 04_운영SOP/24시간_긴급대응_SOP.md §7 에서 확인된 번호만 적는다.
 * `[확인 필요]` 로 남아 있는 번호는 **지어내지 않고 빈칸으로 둔다.**
 */
const VERIFIED_CONTACTS: Array<{ name: string; tel: string; note: string }> = [
  { name: "필리핀 전국 긴급 (경찰·소방·구급)", tel: "911", note: "무료 · 유무선 모두. 2016.8.1. 117을 대체" },
  { name: "주세부 대한민국 분관", tel: "+63-32-231-1516", note: "일로일로 관할 공관" },
  { name: "주세부분관 야간 긴급 (사건·사고)", tel: "+63-917-808-3907", note: "야간·주말" },
  { name: "주필리핀 대한민국 대사관", tel: "+63-2-8856-9210", note: "긴급 +63-917-817-5703" },
  { name: "영사콜센터 (한국, 24시간)", tel: "+82-2-3210-0404", note: "한국어 상담" },
];

const WE_DO: Array<[string, string]> = [
  ["초동 연결", "24시간 연락을 받고, 상황에 맞는 기관(경찰·병원·소방·구조·영사관)에 신속히 연결해 드립니다"],
  ["통역", "경찰서·병원·관공서에서 한국어-영어 의사소통을 돕습니다"],
  ["동행", "혼자 가기 어려운 자리에 함께 갑니다"],
  ["정보 제공", "절차 안내, 필요 서류 안내, 복수의 전문가 명단 제공"],
  ["가족 연락", "본인 동의 하에 한국의 가족과 연결을 돕습니다"],
  ["공관 통보", "체포·중상·사망·실종 등 중대 사안은 즉시 주세부분관에 통보합니다"],
];

const WE_DONT: Array<[string, string]> = [
  ["금전", "치료비·입원 보증금·보석금·합의금·송환비를 대납하지 않습니다"],
  ["보증", "신원보증·채무보증·각종 보증서 발급을 하지 않습니다"],
  ["법률", "법률 자문·유무죄 판단·계약 유효성 판단을 하지 않습니다. 저희는 변호사가 아닙니다"],
  ["의료", "진단·치료 방침·수술 여부 등 의학적 판단을 하지 않습니다. 저희는 의료인이 아닙니다"],
  ["중재", "분쟁의 중재·조정·화해 주선을 하지 않습니다"],
  ["대행", "보험 청구·경찰 수사·소송·행정 절차를 대행하지 않습니다"],
  ["추천", "특정 변호사·병원·업체를 단독 추천하지 않습니다. 항상 복수의 선택지를 드리고 결정은 본인이 하십니다"],
];

export default async function HelpPage() {
  const settings = await loadSettings(prisma);
  const hotline = hotlineFrom(settings);
  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");
  const facebook = cfgStr(settings, "웹앱.페이스북", "");

  return (
    <PageContainer>
      {/* ★ 최상단. 이 페이지에서 가장 먼저 눈에 들어와야 하는 것은 폼이 아니라 911 이다. */}
      <aside
        aria-label="긴급 전화 안내"
        className="mb-6 rounded-[var(--radius-card)] border-2 border-danger-line bg-danger-bg px-4 py-5 text-center sm:px-6"
      >
        <p className="text-lg font-bold text-danger">지금 생명이 위험하면 한인회보다 먼저</p>
        <a
          href={`tel:${EMERGENCY_NUMBER}`}
          className="mt-1 inline-flex min-h-touch items-center justify-center text-5xl font-bold tracking-wide text-danger tnum underline decoration-2 underline-offset-4"
        >
          {EMERGENCY_NUMBER}
        </a>
        <p className="mt-2 font-semibold text-ink-soft">
          필리핀 전국 긴급번호 (경찰·소방·구급) · 무료 · 유선 무선 모두
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          그 다음에 한인회로 연락 주십시오.{" "}
          {hotline.ready ? (
            <>
              긴급 핫라인{" "}
              <a href={`tel:${hotline.number}`} className="link-ika font-semibold">
                {hotline.number}
              </a>
            </>
          ) : (
            <b>한인회 긴급 핫라인은 개통 준비 중입니다 — 아래 양식이나 임원 직통으로 연락 주십시오.</b>
          )}
        </p>
      </aside>

      <PageHeader
        title="도움 요청 · 문의"
        titleEn="Get Help"
        description="사고·질병·체포·재해로 어려움에 처하셨을 때 한인회에 지원을 요청하시는 곳입니다. 회비 납부 여부와 관계없이 지원합니다."
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
      />

      <Stack gap="md">
        <Alert tone="success" title="회비와 무관합니다">
          <p>
            긴급 지원은 회비 납부 여부와 관계없이 제공됩니다. 회원, 비회원, 회비 미납자, 단기 체류자,
            관광객 — <b>모두 동일하게 지원합니다.</b> 급할 때 회비를 걱정하지 마십시오. 먼저 연락 주십시오.
          </p>
        </Alert>

        <CardGrid columns={2}>
          <Card as="article">
            <CardHeader headingLevel={2} title="저희가 하는 일" description="초동 연결 · 통역 · 동행" />
            <CardBody>
              <dl className="flex flex-col gap-3">
                {WE_DO.map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-semibold text-success">{k}</dt>
                    <dd className="text-ink-soft">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>

          <Card as="article">
            <CardHeader
              headingLevel={2}
              title="저희가 할 수 없는 일"
              description="사건이 터진 다음에 말씀드리면 변명이 됩니다. 먼저 알려 드립니다."
            />
            <CardBody>
              <dl className="flex flex-col gap-3">
                {WE_DONT.map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-semibold text-danger">{k}</dt>
                    <dd className="text-ink-soft">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </CardGrid>

        <Alert tone="warn" title="결과에 대한 책임">
          <p>
            한인회의 지원은 선의에 기초한 자원봉사입니다. 저희는 연결·통역·동행에 최선을 다하지만,
            의료 결과, 법률 절차의 결과, 수사 결과, 보상 여부에 대해서는 어떠한 보증도 하지 않으며
            책임을 지지 않습니다. 통역 과정에서 발생할 수 있는 의미 차이에 대해서도 법적 책임을 지지
            않습니다. <b>중요한 법적·의료적 결정은 반드시 자격을 갖춘 전문가의 확인을 받으십시오.</b>
          </p>
        </Alert>

        <section aria-labelledby="intake-heading">
          <h2 id="intake-heading" className="mb-3 text-xl">
            지원 요청 접수
          </h2>
          <p className="mb-4 max-w-prose text-ink-muted">
            아래 내용을 적어 주시면 담당 임원에게 바로 통보됩니다. 급하시면 전화가 더 빠릅니다.
          </p>
          <HelpForm formToken={newFormToken()} />
        </section>

        <Card>
          <CardHeader
            title="확인된 긴급 연락처"
            description="24시간 긴급대응 SOP §7 에서 확인된 번호만 적었습니다. 확인되지 않은 번호는 지어내지 않았습니다."
            action={
              <Link href={ROUTES.sos} className="link-ika text-sm font-semibold">
                전체 연락처 보기 →
              </Link>
            }
          />
          <TableCardBody label="확인된 긴급 연락처">
            <Table caption="긴급 연락처" captionHidden>
              <THead>
                <TR>
                  <TH>기관</TH>
                  <TH>번호</TH>
                  <TH>비고</TH>
                </TR>
              </THead>
              <TBody>
                {VERIFIED_CONTACTS.map((c) => (
                  <TR key={c.name}>
                    <TD>{c.name}</TD>
                    <TD>
                      <a href={`tel:${c.tel.replace(/\s/g, "")}`} className="link-ika font-semibold tnum">
                        {c.tel}
                      </a>
                    </TD>
                    <TD className="text-ink-muted">{c.note}</TD>
                  </TR>
                ))}
                <TR tone="warn">
                  <TD>일로일로 한인회 긴급 핫라인</TD>
                  <TD>{hotline.ready ? hotline.number : "확인 중 (개통 준비)"}</TD>
                  <TD className="text-ink-muted">
                    개통 전까지는 위 양식 또는 {EMERGENCY_NUMBER} 를 이용해 주십시오.
                  </TD>
                </TR>
              </TBody>
            </Table>
          </TableCardBody>
        </Card>

        <Card>
          <CardHeader title="일반 문의" description="긴급 상황이 아닌 문의는 여기로 주십시오." />
          <CardBody>
            <ul className="flex flex-col gap-2">
              <li>
                이메일:{" "}
                <a className="link-ika font-semibold" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
              </li>
              {facebook ? (
                <li>
                  페이스북:{" "}
                  <a
                    className="link-ika font-semibold"
                    href={facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {facebook}
                  </a>{" "}
                  <span className="text-sm text-ink-muted">(근무시간 1시간 이내 / 야간은 익일 오전)</span>
                </li>
              ) : null}
              <li>
                회비·영수증 문의는{" "}
                <Link href={ROUTES.ledger} className="link-ika">
                  공개 회계
                </Link>{" "}
                를 먼저 보시면 대부분 답이 있습니다.
              </li>
              <li>
                가입은{" "}
                <Link href={ROUTES.join} className="link-ika">
                  회원 가입
                </Link>{" "}
                에서 1분이면 됩니다.
              </li>
            </ul>
          </CardBody>
        </Card>

        <Card as="aside">
          <CardHeader title="자주 받는 요청과 답변" headingLevel={2} />
          <CardBody>
            <dl className="flex flex-col gap-4">
              <div>
                <dt className="font-semibold">돈을 빌려주거나 대신 내주실 수 있나요?</dt>
                <dd className="text-ink-soft">
                  죄송합니다. 한인회 규정상 어떤 경우에도 금전 지원은 하지 않습니다. 대신 영사콜센터의
                  신속해외송금지원 제도가 있습니다. 함께 알아봐 드리겠습니다.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">좋은 변호사 한 분만 찍어 주세요.</dt>
                <dd className="text-ink-soft">
                  한 곳만 말씀드리면 그것이 저희 이해관계로 보일 수 있습니다. 세 곳을 드립니다. 직접
                  통화해 보시고 편한 곳으로 정하십시오. 상담 가실 때 통역은 함께 가 드립니다.
                  <b> 대표 배우자가 운영하는 로펌은 단독 추천하지 않습니다.</b>
                </dd>
              </div>
              <div>
                <dt className="font-semibold">이 일을 단톡방에 올려 주세요.</dt>
                <dd className="text-ink-soft">
                  개인 사안이라 규정상 올릴 수 없습니다. 접수된 정보는 담당 임원 외에 열람할 수 없고,
                  본인 동의 없이 제3자·단톡방·SNS 에 공유하지 않습니다.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">회비를 안 냈는데 도와주시나요?</dt>
                <dd className="text-ink-soft">
                  네. 접수 단계에서 회비 납부 여부를 묻지 않습니다. 물어보는 순간 이 조직은 다른 조직이
                  됩니다.
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </Stack>
    </PageContainer>
  );
}
