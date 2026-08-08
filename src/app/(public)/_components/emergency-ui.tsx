import Link from "next/link";

import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { EMERGENCY_NUMBER, ROUTES } from "@/lib/site";

import { telHref, type Contact, type ContactGroup, type Grade } from "../_data/emergency";
import { Anchor } from "./anchor";

/**
 * 긴급 연락처 표시 컴포넌트 — 홈과 /sos 가 같은 것을 쓴다.
 *
 * ★ 번호는 전부 `tel:` 링크다. 모바일에서 한 번에 걸려야 한다.
 *   위급한 사람은 번호를 받아 적지 않는다. 누른다.
 * ★ 검증 등급을 숨기지 않는다. ◐ 는 "확인이 필요한 번호" 라고 그대로 쓴다.
 *   확실한 척하는 것보다 정직한 편이 안전하다.
 */

const GRADE_LABEL: Record<Grade, { text: string; title: string }> = {
  verified: { text: "확인됨", title: "공식 출처에서 확인한 번호입니다" },
  secondary: {
    text: "재확인 필요",
    title: "뉴스·디렉터리 등 2차 출처에서 얻은 번호입니다. 반기마다 재확인합니다",
  },
  pending: { text: "확인 중", title: "아직 확인하지 못했습니다. 번호를 지어내지 않습니다" },
};

export function GradeBadge({ grade }: { grade: Grade }) {
  const g = GRADE_LABEL[grade];
  const tone = grade === "verified" ? "success" : grade === "secondary" ? "warn" : "neutral";
  return (
    <Badge tone={tone} title={g.title}>
      {g.text}
    </Badge>
  );
}

/** 번호 목록. 첫 번호가 대표번호다. */
export function PhoneLinks({
  numbers,
  size = "md",
}: {
  numbers: readonly string[];
  size?: "md" | "lg";
}) {
  if (numbers.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        번호를 확인하는 중입니다. 확인되지 않은 번호는 적지 않습니다.
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {numbers.map((n) => (
        <li key={n}>
          <a
            href={telHref(n)}
            className={
              "inline-flex min-h-touch items-center rounded-[var(--radius-field)] border " +
              "border-brand-200 bg-brand-50 px-3 font-bold tnum text-brand-800 " +
              "hover:border-brand-400 hover:bg-brand-100 " +
              (size === "lg" ? "text-xl" : "text-base")
            }
          >
            {n}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** 연락처 한 건. 표가 아니라 카드 행으로 그린다 — 모바일에서 표는 읽히지 않는다. */
export function ContactRow({ item }: { item: Contact }) {
  return (
    <li
      className={
        "flex flex-col gap-2 border-b border-line-soft py-4 last:border-b-0 " +
        (item.emphasis ? "bg-warn-bg/40 -mx-4 px-4 sm:-mx-5 sm:px-5" : "")
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-bold">{item.name}</span>
        {item.nameEn ? <span className="text-sm text-ink-faint">{item.nameEn}</span> : null}
        <GradeBadge grade={item.grade} />
      </div>

      <PhoneLinks numbers={item.numbers} />

      {item.hours ? <p className="text-sm text-ink-muted">운영 시간 · {item.hours}</p> : null}
      {item.note ? <p className="text-sm text-ink-soft">{item.note}</p> : null}
      {item.email ? (
        <p className="text-sm text-ink-muted">
          이메일 ·{" "}
          <a href={`mailto:${item.email}`} className="link-ika">
            {item.email}
          </a>
        </p>
      ) : null}
      {item.address ? <p className="text-sm text-ink-muted">주소 · {item.address}</p> : null}
    </li>
  );
}

export function ContactGroupCard({ group }: { group: ContactGroup }) {
  return (
    <Anchor id={group.id}>
      <Card as="section">
        <CardHeader
          title={
            <>
              {group.title}
              <span className="ml-2 text-base font-normal text-ink-faint">{group.titleEn}</span>
            </>
          }
          description={group.description}
        />
        <CardBody>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <ContactRow key={item.name} item={item} />
            ))}
          </ul>
        </CardBody>
      </Card>
    </Anchor>
  );
}

/**
 * 911 배너 — 홈과 /sos 최상단에 같은 모양으로 나간다.
 *
 * ★ 117 은 2016-08-01 폐기됐다. 어떤 화면에도 쓰지 않는다.
 * ★ 한인회 핫라인은 아직 개통 전이다(설정 `웹앱.긴급핫라인` 이 비어 있음).
 *   받지도 않는 번호를 24시간 받는다고 쓰지 않는다.
 */
export function EmergencyBanner({
  hotline,
  compact,
}: {
  hotline: { number: string | null; ready: boolean };
  compact?: boolean;
}) {
  return (
    <section
      aria-labelledby="emergency-heading"
      className="rounded-[var(--radius-card)] border-2 border-danger-line bg-danger-bg px-4 py-5 sm:px-6"
    >
      <h2 id="emergency-heading" className="text-lg text-danger sm:text-xl">
        생명이 위험하면 한인회보다 먼저
      </h2>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <a
          href={telHref(EMERGENCY_NUMBER)}
          className={
            "inline-flex min-h-touch items-center justify-center rounded-[var(--radius-card)] " +
            "bg-danger px-6 py-3 text-4xl font-bold tracking-widest text-white " +
            "hover:brightness-95 sm:text-5xl"
          }
          aria-label={`필리핀 전국 긴급번호 ${EMERGENCY_NUMBER} 로 전화하기`}
        >
          {EMERGENCY_NUMBER}
        </a>
        <p className="text-ink-soft">
          <b>필리핀 전국 긴급번호</b> (경찰 · 소방 · 구급 / 무료)
          <br />
          <span className="text-sm">
            유선·무선 모두 무료입니다. 과거의 117은 2016년 8월 1일 폐지되어 911로 통합되었습니다.
          </span>
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <QuickCall
          label="주세부분관 야간 긴급"
          sub="사건·사고 전용"
          number="+63-917-808-3907"
        />
        <QuickCall label="영사콜센터 (24시간)" sub="통역·가족 연결" number="+82-2-3210-0404" />
        {hotline.ready && hotline.number ? (
          <QuickCall label="한인회 긴급 핫라인" sub="24시간 당번" number={hotline.number} />
        ) : (
          <div className="rounded-[var(--radius-field)] border border-line bg-surface px-3 py-2.5">
            <p className="text-sm font-semibold text-ink-muted">한인회 긴급 핫라인</p>
            <p className="font-bold text-ink-muted">개통 준비 중</p>
            <p className="text-xs text-ink-muted">
              지금 위급하면 {EMERGENCY_NUMBER}. 번호가 개통되면 이 자리에 표시됩니다.
            </p>
          </div>
        )}
      </div>

      {compact ? (
        <p className="mt-4">
          <Link href={ROUTES.sos} className="link-ika font-semibold">
            경찰 · 병원 · 공관 전체 연락처와 상황별 행동요령 보기 →
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function QuickCall({ label, sub, number }: { label: string; sub: string; number: string }) {
  return (
    <a
      href={telHref(number)}
      className={
        "flex min-h-touch flex-col justify-center rounded-[var(--radius-field)] border " +
        "border-line bg-surface px-3 py-2.5 hover:border-brand-300 hover:bg-brand-50"
      }
    >
      <span className="text-sm font-semibold text-ink-muted">{label}</span>
      <span className="font-bold tnum text-brand-800">{number}</span>
      <span className="text-xs text-ink-muted">{sub}</span>
    </a>
  );
}
