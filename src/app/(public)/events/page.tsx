import type { Metadata } from "next";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  formatPeso,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
  StatLine,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { cfgStr, loadSettings, manilaDateTimeStr, todayManila } from "@/lib/domain";
import { ORG_NAME, ROUTES } from "@/lib/site";

import { PrivacyConsentSummary, type DpoContact } from "../_consent";
import { newFormToken } from "../_shared";
import { EventSignupForm, type OpenEventOption } from "./EventSignupForm";

export const metadata: Metadata = {
  title: "행사",
  description:
    "일로일로 한인회 행사 일정과 참가 신청. 정원·마감일·참가비를 미리 확인하시고 신청하실 수 있습니다.",
  alternates: { canonical: ROUTES.events },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: ORG_NAME,
    title: `행사 · ${ORG_NAME}`,
    description: "정기총회·체육대회·명절 한마당. 참가 신청은 이 페이지에서 바로 하실 수 있습니다.",
    url: ROUTES.events,
    // ★ 페이지에서 openGraph 를 정의하면 루트의 og:image 가 통째로 사라진다.
    //   images 를 빼면 카톡에 링크를 붙여도 썸네일 카드가 뜨지 않는다(curl 로 확인).
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${ORG_NAME} 행사` }],
  },
};

/** 신청 현황(남은 자리)이 실시간이어야 하고, 폼 토큰을 요청마다 새로 내린다. */
export const dynamic = "force-dynamic";

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * Asia/Manila 기준으로 "2026년 9월 26일 (토) 14:00".
 * 서버의 로컬 타임존이 무엇이든 같은 답이 나와야 한다 — 그래서 Date 의 로컬 게터를 쓰지 않는다.
 */
function koDateTime(d: Date): string {
  const [ymd, hm] = manilaDateTimeStr(d).split(" ");
  const [y, m, dd] = ymd.split("-").map(Number);
  const w = WEEKDAY_KO[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return `${y}년 ${m}월 ${dd}일 (${w}) ${hm}`;
}

export default async function EventsPage() {
  const today = todayManila();

  const [settings, events, signupSums, officers] = await Promise.all([
    loadSettings(prisma),
    prisma.event.findMany({ where: { isPublic: true }, orderBy: { startsAt: "desc" } }),
    // ★ 집계만 읽는다. 10_행사신청에는 신청자 실명·연락처가 있어 공개 화면으로 내보내지 않는다.
    prisma.eventSignup.groupBy({
      by: ["eventId"],
      where: { status: { not: "취소" } },
      _sum: { totalPeople: true },
      _count: { _all: true },
    }),
    prisma.officer.findMany({
      where: { status: "ACTIVE" },
      select: { role: true, email: true, phone: true },
    }),
  ]);

  const takenOf = new Map(signupSums.map((s) => [s.eventId, s._sum.totalPeople ?? 0]));
  const countOf = new Map(signupSums.map((s) => [s.eventId, s._count._all]));

  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");
  const treasurer = officers.find((o) => o.role === "총무");
  const auditor = officers.find((o) => o.role === "감사");
  const contact: DpoContact = {
    treasurerEmail: treasurer?.email || contactEmail || "[확인 필요]",
    treasurerPhone: treasurer?.phone || "[확인 필요]",
    auditorEmail: auditor?.email || "[확인 필요]",
  };

  const open = events.filter(
    (e) => e.status === "접수중" && (!e.signupDeadline || e.signupDeadline >= today),
  );
  const past = events.filter((e) => !open.includes(e));

  const options: OpenEventOption[] = open.map((e) => ({
    eventId: e.eventId,
    title: e.title,
    fee: e.fee,
    capacity: e.capacity,
    seatsLeft: e.capacity > 0 ? Math.max(0, e.capacity - (takenOf.get(e.eventId) ?? 0)) : null,
    signupDeadline: e.signupDeadline,
  }));

  return (
    <PageContainer>
      <PageHeader
        title="행사"
        titleEn="Events"
        description="한인회 행사 일정과 참가 신청입니다. 회비 납부 여부와 관계없이 누구나 신청하실 수 있습니다."
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
      />

      <Stack gap="md">
        <section aria-labelledby="open-heading">
          <h2 id="open-heading" className="mb-3 text-xl">
            신청 받는 행사
          </h2>

          {open.length === 0 ? (
            <EmptyState
              icon="📅"
              title="지금 신청 받는 행사가 없습니다"
              description="다음 행사가 정해지면 이 자리와 홈 화면 공지에 올라옵니다. 지난 행사 결산은 공개 회계에서 보실 수 있습니다."
              action={<LinkButton href={ROUTES.ledger}>공개 회계 보기</LinkButton>}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {open.map((e) => {
                const taken = takenOf.get(e.eventId) ?? 0;
                const left = e.capacity > 0 ? Math.max(0, e.capacity - taken) : null;
                return (
                  <Card key={e.eventId} as="article">
                    <CardHeader
                      headingLevel={3}
                      title={
                        <span className="flex flex-wrap items-center gap-2">
                          <span>{e.title}</span>
                          <Badge tone="success" dot>
                            접수중
                          </Badge>
                          {left !== null && left <= 10 ? (
                            <Badge tone="warn">자리 얼마 안 남았습니다 · {left}명</Badge>
                          ) : null}
                        </span>
                      }
                      description={`${e.kind} · ${e.eventId}`}
                    />
                    <CardBody>
                      <StatLine label="일시" value={koDateTime(e.startsAt)} />
                      {e.place ? <StatLine label="장소" value={e.place} /> : null}
                      <StatLine label="참가비" value={e.fee > 0 ? `1인 ${formatPeso(e.fee)}` : "무료"} />
                      <StatLine
                        label="정원"
                        value={
                          e.capacity > 0
                            ? `${e.capacity}명 중 ${taken}명 신청 · 남은 자리 ${left}명`
                            : "제한 없음"
                        }
                      />
                      {e.signupDeadline ? <StatLine label="신청 마감" value={e.signupDeadline} /> : null}
                      {e.budget > 0 ? (
                        <StatLine label="편성 예산" value={formatPeso(e.budget)} />
                      ) : null}
                      {e.note ? <p className="mt-3 text-ink-soft">{e.note}</p> : null}
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {open.length > 0 ? (
          <EventSignupForm
            formToken={newFormToken()}
            events={options}
            contactEmail={contact.treasurerEmail}
            consentSlot={<PrivacyConsentSummary contact={contact} purpose="행사 참가" />}
          />
        ) : null}

        {past.length > 0 ? (
          <Card>
            <CardHeader
              title="지난 행사"
              description="신청자 명단은 공개하지 않습니다. 인원 집계와 결산 여부만 표시합니다."
            />
            <TableCardBody label="지난 행사 목록">
              <Table caption="지난 행사와 참가 인원" captionHidden>
                <THead>
                  <TR>
                    <TH>행사</TH>
                    <TH>일시</TH>
                    <TH>상태</TH>
                    <TH numeric>신청 건수</TH>
                    <TH numeric>참가 인원</TH>
                    <TH>결산</TH>
                  </TR>
                </THead>
                <TBody>
                  {past.map((e) => (
                    <TR key={e.eventId} tone={e.status === "취소" ? "muted" : undefined}>
                      <TD>
                        {e.title}
                        <span className="block text-sm text-ink-muted">{e.eventId}</span>
                      </TD>
                      <TD>{koDateTime(e.startsAt)}</TD>
                      <TD>
                        <Badge tone={e.status === "완료" ? "neutral" : e.status === "취소" ? "danger" : "info"}>
                          {e.status}
                        </Badge>
                      </TD>
                      <TD numeric>{countOf.get(e.eventId) ?? 0}</TD>
                      <TD numeric>{takenOf.get(e.eventId) ?? 0}</TD>
                      <TD>
                        {e.settlementReceiptNos ? (
                          <Badge tone="success">정산완료</Badge>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableCardBody>
          </Card>
        ) : null}

        <Alert tone="info" title="행사비는 어떻게 쓰이나">
          <p>
            행사 참가비와 예산 집행 내역은 모두{" "}
            <a className="link-ika" href={ROUTES.ledger}>
              공개 회계
            </a>{" "}
            에 건별로 올라갑니다. 누가 냈는지는 공개하지 않고, 무엇에 얼마를 썼는지는 전부 공개합니다.
          </p>
        </Alert>
      </Stack>
    </PageContainer>
  );
}
