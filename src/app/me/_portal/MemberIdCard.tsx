import { cn, QrCode } from "@/components/ui";
import { ORG_NAME } from "@/lib/site";

import { CARD_ORG_NAME_EN, cardWatermarkSvg, EMBLEM_PUBLIC_PATH, svgToDataUrl } from "./card-art";

/**
 * 디지털 회원증 (P3).
 *
 * ── 크기 ────────────────────────────────────────────────────────────────
 *  화면에서는 폭에 맞춰 줄어들고, 인쇄하면 **실물 카드 규격(CR80 85.6×54mm)** 으로
 *  고정된다. 제휴 업소에 내미는 물건이라 지갑에 들어가야 하기 때문이다.
 *  치수 규칙은 globals.css 의 `[data-id-card]` 한 곳에 있다 —
 *  카드 안의 글자·사진·QR·엠블럼은 전부 em 이라 그 한 줄(font-size)만 바뀌면 같이 커진다.
 *  바깥 틀 `[data-id-card-frame]` 이 컨테이너라, 틀의 max-width 만 바꾸면 카드가 통째로
 *  커진다(/me/card 에서는 400px, 포털에서는 342px).
 *
 * ── 인쇄 잉크 ───────────────────────────────────────────────────────────
 *  남색 바탕을 **그대로 찍는다.** 이 프로젝트의 인쇄 원칙(흰 바탕·검정 글씨)은 결산·감사
 *  자료용이고, 회원증은 실물 신분증처럼 보여야 한다는 대표 결정(2026-10)에 따라 예외다.
 *  globals.css 의 인쇄 블록이 카드 범위에만 `print-color-adjust: exact` 를 걸어
 *  바탕·흰 글씨·금색 선을 보존하고, QR 과 사진은 원본 그대로 찍는다.
 *  (브라우저 인쇄 설정의 "배경 그래픽" 을 꺼도 이 속성이 있으면 바탕이 나온다.)
 *
 * ── 엠블럼·장식 ────────────────────────────────────────────────────────
 *  머리의 엠블럼은 한인회 공식 로고(public/brand/logo-emblem.svg — 글자까지 path 로 그린
 *  벡터)라 어떤 크기에서도 선명하다. 흰 원판이 남색 위에 떠 보이도록 금색 링을 두른다.
 *  바탕 장식(엠블럼의 태극 곡선을 키운 워터마크)은 card-art.ts 의 SVG 한 장이고,
 *  `[data-id-card-art]` 한 겹에만 깔린다. 정보 요소 위에 아무것도 덧칠하지 않는다 —
 *  특히 QR 위에 반투명한 것이 겹치면 스캔이 깨진다.
 *  PNG(card/image/card-image.tsx)는 **같은 파일·같은 문자열**로 그린다. 레이아웃을 바꾸면
 *  그 파일도 같이 고친다.
 *
 * ── 이 컴포넌트는 판정하지 않는다 ───────────────────────────────────────
 *  "발급해도 되는가" 는 domain/memberCard.ts 가 정하고, 호출 화면이 그 결과를 보고
 *  이 카드를 그릴지 말지 결정한다. 여기서 또 판정하면 두 규칙이 생긴다.
 */
