import type { Metadata } from "next";

import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  maskName,
  PageContainer,
  PageHeader,
  Stack,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { cfgNum, evaluateMemberCard, loadSettings, todayManila } from "@/lib/domain";
import { ORG_NAME, ROUTES } from "@/lib/site";

/**
 * /verify/<토큰> — 회원증 진위 확인 (P3). **로그인 없는 공개 화면.**
 *
 * ══ 이 파일에 무엇을 더할 때는 먼저 이 목록을 읽어라 ══════════════════════
 *  나가는 것 : 마스킹 성명(홍*수) · 회원구분 · 유효연도 · 유효/무효
 *  나가면 안 되는 것 : 회원번호 · 연락처 · 이메일 · 주소 · 사진 · 납부 금액 ·
 *                      미납 여부 · 가입일 · 그 밖의 모든 원장 값
 *
 *  ★ **무효 사유를 쓰지 않는다.** "회비 미납" 이라고 적으면 카드를 든 회원의
 *    재정 상태를 가게 주인에게 알려 주는 셈이다. 무효면 무효라고만 한다.
 *  ★ 사진을 띄우지 않는다. 얼굴은 카드 실물에 있고, 확인하는 사람은 그 실물과
 *    눈앞의 사람을 보면 된다. 웹에 얼굴을 공개할 이유가 없다.
 *  ★ 회원번호를 URL 에 쓰지 않는다. M0001 은 순차라서 M0002, M0003 … 을 세어
 *    회원 전체를 훑을 수 있다. 그래서 주소는 128비트 난수 토큰이다.
 *  ★ 존재하지 않는 토큰과 무효한 회원증을 **같은 화면**으로 처리하지 않는다 —
 *    없는 토큰에는 이름조차 없으므로 아예 다른 문구를 쓴다. 다만 어느 쪽도
 *    "왜" 는 말하지 않는다.
 *
 * ══ 유효 판정은 볼 때마다 다시 센다 ═══════════════════════════════════════
 *  DB 에 굳혀 두지 않는다. 회비가 미납으로 돌아서거나 탈퇴하면 **다음 스캔부터**
 *  무효로 나와야 한다. 판정 규칙은 회원 화면과 같은 domain/memberCard.ts 다.
 *  (next.config.ts 가 이 경로에 no-store 를 붙여 프록시 캐시도 막는다)
 */
export const metadata: Metadata = {
  title: "회원증 확인",
  description: `${ORG_NAME} 회원증 진위 확인`,
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/** 토큰 형식 — base64url 22자(128비트). DB 를 두들기기 전에 형식부터 거른다. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw ?? "").trim();

  const card = TOKEN_RE.test(token)
    ? await prisma.memberCard.findUnique({
        where: { verifyToken: token },
        select: {
          photoStatus: true,
          member: { select: { memberNo: true, name: true, memberType: true, status: true } },
        },
      })
    : null;

  /* ── 없는 토큰 ── */
  if (!card) {
    return (
      <Shell>
        <Card>
          <CardHeader
            title="확인할 수 없는 회원증입니다"
            description="주소가 잘못되었거나 더 이상 사용되지 않는 회원증입니다."
          />
          <CardBody>
            <Verdict valid={false} />
            <p className="mt-3 text-ink-soft">
              카드에 인쇄된 QR 을 다시 스캔해 주십시오. 계속 이 화면이 나오면 {ORG_NAME}에
              문의해 주시기 바랍니다.
            </p>
          </CardBody>
        </Card>
      </Shell>
    );
  }

  const settings = await loadSettings(prisma);
  const fiscalYear = cfgNum(settings, "회계연도", Number(todayManila().slice(0, 4)));

  // ★ 회비 고지는 **판정에만** 쓴다. 금액·상태는 화면으로 내보내지 않는다.
  const dues = await prisma.duesInvoice.findUnique({
    where: { fiscalYear_memberNo: { fiscalYear, memberNo: card.member.memberNo } },
    select: { status: true, billedAmount: true, paidAmount: true, unpaidAmount: true },
  });

  const verdict = evaluateMemberCard({
    memberStatus: card.member.status,
    photoStatus: card.photoStatus,
    dues,
    fiscalYear,
  });

  return (
    <Shell>
      <Card>
        <CardHeader
          title={`${ORG_NAME} 회원증`}
          description="이 페이지는 회원증의 유효 여부만 알려 드립니다. 회원의 연락처·주소·납부 내역은 어떤 경우에도 표시되지 않습니다."
        />
        <CardBody>
          <Verdict valid={verdict.valid} />

          <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 border-t border-line-soft pt-4">
            <dt className="font-semibold text-ink-muted">성명</dt>
            {/* 마스킹은 여기서 처음 하는 것이 아니라 **여기서만** 한다 — 원본 이름은
                이 컴포넌트 밖으로 나가지 않는다 */}
            <dd className="font-semibold">{maskName(card.member.name)}</dd>

            <dt className="font-semibold text-ink-muted">회원구분</dt>
            <dd>{card.member.memberType}</dd>

            <dt className="font-semibold text-ink-muted">유효연도</dt>
            <dd className="tnum">{fiscalYear}년</dd>
          </dl>

          <p className="mt-4 text-sm text-ink-muted">
            {verdict.valid
              ? "카드에 인쇄된 이름·사진과 앞에 계신 분이 같은지 확인해 주십시오. 이 화면만으로는 본인 확인이 되지 않습니다."
              : "이 회원증은 현재 사용하실 수 없습니다. 자세한 사항은 본인이 한인회에 확인하셔야 합니다."}
          </p>
        </CardBody>
      </Card>
    </Shell>
  );
}

/** 유효/무효 — 색만으로 말하지 않는다. 흑백 화면·색약에서도 글자가 의미를 싣는다. */
function Verdict({ valid }: { valid: boolean }) {
  return (
    <div
      className={
        "flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-4 " +
        (valid
          ? "border-success-line bg-success-bg text-success"
          : "border-danger-line bg-danger-bg text-danger")
      }
    >
      <span aria-hidden="true" className="text-3xl leading-none font-bold">
        {valid ? "✓" : "✕"}
      </span>
      <div>
        <p className="text-2xl font-bold">{valid ? "유효" : "무효"}</p>
        <p className="text-sm font-semibold">
          {valid ? "현재 유효한 회원증입니다." : "현재 유효하지 않은 회원증입니다."}
        </p>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer>
      <PageHeader
        title="회원증 확인"
        titleEn="Card Verification"
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
      />
      <Stack>
        {children}
        <Badge tone="neutral">이 화면은 검색엔진에 색인되지 않습니다</Badge>
      </Stack>
    </PageContainer>
  );
}
