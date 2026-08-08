import type { Metadata } from "next";

import {
  Alert,
  GuardDenied,
  LinkButton,
  PageContainer,
  PageHeader,
  Stack,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  cashThresholdFrom,
  cfgStr,
  fiscalYearOf,
  formatReceiptNo,
  loadSettings,
  publicPolicyFrom,
  todayManila,
} from "@/lib/domain";
import { isGuardError, requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import { ReceiptForm, type MemberOption } from "./ReceiptForm";

export const metadata: Metadata = {
  title: "수납 기록",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /officer/receipt — 돈을 받은 그 자리에서 기록한다.
 *
 * ★ 페이지 가드는 write:true 로 건다. 감사 계정은 화면 자체가 열리지 않고,
 *   "왜 막혔는지 + 어떻게 하면 되는지" 가 문장으로 나온다.
 *   회장(승인권·조회권)도 입력권이 없어 여기서 막힌다 — 결재와 기장을 같은 사람이 하지 않는다.
 */
export default async function ReceiptPage() {
  let me;
  try {
    me = await requireOfficer({ permissions: ["입력권"], write: true, screen: "수납 기록" });
  } catch (e) {
    if (isGuardError(e)) {
      return (
        <PageContainer>
          <PageHeader
            title="수납 기록"
            titleEn="Record a Receipt"
            breadcrumb={[{ href: ROUTES.officer, label: "임원 대시보드" }]}
          />
          <GuardDenied
            message={e.message}
            howToFix={e.howToFix}
            action={
              <LinkButton href={ROUTES.devLogin} variant="secondary">
                다른 계정으로 확인해 보기 (/dev/login)
              </LinkButton>
            }
          />
        </PageContainer>
      );
    }
    throw e;
  }

  const today = todayManila();
  const fy = fiscalYearOf(today);
  const settings = await loadSettings(prisma);
  const policy = publicPolicyFrom(settings);

  const [members, dues, accounts, funds, categories, officers, seqRow, fyRow] = await Promise.all([
    prisma.member.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
      orderBy: { memberNo: "asc" },
      select: { memberNo: true, name: true, duesGrade: true, phoneLast4: true },
    }),
    prisma.duesInvoice.findMany({
      where: { fiscalYear: fy },
      select: { memberNo: true, unpaidAmount: true },
    }),
    prisma.account.findMany({ where: { status: "ACTIVE" }, orderBy: { accountId: "asc" } }),
    prisma.fund.findMany({ where: { status: "ACTIVE" }, orderBy: { fundId: "asc" } }),
    prisma.category.findMany({
      where: { majorType: "수입", isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    prisma.officer.findMany({
      where: { status: "ACTIVE" },
      orderBy: { officerId: "asc" },
      select: { email: true, name: true, role: true },
    }),
    prisma.receiptSequence.findUnique({ where: { fiscalYear: fy }, select: { lastSeq: true } }),
    prisma.fiscalYear.findUnique({ where: { year: fy }, select: { status: true } }),
  ]);

  const unpaidByMember = new Map(dues.map((d) => [d.memberNo, d.unpaidAmount]));
  const memberOptions: MemberOption[] = members.map((m) => ({
    memberNo: m.memberNo,
    name: m.name,
    duesGrade: m.duesGrade,
    last4: m.phoneLast4,
    unpaid: unpaidByMember.has(m.memberNo) ? (unpaidByMember.get(m.memberNo) ?? 0) : null,
  }));

  // 확인자 후보에서 **본인을 뺀다**. 혼자 받고 혼자 확인한 것은 2인 확인이 아니다(I4).
  const verifiers = officers
    .filter((o) => o.email.toLowerCase() !== me.email.toLowerCase())
    .map((o) => ({ email: o.email, label: `${o.name} ${o.role} · ${o.email}` }));

  const receiptPreview = formatReceiptNo(policy.receiptPrefix, fy, (seqRow?.lastSeq ?? 0) + 1);

  const fyClosed = !fyRow || fyRow.status.toUpperCase() === "CLOSED";

  return (
    <PageContainer wide>
      <PageHeader
        title="수납 기록"
        titleEn="Record a Receipt"
        description={`회비·기부·행사비를 받은 그 자리에서 기록합니다. 상태(POSTED / DRAFT)는 서버가 정합니다 — 화면에서 고를 수 없습니다.`}
        breadcrumb={[{ href: ROUTES.officer, label: "임원 대시보드" }]}
        actions={
          <LinkButton href={`${ROUTES.officer}/audit`} variant="secondary">
            감사 화면
          </LinkButton>
        }
      />

      <Stack>
        {fyClosed ? (
          <Alert tone="error" title={`${fy} 회계연도가 열려 있지 않습니다 (I5)`}>
            <p>
              마감된(또는 등록되지 않은) 회계연도에는 거래를 만들 수 없습니다. 저장을 눌러도 서버가
              거부합니다.
            </p>
          </Alert>
        ) : null}

        {categories.length === 0 || funds.length === 0 || accounts.length === 0 ? (
          <Alert tone="error" title="마스터 데이터가 비어 있습니다">
            <p>
              02_계좌 · 03_기금 · 04_과목 중 비어 있는 것이 있습니다. 터미널에서{" "}
              <code>npm run db:seed</code> 를 실행해 주십시오.
            </p>
          </Alert>
        ) : (
          <ReceiptForm
            today={today}
            myEmail={me.email}
            members={memberOptions}
            accounts={accounts.map((a) => ({ accountId: a.accountId, name: a.name, kind: a.kind }))}
            funds={funds.map((f) => ({ fundId: f.fundId, name: f.name, kind: f.kind }))}
            categories={categories.map((c) => ({ code: c.code, name: c.name }))}
            verifiers={verifiers}
            defaults={{
              fundId: cfgStr(settings, "기본.기금ID", funds[0]?.fundId ?? "FD01"),
              categoryCode: cfgStr(
                settings,
                "기본.과목코드.회비",
                categories[0]?.code ?? "R100",
              ),
              accountByMethod: {
                CASH: cfgStr(settings, "기본.계좌ID.CASH", ""),
                GCASH: cfgStr(settings, "기본.계좌ID.GCASH", ""),
                MAYA: cfgStr(settings, "기본.계좌ID.MAYA", ""),
                BANK: cfgStr(settings, "기본.계좌ID.BANK", ""),
                CARD_2C2P: cfgStr(settings, "기본.계좌ID.BANK", ""),
                INKIND: "",
              },
            }}
            cashThreshold={cashThresholdFrom(settings)}
            receiptPreview={receiptPreview}
          />
        )}

        <Alert tone="info" title="이 화면이 지키는 것">
          <ul className="ml-4 list-disc">
            <li>
              <b>I2 결번 없음</b> — 영수증번호는 저장 트랜잭션 안에서 발급됩니다. 저장이 실패하면
              번호도 되돌아갑니다.
            </li>
            <li>
              <b>I3 증빙 없이 POSTED 불가</b> — 사진이 없으면 서버가 DRAFT 로 내립니다.
            </li>
            <li>
              <b>I4 현금 고액 2인 확인</b> — 임계액 초과 현금은 확인자가 입력자와 달라야 합니다.
              확인자 목록에 본인은 없고, 폼을 직접 보내도 서버가 거부합니다.
            </li>
            <li>
              <b>I5 마감 연도 불변</b> — 마감된 연도 날짜로는 저장되지 않습니다.
            </li>
            <li>
              회비 수납이면 06_회비고지의 납부액·상태가 <b>같은 트랜잭션에서</b> 갱신됩니다. 그래야
              감사 화면의 회비 대사가 맞습니다.
            </li>
          </ul>
        </Alert>
      </Stack>
    </PageContainer>
  );
}
