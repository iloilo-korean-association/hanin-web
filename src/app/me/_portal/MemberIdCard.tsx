import { cn, QrCode } from "@/components/ui";
import { formatPeriodDate, type MembershipPeriod } from "@/lib/domain/membershipPeriod";

import { CARD_LAYOUT, photoPlaceholderSvg, svgToDataUrl } from "./card-art";
import { cardNameFont, cardNumberFont } from "./card-fonts";

/**
 * 디지털 회원증 (P3).
 *
 * ── 크기 ────────────────────────────────────────────────────────────────
 *  화면에서는 폭에 맞춰 줄어들고, 인쇄하면 **실물 카드 규격(CR80 85.6×54mm)** 으로
 *  고정된다. 제휴 업소에 내미는 물건이라 지갑에 들어가야 하기 때문이다.
 *  치수 규칙은 globals.css 의 `[data-id-card]` 한 곳에 있다 —
 *  카드 안의 글자·사진·QR 은 전부 em 이라 그 한 줄(font-size)만 바뀌면 같이 커진다.
 *  바깥 틀 `[data-id-card-frame]` 이 컨테이너라, 틀의 max-width 만 바꾸면 카드가 통째로
 *  커진다(/me/card 에서는 400px, 포털에서는 342px).
 *
 * ── 모습: 대표가 준 디자인 그대로 (2026-11) ────────────────────────────
 *  바탕은 대표의 디자인 그림에서 가변 요소만 지운 **플레이트**(public/brand/card-plate.jpg,
 *  globals.css 가 background 로 깐다). 제목·엠블럼·라벨·아이콘·알약 테·QR 금테·"스캔하면
 *  진위 확인"·하단 안내문은 그 그림 안에 있어서 여기 DOM 에는 없다.
 *  DOM 에 있는 것은 **가변 요소 여섯 가지뿐** — 사진, 이름(+영문), 회원번호, 회원구분, 유효기간,
 *  QR — 이고 전부 절대 위치다. 자리(em)는 card-art.ts 의 CARD_LAYOUT 이 정본이고 PNG
 *  (card/image/card-image.tsx)도 같은 숫자로 그린다. 레이아웃을 바꾸면 그 파일도 같이 고친다.
 *  글꼴(대표 결정 2026-11-01): 이름 = 배민 을지로체, 회원번호·유효기간 = 나눔명조 Bold —
 *  PNG 가 fs 로 읽는 **같은 서브셋 TTF** 를 next/font/local 로 쓴다(card-fonts.ts). 어느 글꼴·어느 배율인지는
 *  card-art.ts 의 CARD_FONTS / CARD_LAYOUT(fontScale)이 정본이다. 회원구분 알약·영문 이름·"사진 없음" 은
 *  그대로 고딕(화면 = 시스템 고딕, PNG = Noto Sans KR Bold).
 *  ★ 이름 요소는 font-normal 이어야 한다 — 을지로체는 400 하나뿐이라 font-bold 를 주면 브라우저가
 *    가짜 볼드를 만들어 PNG 와 달라진다.
 *
 * ── 인쇄 잉크 ───────────────────────────────────────────────────────────
 *  바탕 그림을 **그대로 찍는다.** 이 프로젝트의 인쇄 원칙(흰 바탕·검정 글씨)은 결산·감사
 *  자료용이고, 회원증은 실물 신분증처럼 보여야 한다는 대표 결정(2026-10)에 따라 예외다.
 *  globals.css 의 인쇄 블록이 카드 범위에만 `print-color-adjust: exact` 를 걸어
 *  배경 그림·알약 흰 글씨를 보존하고, QR 과 사진은 원본 그대로 찍는다.
 *
 * ── 유효기간 칸 (대표 결정 2026-10-21) ──────────────────────────────────
 *  "유효연도 2026년" 대신 **회비 납부일부터 1년** 인 기간을 `2026.10.15 ~ 2027.10.14` 로 찍는다.
 *  기간은 판정 결과(verdict.period)를 받은 그대로다 — 여기서 날짜를 계산하지 않는다.
 *
 * ── 이 컴포넌트는 판정하지 않는다 ───────────────────────────────────────
 *  "발급해도 되는가" 는 domain/memberCard.ts 가 정하고, 호출 화면이 그 결과를 보고
 *  이 카드를 그릴지 말지 결정한다. 여기서 또 판정하면 두 규칙이 생긴다.
 */
