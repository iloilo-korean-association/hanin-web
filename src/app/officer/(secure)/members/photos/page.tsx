import type { Metadata } from "next";

import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  GuardDenied,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
  StatGrid,
  Table,
  TableCardBody,
  TBody,
  TD,
  TH,
  THead,
  TR,
  type BadgeTone,
  type StatItem,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { cfgNum, evaluateMemberCard, loadSettings, manilaDateTimeStr, todayManila } from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { toViewUrl } from "../../../_lib/evidence-view";
import { PhotoReviewForm } from "./PhotoReviewForm";

/**
 * /officer/members/photos — 회원 사진 검수 (P3).
 *
 * ★ 개인정보 화면 중에서도 가장 민감하다. 회원 **얼굴 사진**이 그대로 보인다.
 *   · 열람은 "조회권", 판정은 "회원관리" + 쓰기(감사 제외) — 서버 액션이 다시 검사한다.
 *   · 사진은 비공개 Blob 이고, 여기서 렌더 시점에 10분짜리 서명 URL 을 만든다.
 *     이 페이지를 벗어난 링크는 몇 분 뒤 죽는다(evidence-view.ts).
 *   · robots noindex 는 /officer 레이아웃과 next.config.ts 헤더가 이미 걸어 두었다.
 *
 * ★ 대기 건이 맨 위다. 검수가 밀리면 회원증이 안 나가고, 회원은 총무에게 전화한다.
 */
