import { QrCode } from "@/components/ui";
import { ORG_NAME, ORG_NAME_EN } from "@/lib/site";

/**
 * 디지털 회원증 (P3).
 *
 * ── 크기 ────────────────────────────────────────────────────────────────
 *  화면에서는 폭에 맞춰 줄어들고, 인쇄하면 **실물 카드 규격(CR80 85.6×54mm)** 으로
 *  고정된다. 제휴 업소에 내미는 물건이라 지갑에 들어가야 하기 때문이다.
 *  치수 규칙은 globals.css 의 `[data-id-card]` 한 곳에 있다 —
 *  카드 안의 글자·사진·QR 은 전부 em 이라 그 한 줄(font-size)만 바뀌면 같이 커진다.
 *
 * ── 인쇄 잉크 ───────────────────────────────────────────────────────────
 *  바탕을 칠하지 않는다. 이 프로젝트의 인쇄 원칙(흰 바탕·검정 글씨)을 따르고,
 *  배경색을 깐 카드는 프린터마다 회색으로 뭉개져 오히려 사진과 QR 을 먹는다.
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
}: {
  name: string;
  memberNo: string;
  memberType: string;
  fiscalYear: number;
  photoViewUrl: string;
  verifyUrl: string;
}) {
  return (
    <div
      data-id-card
      className="flex flex-col overflow-hidden rounded-[0.6em] border-[0.15em] border-brand-800 bg-white p-[0.8em] text-ink"
    >
      {/* ── 머리 ── */}
      <div className="flex items-baseline justify-between gap-[0.6em] border-b-[0.08em] border-brand-200 pb-[0.4em]">
        <span className="text-[1.15em] leading-none font-bold text-brand-800">{ORG_NAME}</span>
        <span className="text-[0.85em] leading-none font-semibold text-ink-muted">
          {ORG_NAME_EN}
        </span>
      </div>

      {/* ── 몸통 ── */}
      <div className="flex flex-1 gap-[0.8em] pt-[0.6em]">
        {photoViewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 만료되는 서명 URL. next/image 최적화 캐시에 올리면 안 된다
          <img
            src={photoViewUrl}
            alt={`${name} 회원 사진`}
            className="h-[11.3em] w-[8.5em] shrink-0 rounded-[0.2em] border-[0.08em] border-line object-cover"
          />
        ) : (
          <div className="flex h-[11.3em] w-[8.5em] shrink-0 items-center justify-center rounded-[0.2em] border-[0.08em] border-dashed border-line-strong text-[0.8em] text-ink-faint">
            사진 없음
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="min-w-0">
            <p className="text-[0.8em] leading-none font-semibold text-ink-muted">
              성명 <span className="font-normal">Name</span>
            </p>
            <p className="mt-[0.15em] truncate text-[2em] leading-tight font-bold">{name}</p>
          </div>

          <dl className="mt-[0.5em] grid grid-cols-[auto_1fr] gap-x-[0.6em] gap-y-[0.25em] text-[0.95em] leading-tight">
            <dt className="font-semibold text-ink-muted">회원번호</dt>
            <dd className="font-mono font-semibold tracking-wide">{memberNo}</dd>
            <dt className="font-semibold text-ink-muted">회원구분</dt>
            <dd className="font-semibold">{memberType}</dd>
            <dt className="font-semibold text-ink-muted">유효연도</dt>
            <dd className="font-semibold">{fiscalYear}년</dd>
          </dl>
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center gap-[0.25em]">
          <QrCode
            value={verifyUrl}
            label="회원증 진위 확인 페이지를 여는 QR 코드"
            className="w-[9.6em] h-[9.6em]"
          />
          <span className="text-[0.72em] leading-none font-semibold text-ink-muted">
            스캔하면 진위 확인
          </span>
        </div>
      </div>

      {/* ── 꼬리 ── */}
      <p className="mt-[0.4em] border-t-[0.08em] border-brand-200 pt-[0.35em] text-[0.72em] leading-tight text-ink-muted">
        이 회원증은 {fiscalYear}년 회비를 납부하신 회원에게 발급됩니다. 진위는 QR 로 확인해
        주십시오 — 화면 캡처는 확인 근거가 되지 않습니다.
      </p>
    </div>
  );
}
