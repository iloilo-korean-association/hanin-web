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
} from "@/components/ui";
import { prisma } from "@/lib/db";
import { ORG_NAME, ROUTES, absoluteUrl } from "@/lib/site";
import { SERVICE_CATEGORIES } from "@/lib/validators";

import { telHref } from "../_data/emergency";

export const metadata: Metadata = {
  title: "서비스",
  description:
    "일로일로 한인회가 제공하는 서비스 안내입니다. 행정지원·생활정착·긴급지원·교육문화 서비스를 분류별로 보실 수 있습니다.",
  alternates: { canonical: ROUTES.services },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: absoluteUrl(ROUTES.services),
    siteName: ORG_NAME,
    title: `서비스 · ${ORG_NAME}`,
    description: "한인회가 교민에게 제공하는 서비스. 신청 방법과 이용료까지 안내합니다.",
    // ★ 페이지에서 openGraph 를 정의하면 루트의 og:image 가 통째로 사라진다(다른 공개 페이지와 동일).
    //   기본 카드를 다시 가리킨다.
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${ORG_NAME} 서비스` }],
  },
};

/** 임원이 서비스 안내를 고치면 바로 반영돼야 한다. */
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  // ★ 공개 조건: isPublic && 운영중. 준비·중단 서비스는 공개 화면에 나가지 않는다.
  const services = await prisma.service.findMany({
    where: { isPublic: true, status: "운영중" },
    orderBy: [{ sortOrder: "asc" }, { serviceId: "asc" }],
  });

  // 분류는 enums 의 순서(행정지원 → 생활정착 → 긴급지원 → 교육문화 → 기타)대로 보여준다.
  const byCategory = SERVICE_CATEGORIES.map((category) => ({
    category,
    items: services.filter((s) => s.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <PageContainer>
      <PageHeader
        title="서비스"
        titleEn="Services"
        breadcrumb={[{ href: ROUTES.home, label: "홈" }]}
        description="한인회가 회원과 교민에게 제공하는 서비스입니다. 회비로 운영됩니다 — 쓰임새는 공개 회계에서 전부 보실 수 있습니다."
      />

      <Stack gap="md">
        <Alert tone="info" title="이용 안내">
          <p>
            대부분 무료이며, 비용이 드는 서비스는 금액을 미리 표시합니다. 신청·문의는 각 항목의
            안내를 따라 주시고, 급한 일이면 먼저{" "}
            <a className="link-ika" href={ROUTES.sos}>
              긴급 연락처
            </a>
            를 확인하십시오.
          </p>
        </Alert>

        {byCategory.length === 0 ? (
          <EmptyState
            icon="🤝"
            title="지금 운영 중인 서비스가 없습니다"
            description="서비스가 준비되면 이 자리에 올라옵니다. 필요한 것이 있으시면 문의해 주십시오."
            action={<LinkButton href={ROUTES.help}>문의하기</LinkButton>}
          />
        ) : (
          byCategory.map(({ category, items }) => (
            <section key={category} aria-labelledby={`svc-${category}`}>
              <h2 id={`svc-${category}`} className="mb-3 text-xl">
                {category}
                <span className="ml-2 text-base font-normal text-ink-muted">{items.length}건</span>
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {items.map((s) => (
                  <Card key={s.serviceId} as="article" className="h-full">
                    <CardHeader
                      headingLevel={3}
                      title={
                        <span className="flex flex-wrap items-center gap-2">
                          <span>{s.title}</span>
                          <Badge tone={s.fee > 0 ? "warn" : "success"}>
                            {s.fee > 0 ? formatPeso(s.fee) : "무료"}
                          </Badge>
                        </span>
                      }
                    />
                    <CardBody>
                      {s.description ? <p className="text-ink-soft">{s.description}</p> : null}
                      {s.howToApply ? (
                        <p className="mt-3 text-sm text-ink-soft">
                          <b className="text-ink">신청 방법</b> — {s.howToApply}
                        </p>
                      ) : null}
                      <div className="mt-3">
                        {s.contactName ? <StatLine label="담당" value={s.contactName} /> : null}
                        {s.contactPhone ? (
                          <StatLine
                            label="연락처"
                            value={
                              <a href={telHref(s.contactPhone)} className="link-ika tnum">
                                {s.contactPhone}
                              </a>
                            }
                          />
                        ) : null}
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </section>
          ))
        )}

        <Card as="section">
          <CardHeader title="여기 없는 도움이 필요하십니까" headingLevel={2} />
          <CardBody>
            <p className="text-ink-soft">
              목록에 없는 어려움도 문의해 주시면 함께 방법을 찾습니다. 서비스 제안도 환영합니다.
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
