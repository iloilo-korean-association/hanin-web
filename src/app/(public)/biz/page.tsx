import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConflictBadge,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageContainer,
  PageHeader,
  Select,
  Stack,
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { evaluateConflict, loadSettings, publicPolicyFrom } from "@/lib/domain";
import { ORG_NAME, ROUTES, absoluteUrl } from "@/lib/site";

import { telHref } from "../_data/emergency";

export const metadata: Metadata = {
  title: "업소 안내",
  description:
    "일로일로 지역 한인 업소 안내입니다. 임원과 이해관계가 있는 업소는 지분율까지 배지로 상시 표시합니다. 한인회는 특정 업소를 추천하지 않습니다.",
  alternates: { canonical: "/biz" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: absoluteUrl("/biz"),
    siteName: ORG_NAME,
    title: `업소 안내 · ${ORG_NAME}`,
    description:
      "일로일로 한인 업소 목록. 임원 이해관계는 숨기지 않고 지분율까지 배지로 표시합니다.",
    // ★ 페이지에서 openGraph 를 정의하면 루트의 og:image 가 통째로 사라진다(curl 로 확인).
    //   기본 카드를 다시 가리킨다.
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${ORG_NAME} 업소 안내` }],
  },
};

/** 업소·이해상충 정보가 바뀌면 바로 보여야 한다. */
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function BizPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const industry = one(sp.industry).trim();

  const settings = await loadSettings(prisma);
  const policy = publicPolicyFrom(settings);

  const [vendors, conflicts, officers] = await Promise.all([
    prisma.vendor.findMany({ where: { status: "ACTIVE" } }),
    prisma.conflictOfInterest.findMany(),
    prisma.officer.findMany(),
  ]);

  if (!policy.showBizDirectory) {
    return (
      <PageContainer>
        <PageHeader
          title="업소 안내"
          titleEn="Directory"
          breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
        />
        <EmptyState
          icon="🏪"
          title="업소 안내를 잠시 닫아 두었습니다"
          description="게재 기준을 정리하는 동안 목록을 내려 두었습니다. 문의 주시면 개별로 안내해 드리겠습니다."
          action={<LinkButton href={ROUTES.help}>문의하기</LinkButton>}
        />
      </PageContainer>
    );
  }

  const industries = [...new Set(vendors.map((v) => v.industry).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );

  const needle = q.toLowerCase();
  const filtered = vendors
    .filter((v) => (industry ? v.industry === industry : true))
    .filter((v) =>
      needle
        ? [v.name, v.industry, v.address].some((s) => (s ?? "").toLowerCase().includes(needle))
        : true,
    )
    // ★ 이름 순으로 정렬한다. 이해관계 업소를 목록 맨 위로 올리지 않는다 —
    //   공시는 배지로 하고, 노출 순서로 이득을 주지 않는다.
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const relatedCount = vendors.filter((v) => v.relatedParty).length;

  return (
    <PageContainer>
      <PageHeader
        title="업소 안내"
        titleEn="Directory"
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
        description={
          <>
            일로일로 지역에서 한인이 운영하거나 한인회와 거래한 업소 목록입니다. 임원과 이해관계가
            있는 업소는 <b>보라색 배지와 지분율</b>로 상시 표시합니다.
          </>
        }
      />

      <Stack gap="md">
        <Alert tone="info" title="게재는 추천이 아닙니다">
          <p>
            한인회는 특정 업소·병원·변호사를 <b>단독으로 추천하지 않습니다.</b> 목록을 드리고
            선택은 본인이 하십니다. 거래 조건·품질·분쟁에 대해 한인회는 책임지지 않습니다.
          </p>
          <p className="mt-2">
            등록 {vendors.length}곳 중 <b>{relatedCount}곳</b>이 임원 관련 업소입니다. 신고 내역은{" "}
            <Link href={`${ROUTES.ledger}#conflict`} className="link-ika font-semibold">
              공개 회계의 이해상충 공시
            </Link>
            에서 전부 보실 수 있습니다.
          </p>
        </Alert>

        {/* ── 검색·분류 필터 ─────────────────────────────────────────────── */}
        <Card as="section" className="no-print">
          <CardHeader title="찾기" headingLevel={2} />
          <CardBody>
            <form
              method="get"
              action={ROUTES.biz}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <Field htmlFor="q" label="업소명 · 주소" labelEn="Search" className="sm:flex-1">
                <Input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={q}
                  placeholder="예: 한식당, Jaro"
                  autoComplete="off"
                />
              </Field>

              <Field htmlFor="industry" label="업종" labelEn="Industry" className="sm:w-56">
                <Select id="industry" name="industry" defaultValue={industry}>
                  <option value="">전체 업종</option>
                  {industries.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="flex gap-2">
                <Button type="submit">찾기</Button>
                {q || industry ? (
                  <LinkButton href={ROUTES.biz} variant="ghost">
                    조건 지우기
                  </LinkButton>
                ) : null}
              </div>
            </form>
          </CardBody>
        </Card>

        {/* ── 목록 ───────────────────────────────────────────────────────── */}
        <section aria-labelledby="biz-list">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="biz-list" className="text-xl">
              업소 {filtered.length}곳
              {industry ? <span className="ml-2 text-base font-normal text-ink-muted">{industry}</span> : null}
            </h2>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon="🔎"
              title="조건에 맞는 업소가 없습니다"
              description="검색어를 줄이거나 업종을 '전체'로 바꿔 보십시오. 등록을 원하시면 문의해 주십시오."
              action={
                <LinkButton href={ROUTES.biz} variant="primary">
                  전체 목록 보기
                </LinkButton>
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filtered.map((v) => {
                const verdict = evaluateConflict(
                  { vendorId: v.vendorId },
                  vendors,
                  conflicts,
                  officers,
                );
                const officer = verdict.relatedOfficers[0];
                const declared = conflicts.find(
                  (c) => c.vendorId === v.vendorId && c.disclosed,
                );

                return (
                  <li key={v.vendorId}>
                    <Card as="article" className="h-full">
                      <CardBody>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h3 className="text-lg">{v.name}</h3>
                          {v.industry ? <Badge tone="neutral">{v.industry}</Badge> : null}
                        </div>

                        {/* ★ 이해관계 배지 — 접어두거나 숨기지 않는다 */}
                        {v.relatedParty ? (
                          <p className="mt-2">
                            <ConflictBadge
                              officer={
                                officer
                                  ? `${officer.name || "임원"}${officer.role ? ` ${officer.role}` : ""}`
                                  : "임원 관련"
                              }
                              relation={declared?.relationType ?? "이해관계 신고"}
                              {...(verdict.ownershipPct === null
                                ? {}
                                : { stakePct: verdict.ownershipPct })}
                            />
                            {verdict.ownershipPct === null ? (
                              <span className="ml-2 text-sm text-ink-muted">지분율 확인 중</span>
                            ) : null}
                          </p>
                        ) : null}

                        <dl className="mt-3 flex flex-col gap-1.5 text-sm">
                          {v.address ? (
                            <div className="flex gap-2">
                              <dt className="w-16 shrink-0 text-ink-muted">주소</dt>
                              <dd className="text-ink-soft">{v.address}</dd>
                            </div>
                          ) : null}
                          {/* 대표자명은 설정이 켜져 있을 때만. 개인 이름이다. */}
                          {policy.showVendorOwnerName && v.ownerName ? (
                            <div className="flex gap-2">
                              <dt className="w-16 shrink-0 text-ink-muted">대표자</dt>
                              <dd className="text-ink-soft">{v.ownerName}</dd>
                            </div>
                          ) : null}
                          {v.since ? (
                            <div className="flex gap-2">
                              <dt className="w-16 shrink-0 text-ink-muted">등록</dt>
                              <dd className="tnum text-ink-soft">{v.since}</dd>
                            </div>
                          ) : null}
                        </dl>

                        {v.phone ? (
                          <p className="mt-3">
                            <a
                              href={telHref(v.phone)}
                              className="inline-flex min-h-touch items-center rounded-[var(--radius-field)] border border-brand-200 bg-brand-50 px-3 font-bold tnum text-brand-800 hover:border-brand-400 hover:bg-brand-100"
                            >
                              {v.phone}
                            </a>
                          </p>
                        ) : (
                          <p className="mt-3 text-sm text-ink-muted">등록된 전화번호가 없습니다.</p>
                        )}
                      </CardBody>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Card as="section">
          <CardHeader title="등록·수정·삭제 요청" headingLevel={2} />
          <CardBody>
            <p className="text-ink-soft">
              업소 등록이나 정보 수정을 원하시면 문의해 주십시오. 게재를 원하지 않으시면 요청만으로
              바로 내려 드립니다. 납세자번호(TIN)를 비롯한 사업자 식별정보는{" "}
              <b>어떤 설정으로도 이 화면에 표시되지 않습니다.</b>
            </p>
            <p className="mt-3">
              <LinkButton href={ROUTES.help}>문의하기</LinkButton>
            </p>
          </CardBody>
        </Card>
      </Stack>
    </PageContainer>
  );
}
