import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Card,
  CardBody,
  CardGrid,
  CardHeader,
  EmptyState,
  formatPeso,
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
import { cfgStr, fxTableFrom, loadSettings } from "@/lib/domain";
import { ORG_NAME, ROUTES } from "@/lib/site";

import { PrivacyConsentSummary, type DpoContact } from "../_consent";
import { newFormToken } from "../_shared";
import { DonateForm, type FundOption } from "./DonateForm";

export const metadata: Metadata = {
  title: "기부",
  description:
    "긴급구호·장학 기금 기부 접수. 지정하신 기금은 그 목적에만 씁니다. 사용 내역은 공개 회계에 건별로 전액 공개됩니다.",
  alternates: { canonical: ROUTES.donate },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: ORG_NAME,
    title: `기부 · ${ORG_NAME}`,
    description: "지정 기부는 목적 외 사용이 불가능합니다. 쓴 내역은 건별로 전액 공개합니다.",
    url: ROUTES.donate,
    // ★ 페이지에서 openGraph 를 정의하면 루트의 og:image 가 통째로 사라진다.
    //   images 를 빼면 카톡에 링크를 붙여도 썸네일 카드가 뜨지 않는다(curl 로 확인).
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${ORG_NAME} 기부` }],
  },
};

/** 폼 토큰을 요청마다 새로 내려야 하고, 기금 목록·환율을 DB 에서 읽는다. */
export const dynamic = "force-dynamic";

export default async function DonatePage() {
  const [settings, funds, officers, recentUses] = await Promise.all([
    loadSettings(prisma),
    prisma.fund.findMany({
      where: { status: "ACTIVE", isPublic: true },
      orderBy: { fundId: "asc" },
    }),
    prisma.officer.findMany({
      where: { status: "ACTIVE" },
      select: { role: true, email: true, phone: true },
    }),
    // "내 기부금이 실제로 어디에 쓰였나" — 08_기부사용 최근 내역. 개인정보가 없는 표다.
    prisma.donationUse.findMany({
      where: { status: "집행" },
      orderBy: { usedOn: "desc" },
      take: 5,
      include: { fund: { select: { name: true } } },
    }),
  ]);

  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");
  const treasurer = officers.find((o) => o.role === "총무");
  const auditor = officers.find((o) => o.role === "감사");
  const contact: DpoContact = {
    treasurerEmail: treasurer?.email || contactEmail || "[확인 필요]",
    treasurerPhone: treasurer?.phone || "[확인 필요]",
    auditorEmail: auditor?.email || "[확인 필요]",
  };

  const designatedFunds: FundOption[] = funds
    .filter((f) => f.kind !== "일반")
    .map((f) => ({ fundId: f.fundId, name: f.name, purpose: f.purpose }));

  return (
    <PageContainer>
      <PageHeader
        title="기부"
        titleEn="Donate"
        description="한인회에 마음을 보태 주셔서 감사합니다. 기부금 사용 내역은 공개 장부에 전액 공개됩니다."
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
      />

      <Stack gap="md">
        <Alert tone="info" title="지정 기부는 목적 외 사용이 불가능합니다">
          <p>
            기금을 지정하시면 그 기금의 목적에만 쓸 수 있습니다. 일반회계와 장부가 분리되어 있고,
            접수액을 넘겨 쓰면 매주 도는 무결성 검사가 잡아냅니다. 지정하지 않으시면 일반회계로
            들어가 그때그때 필요한 곳에 씁니다.
          </p>
        </Alert>

        <section aria-labelledby="funds-heading">
          <h2 id="funds-heading" className="mb-3 text-xl">
            기금 안내
          </h2>
          <CardGrid columns={2}>
            {funds.map((f) => (
              <Card key={f.fundId} as="article">
                <CardHeader
                  headingLevel={3}
                  title={
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span>{f.name}</span>
                      <span className="text-sm font-normal text-ink-faint">{f.fundId} · {f.kind}</span>
                    </span>
                  }
                  description={f.purpose || undefined}
                />
                <CardBody>
                  <p className="text-sm text-ink-muted">
                    {f.kind === "일반"
                      ? "용도를 지정하지 않은 기부와 회비가 들어가는 기금입니다."
                      : "이 기금은 위 목적에만 쓸 수 있습니다."}
                    {f.targetAmount > 0 ? ` 목표 ${formatPeso(f.targetAmount)}.` : ""}
                  </p>
                </CardBody>
              </Card>
            ))}
          </CardGrid>
        </section>

        <Card>
          <CardHeader
            title="최근 기금 사용 내역"
            description="기부금이 실제로 어디에 쓰였는지 (08_기부사용). 전체는 공개 회계에서 보실 수 있습니다."
            action={
              <Link href={ROUTES.ledger} className="link-ika text-sm font-semibold">
                공개 회계 전체 보기 →
              </Link>
            }
          />
          {recentUses.length === 0 ? (
            <CardBody>
              <EmptyState
                icon="🧾"
                title="아직 집행된 기금 사용 내역이 없습니다"
                description="기부금을 집행하면 이 자리에 건별로 표시됩니다."
              />
            </CardBody>
          ) : (
            <TableCardBody label="최근 기금 사용 내역">
              <Table caption="최근 집행된 지정기금 사용 내역" captionHidden>
                <THead>
                  <TR>
                    <TH>사용일</TH>
                    <TH>기금</TH>
                    <TH>용도</TH>
                    <TH numeric>금액</TH>
                  </TR>
                </THead>
                <TBody>
                  {recentUses.map((u) => (
                    <TR key={u.useId}>
                      <TD>{u.usedOn}</TD>
                      <TD>{u.fund.name}</TD>
                      <TD>{u.purposeText}</TD>
                      <TD numeric>{formatPeso(u.amountPhp)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableCardBody>
          )}
        </Card>

        <DonateForm
          formToken={newFormToken()}
          funds={designatedFunds}
          fxTable={fxTableFrom(settings)}
          contactEmail={contact.treasurerEmail}
          consentSlot={<PrivacyConsentSummary contact={contact} purpose="기부금" />}
        />
      </Stack>
    </PageContainer>
  );
}