export function MemberIdCard({
  name,
  memberNo,
  memberType,
  fiscalYear,
  /** 서명 URL(10분). 호출 화면이 본인 확인을 마친 뒤 만들어 넘긴 것이다 */
  photoViewUrl,
  /** QR 이 가리킬 절대 주소 — /verify/<난수토큰> */
  verifyUrl,
  /** 바깥 틀에 붙는 클래스. 폭(max-w-*)을 바꾸는 용도로만 쓴다 */
  className,
}: {
  name: string;
  memberNo: string;
  memberType: string;
  fiscalYear: number;
  photoViewUrl: string;
  verifyUrl: string;
  className?: string;
}) {
  return (
    <div data-id-card-frame className={cn("w-full max-w-[342px]", className)}>
      <div
        data-id-card
        className="relative flex flex-col overflow-hidden rounded-[1.2em] px-[1.2em] pt-[0.9em] pb-[0.8em] text-white shadow-[0_1.6em_3.2em_-1.6em_rgba(20,45,74,0.6)]"
      >
        {/* ── 바탕 장식 (정보 요소 아래 한 겹) ── */}
        <div aria-hidden="true" data-id-card-art className="pointer-events-none absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- 인라인 데이터 URL. 최적화 대상이 아니다 */}
          <img src={svgToDataUrl(cardWatermarkSvg())} alt="" className="block h-full w-full" />
        </div>

        {/* ── 머리: 엠블럼 + 워드마크 | 카드 종류 ── */}
        <div className="relative flex items-center justify-between gap-[0.8em]">
          <div className="flex min-w-0 items-center gap-[0.7em]">
            <div className="shrink-0 rounded-full border-[0.14em] border-accent-300 bg-white shadow-[0_0.3em_0.9em_rgba(0,0,0,0.35)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- 정적 SVG. 벡터라 next/image 가 할 일이 없다 */}
              <img
                src={EMBLEM_PUBLIC_PATH}
                alt=""
                className="block h-[4.3em] w-[4.3em] rounded-full"
              />
            </div>
            <div className="min-w-0 leading-none">
              <p className="truncate text-[1.2em] font-bold tracking-[-0.01em]">{ORG_NAME}</p>
              <p className="mt-[0.35em] truncate text-[0.5em] font-semibold tracking-[0.12em] text-white/70 uppercase">
                {CARD_ORG_NAME_EN}
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right leading-none">
            <p className="text-[0.85em] font-semibold">회원증</p>
            <p className="mt-[0.35em] text-[0.55em] font-semibold tracking-[0.18em] text-accent-300 uppercase">
              Membership Card
            </p>
          </div>
        </div>

        {/* 금색 머리선 */}
        <div
          aria-hidden="true"
          className="relative mt-[0.55em] h-[0.1em] bg-gradient-to-r from-accent-300 via-accent-300/70 to-transparent"
        />

        {/* ── 몸통 ── */}
        <div className="relative flex flex-1 items-center gap-[1em] pt-[0.65em]">
          {photoViewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 만료되는 서명 URL. next/image 최적화 캐시에 올리면 안 된다
            <img
              src={photoViewUrl}
              alt={`${name} 회원 사진`}
              className="h-[10.6em] w-[7.95em] shrink-0 rounded-[0.55em] border-[0.14em] border-accent-300 object-cover"
            />
          ) : (
            <div className="flex h-[10.6em] w-[7.95em] shrink-0 items-center justify-center rounded-[0.55em] border-[0.12em] border-dashed border-white/35 bg-white/5 text-[0.8em] text-white/60">
              사진 없음
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col self-stretch justify-between py-[0.2em]">
            <div className="min-w-0">
              <p className="text-[0.62em] leading-none font-semibold tracking-[0.08em] text-white/60">
                성명 · NAME
              </p>
              <p className="mt-[0.25em] truncate text-[2.1em] leading-[1.15] font-bold tracking-[-0.02em]">
                {name}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-[1em] gap-y-[0.5em] leading-none">
              <div className="col-span-2 min-w-0">
                <dt className="text-[0.62em] font-semibold tracking-[0.08em] text-white/60">
                  회원번호 · NO.
                </dt>
                <dd className="mt-[0.3em] truncate font-mono text-[1.15em] font-semibold tracking-[0.12em] text-accent-200">
                  {memberNo}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[0.62em] font-semibold tracking-[0.08em] text-white/60">회원구분</dt>
                <dd className="mt-[0.3em] truncate text-[1em] font-semibold">{memberType}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[0.62em] font-semibold tracking-[0.08em] text-white/60">유효연도</dt>
                <dd className="mt-[0.3em] truncate text-[1em] font-semibold">{fiscalYear}년</dd>
              </div>
            </dl>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-[0.35em]">
            {/* QR 은 자체 흰 바탕을 갖지만, 남색 위에서 경계가 또렷하도록 흰 상자에 한 번 더 담는다 */}
            <div className="rounded-[0.5em] bg-white p-[0.3em]">
              <QrCode
                value={verifyUrl}
                label="회원증 진위 확인 페이지를 여는 QR 코드"
                className="h-[8.6em] w-[8.6em]"
              />
            </div>
            <span className="text-[0.68em] leading-none font-semibold text-white/75">
              스캔하면 진위 확인
            </span>
          </div>
        </div>

        {/* ── 꼬리 ── */}
        <p className="relative mt-[0.6em] border-t-[0.08em] border-white/15 pt-[0.4em] text-[0.68em] leading-[1.3] text-white/65">
          이 회원증은 {fiscalYear}년 회비를 납부하신 회원에게 발급됩니다. 진위는 QR 로 확인해
          주십시오 — 화면 캡처는 확인 근거가 되지 않습니다.
        </p>
      </div>
    </div>
  );
}