export function MemberIdCard({
  name,
  /** 성명_영문(대문자). "" 이면 영문을 그리지 않는다 — 한글 이름만 보인다(대표 결정 2026-11-01) */
  nameEn,
  memberNo,
  memberType,
  /** 오늘 유효한 회원 기간 — evaluateMemberCard 의 verdict.period (유효할 때만 이 카드를 그린다) */
  period,
  /** 서명 URL(10분). 호출 화면이 본인 확인을 마친 뒤 만들어 넘긴 것이다 */
  photoViewUrl,
  /** QR 이 가리킬 절대 주소 — /verify/<난수토큰> */
  verifyUrl,
  /** 바깥 틀에 붙는 클래스. 폭(max-w-*)을 바꾸는 용도로만 쓴다 */
  className,
}: {
  name: string;
  nameEn: string;
  memberNo: string;
  memberType: string;
  period: MembershipPeriod;
  photoViewUrl: string;
  verifyUrl: string;
  className?: string;
}) {
  const L = CARD_LAYOUT;
  const em = (n: number): string => `${n}em`;
  // 글꼴별 보정 배율을 곱한 실제 글자 크기(em) — PNG(card-image.tsx)와 같은 식
  const nameFs = L.name.fontSize * L.name.fontScale;
  const memberNoFs = L.memberNo.fontSize * L.memberNo.fontScale;
  const periodFs = L.period.fontSize * L.period.fontScale;

  return (
    <div data-id-card-frame className={cn("w-full max-w-[342px]", className)}>
      <div
        data-id-card
        className="relative overflow-hidden text-card-ink shadow-[0_1.6em_3.2em_-1.6em_rgba(20,45,74,0.6)]"
        style={{ borderRadius: em(L.radius) }}
      >
        {/* ── 사진 (플레이트의 금테 안) ── */}
        {photoViewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 만료되는 서명 URL. next/image 최적화 캐시에 올리면 안 된다
          <img
            src={photoViewUrl}
            alt={`${name} 회원 사진`}
            className="absolute object-cover"
            style={{
              left: em(L.photo.left),
              top: em(L.photo.top),
              width: em(L.photo.width),
              height: em(L.photo.height),
              borderRadius: em(L.photo.radius),
            }}
          />
        ) : (
          <div
            className="absolute flex flex-col items-center justify-end overflow-hidden"
            style={{
              left: em(L.photo.left),
              top: em(L.photo.top),
              width: em(L.photo.width),
              height: em(L.photo.height),
              borderRadius: em(L.photo.radius),
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 인라인 데이터 URL. 최적화 대상이 아니다 */}
            <img
              src={svgToDataUrl(photoPlaceholderSvg())}
              alt=""
              className="absolute inset-0 block h-full w-full"
            />
            <span className="relative mb-[0.6em] text-[0.7em] leading-none font-semibold text-card-ink/55">
              사진 없음
            </span>
          </div>
        )}

        {/* ★ 자리(left/top)는 카드 em 으로 잡고, 글자 크기는 그 **안쪽** 요소에만 건다.
            같은 요소에 font-size 와 em 좌표를 함께 주면 좌표가 그 글자 크기 배로 틀어진다. */}

        {/* ── 이름 (+ 영문, 있을 때만). 둘 다 아래 정렬이라 영문이 있든 없든 한글 자리는 같다 ── */}
        <div
          className="absolute"
          style={{ left: em(L.name.left), top: em(L.name.top), maxWidth: em(L.name.maxWidth) }}
        >
          <p className="flex items-end leading-none whitespace-nowrap" style={{ fontSize: em(nameFs) }}>
            <span className="sr-only">성명 </span>
            {/* 한글 이름 — 을지로체. letter-spacing 은 이 요소의 em(= 실제 글자 크기) 기준 */}
            <span
              className={cn(cardNameFont.className, "shrink-0 font-normal")}
              style={{ letterSpacing: em(L.name.tracking) }}
            >
              {name}
            </span>
            {nameEn ? (
              <span
                className="min-w-0 truncate font-semibold tracking-[0.04em] text-card-ink/70"
                style={{
                  fontSize: `${L.nameEn.fontSize / nameFs}em`,
                  marginLeft: `${L.nameEn.gap / L.nameEn.fontSize}em`,
                }}
              >
                {nameEn}
              </span>
            ) : null}
          </p>
        </div>

        {/* ── 회원번호 (플레이트의 금테 알약 안) ── */}
        <div
          className="absolute flex items-center justify-center"
          style={{
            left: em(L.memberNo.left),
            top: em(L.memberNo.top),
            width: em(L.memberNo.width),
            height: em(L.memberNo.height),
          }}
        >
          <p
            className={cn(cardNumberFont.className, "leading-none font-bold whitespace-nowrap")}
            style={{ fontSize: em(memberNoFs), letterSpacing: em(L.memberNo.tracking) }}
          >
            <span className="sr-only">회원번호 </span>
            {memberNo}
          </p>
        </div>

        {/* ── 회원구분 (플레이트의 남색 알약 안, 흰 글자) ── */}
        <div
          className="absolute flex items-center justify-center"
          style={{
            left: em(L.memberType.left),
            top: em(L.memberType.top),
            width: em(L.memberType.width),
            height: em(L.memberType.height),
          }}
        >
          <p
            className="leading-none font-bold whitespace-nowrap text-white"
            style={{ fontSize: em(L.memberType.fontSize) }}
          >
            <span className="sr-only">회원구분 </span>
            {memberType}
          </p>
        </div>

        {/* ── 유효기간 ── */}
        <div className="absolute" style={{ left: em(L.period.left), top: em(L.period.top) }}>
          <p
            className={cn(cardNumberFont.className, "leading-none font-bold whitespace-nowrap")}
            style={{ fontSize: em(periodFs) }}
          >
            <span className="sr-only">유효기간 </span>
            {formatPeriodDate(period.validFrom)} ~ {formatPeriodDate(period.validUntil)}
          </p>
        </div>

        {/* ── QR (플레이트의 금테 흰 상자 안). 자체 흰 여백(quiet zone)을 갖는다 ── */}
        <div
          className="absolute"
          style={{ left: em(L.qr.left), top: em(L.qr.top), width: em(L.qr.size), height: em(L.qr.size) }}
        >
          <QrCode
            value={verifyUrl}
            label="회원증 진위 확인 페이지를 여는 QR 코드"
            className="h-full w-full"
          />
        </div>

        {/* 플레이트 그림 안의 안내문 — 스크린리더용 */}
        <p className="sr-only">
          회비 납부일부터 1년간 유효합니다. 진위는 QR 로 확인해 주십시오 — 화면 캡처는 확인
          근거가 되지 않습니다.
        </p>
      </div>
    </div>
  );
}