export const metadata: Metadata = {
  title: "회원 사진 검수",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** 대기 → 반려 → 승인 순. 손이 필요한 것부터 위로 올린다. */
const STATUS_ORDER: Record<string, number> = { 대기: 0, 반려: 1, 승인: 2 };

const STATUS_TONE: Record<string, BadgeTone> = {
  대기: "warn",
  승인: "success",
  반려: "danger",
};

export default async function MemberPhotosPage() {
  let me;
  try {
    me = await requireOfficer({ permissions: ["조회권"], screen: "회원 사진 검수" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="회원 사진 검수"
            breadcrumb={[{ href: ROUTES.officer, label: "임원" }]}
          />
          <GuardDenied message={e.message} howToFix={e.howToFix} />
        </PageContainer>
      );
    }
    throw e;
  }

  const settings = await loadSettings(prisma);
  const fiscalYear = cfgNum(settings, "회계연도", Number(todayManila().slice(0, 4)));

  const cards = await prisma.memberCard.findMany({
    orderBy: { photoUploadedAt: "asc" }, // 오래 기다린 분 먼저
    select: {
      memberNo: true,
      photoUrl: true,
      photoStatus: true,
      photoUploadedAt: true,
      photoReviewedBy: true,
      photoReviewedAt: true,
      photoRejectReason: true,
      photoConsentAt: true,
      member: {
        select: {
          name: true,
          memberType: true,
          status: true,
          duesInvoices: {
            where: { fiscalYear },
            select: { status: true, billedAmount: true, paidAmount: true, unpaidAmount: true },
          },
        },
      },
    },
  });

  // 서명 URL 은 렌더 시점에 만든다. 페이지당 몇 건이든 HMAC 계산이라 네트워크 비용이 없다.
  const rows = await Promise.all(
    cards.map(async (c) => {
      const dues = c.member.duesInvoices[0] ?? null;
      return {
        ...c,
        viewUrl: c.photoUrl ? await toViewUrl(c.photoUrl) : "",
        dues,
        verdict: evaluateMemberCard({
          memberStatus: c.member.status,
          photoStatus: c.photoStatus,
          dues,
          fiscalYear,
        }),
      };
    }),
  );
  rows.sort(
    (a, b) =>
      (STATUS_ORDER[a.photoStatus] ?? 9) - (STATUS_ORDER[b.photoStatus] ?? 9) ||
      (a.photoUploadedAt?.getTime() ?? 0) - (b.photoUploadedAt?.getTime() ?? 0),
  );

  const countOf = (s: string) => rows.filter((r) => r.photoStatus === s).length;
  const stats: StatItem[] = [
    { label: "검수 대기", value: `${countOf("대기")}건`, tone: countOf("대기") > 0 ? "expense" : "neutral" },
    { label: "승인", value: `${countOf("승인")}건`, tone: "income" },
    { label: "반려", value: `${countOf("반려")}건` },
    {
      label: `${fiscalYear}년 회원증 발급 가능`,
      value: `${rows.filter((r) => r.verdict.valid).length}명`,
      sub: "사진 승인 + 회비 납부",
    },
  ];

  const canReview = me.can("회원관리") && !me.isAuditor;
  const blockedReason = me.isAuditor
    ? "감사 계정은 읽기 전용입니다."
    : me.can("회원관리")
      ? undefined
      : '"회원관리" 권한이 없습니다.';

  return (
    <PageContainer wide>
      <PageHeader
        title="회원 사진 검수"
        titleEn="Photo Review"
        breadcrumb={[
          { href: ROUTES.officer, label: "임원" },
          { href: `${ROUTES.officer}/members`, label: "회원" },
        ]}
        description="회원이 올린 회원증 사진을 확인하고 승인하거나 반려합니다. 승인하면 당해연도 회비를 납부한 회원에게 디지털 회원증이 즉시 발급됩니다."
        actions={<LinkButton href={`${ROUTES.officer}/members`}>회원 명부로</LinkButton>}
      />

      <Stack gap="md">
        <Alert tone="warn" title="회원 얼굴 사진입니다">
          <p>
            내려받거나 다른 곳에 옮겨 담지 마십시오. 이 사진은 <b>회원증 발급과 본인 확인</b>{" "}
            목적으로만 수집했고(회원이 별도로 동의한 항목입니다), 그 밖의 용도로 쓰면 필리핀
            개인정보보호법(RA 10173) 위반입니다. 승인·반려는 모두 감사로그에 남습니다.
          </p>
        </Alert>

        <StatGrid label="사진 검수 현황" items={stats} />

        <Card as="section">
          <CardHeader
            title="검수 기준"
            headingLevel={2}
            description="아래에 해당하면 반려하고, 무엇이 문제인지 한 줄로 적어 주십시오."
          />
          <CardBody>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-soft">
              <li>본인 얼굴이 아니거나 여러 사람이 함께 나온 사진</li>
              <li>얼굴이 정면으로 보이지 않는 사진 (모자·선글라스·마스크·심한 역광)</li>
              <li>너무 어둡거나 흐려서 사람을 알아볼 수 없는 사진</li>
              <li>사진이 아닌 것 (문서 캡처, 캐릭터·연예인 사진, 풍경)</li>
              <li>공공기관 제출용으로 부적절한 내용 (노출·문구·표식 등)</li>
            </ul>
          </CardBody>
        </Card>

        <Card as="section">
          <CardHeader title={`사진 ${rows.length}건`} headingLevel={2} />
          {rows.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="🖼"
                title="올라온 사진이 없습니다"
                description="회원이 본인 화면(내 정보)에서 사진을 올리면 이 자리에 나타납니다."
              />
            </CardBody>
          ) : (
            <TableCardBody label="회원 사진 검수 목록">
              <Table caption="회원이 올린 회원증 사진 목록" captionHidden>
                <THead>
                  <TR>
                    <TH>사진</TH>
                    <TH>회원</TH>
                    <TH>상태</TH>
                    <TH>제출 · 검수</TH>
                    <TH>{fiscalYear}년 회비</TH>
                    <TH>회원증</TH>
                    <TH>
                      <span className="sr-only">판정</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.memberNo} tone={r.photoStatus === "대기" ? "warn" : undefined}>
                      <TD>
                        {r.viewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 10분 만료 서명 URL. next/image 캐시에 올리면 안 된다
                          <img
                            src={r.viewUrl}
                            alt={`${r.member.name} 회원이 올린 사진`}
                            className="h-28 w-auto max-w-[7rem] rounded border border-line object-cover"
                          />
                        ) : (
                          <span className="text-sm text-ink-muted">파일 없음</span>
                        )}
                      </TD>
                      <TD>
                        <span className="font-semibold">{r.member.name}</span>
                        <span className="block font-mono text-sm text-ink-muted">{r.memberNo}</span>
                        <span className="block text-sm text-ink-muted">
                          {r.member.memberType} · {r.member.status}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone={STATUS_TONE[r.photoStatus] ?? "neutral"} dot>
                          {r.photoStatus}
                        </Badge>
                        {r.photoStatus === "반려" && r.photoRejectReason ? (
                          <span className="mt-1 block max-w-[16rem] text-sm text-ink-muted">
                            {r.photoRejectReason}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="text-sm">
                        <span className="block whitespace-nowrap">
                          제출 {r.photoUploadedAt ? manilaDateTimeStr(r.photoUploadedAt) : "—"}
                        </span>
                        <span className="block whitespace-nowrap text-ink-muted">
                          동의 {r.photoConsentAt ? manilaDateTimeStr(r.photoConsentAt) : "—"}
                        </span>
                        {r.photoReviewedAt ? (
                          <span className="block text-ink-muted">
                            검수 {manilaDateTimeStr(r.photoReviewedAt)} · {r.photoReviewedBy}
                          </span>
                        ) : null}
                      </TD>
                      <TD>
                        {r.dues ? (
                          <Badge tone={r.verdict.duesOk ? "success" : "danger"}>
                            {r.dues.status}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">고지 없음</Badge>
                        )}
                      </TD>
                      <TD>
                        {r.verdict.valid ? (
                          <Badge tone="success" dot>
                            발급됨
                          </Badge>
                        ) : (
                          <span className="block max-w-[13rem] text-sm text-ink-muted">
                            {r.verdict.blockers.map((b) => b.message).join(" ")}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <PhotoReviewForm
                          memberNo={r.memberNo}
                          memberName={r.member.name}
                          disabled={!canReview}
                          disabledReason={blockedReason}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableCardBody>
          )}
        </Card>
      </Stack>
    </PageContainer>
  );
}
