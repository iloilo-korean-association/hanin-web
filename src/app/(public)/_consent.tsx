import { Alert } from "@/components/ui";

/**
 * 개인정보 수집·이용 동의서.
 *
 * ★ 원문은 `02_노코드MVP/구글폼/폼5종_문항정의.md` 의 "개인정보 수집·이용 동의서 전문"이다.
 *   법적 문구이므로 **문장을 고치지 않았다.** 아래 텍스트는 그 파일에서 그대로 옮긴 것이다.
 *
 * 대괄호 자리(`[총무 이메일을 여기에 적으세요]` 등)는 원문이 "여기에 채워 넣으라"고
 * 지시한 **빈칸**이다. 빈칸을 그대로 두면 동의서가 성립하지 않으므로 12_임원 테이블의
 * 실제 값으로 채운다. 문장 자체는 손대지 않았다.
 *
 * // [확인 필요] 제5항(처리 위탁 — Google LLC)은 구글 폼/스프레드시트 운영을 전제로 쓰였다.
 * //   이 웹 시스템으로 실제 전환할 때는 실제 수탁자·서버 소재지에 맞게 개정해야 한다.
 * //   프로토타입에서는 원문을 임의로 고치지 않고 화면에 경고를 함께 띄운다.
 */

export interface DpoContact {
  /** 총무 이메일 */
  treasurerEmail: string;
  /** 총무 연락처 */
  treasurerPhone: string;
  /** 감사 이메일 */
  auditorEmail: string;
}

function fullText(c: DpoContact): string {
  return `【개인정보 수집·이용 동의】

일로일로 한인회(이하 "한인회")는 회원 관리와 회계 투명성을 위해 아래와 같이
개인정보를 수집·이용합니다. 내용을 읽으신 뒤 동의 여부를 결정해 주십시오.

1. 수집·이용 목적
   ① 회원 자격 관리 및 회원 명부 유지
   ② 연회비 고지·수납·영수증 발행 및 미납 안내
   ③ 한인회 행사·공지·긴급 안전정보 전달
   ④ 회계 기록 보존과 감사(監査) 대응 — 누가 얼마를 냈는지에 대한 증빙
   ⑤ 영사 협조가 필요한 긴급 상황(사고·재해·수감 등)에서의 본인 확인

2. 수집하는 개인정보 항목
   [필수] 성명, 출생연도, 휴대전화번호, 이메일 주소, 거주 지역, 회원 구분
   [선택] 명부 공개 동의 여부, 알림 수신 동의 여부
   [자동 생성] 회원번호, 가입일시, 동의일시, 조회용 링크토큰
   ※ 주민등록번호, 여권번호, ACR I-Card 번호, 은행 계좌번호는 수집하지 않습니다.
   ※ 건강·종교·정치성향 등 민감정보(RA 10173상 sensitive personal information)는
      수집하지 않습니다. 다만 행사 신청 시 본인이 자발적으로 적으신 식이·알러지 정보는
      해당 행사 종료 후 즉시 파기합니다.

3. 보유 및 이용 기간
   ① 회원 정보: 회원 자격 유지 기간 + 탈퇴 후 1년
      (탈퇴 직후 삭제하지 않는 이유: 회비 정산·중복가입 방지·감사 대응)
   ② 회계 관련 기록(영수증, 수납 내역): 회계 처리 완료 후 5년
      (한인회 정관 및 회계 감사 관행에 따름. 이 기간에는 삭제 요청이 있어도
       회계 증빙으로서의 최소 정보는 보존될 수 있습니다.)
   ③ 알림 발송 기록: 3년
   기간이 지나면 지체 없이 파기합니다. 전자파일은 복구 불가능한 방법으로 삭제합니다.

4. 제3자 제공
   한인회는 회원의 개인정보를 제3자에게 판매·대여하지 않습니다.
   아래의 경우에 한해 최소한의 범위로 제공될 수 있습니다.
   ① 회원 본인이 별도로 동의한 경우
   ② 주필리핀 대한민국 대사관 또는 관할 영사관이 재외국민 보호 목적으로
      법령에 근거해 요청하는 경우 (사고·재해·실종 등 긴급상황)
   ③ 필리핀 또는 대한민국의 법령·수사기관의 적법한 요구가 있는 경우
   ②③의 경우에도 제공 사실을 회원에게 사후 통지하도록 노력합니다.

5. 처리 위탁 (Google LLC)
   본 시스템은 Google Workspace(구글 폼·스프레드시트·드라이브·Gmail)를 사용합니다.
   따라서 개인정보가 Google의 서버(대한민국 및 필리핀 국외 포함)에 저장됩니다.
   - 수탁자: Google LLC
   - 위탁 업무: 데이터 저장, 양식 접수, 이메일 발송
   - 국외 이전 국가: 미국 등 Google 데이터센터 소재국
   - 이전 항목·시점·방법: 위 2항의 항목이 폼 제출 즉시 인터넷을 통해 전송·저장

6. 공개되는 정보 / 공개되지 않는 정보
   한인회는 회계 투명성을 위해 공개 장부를 운영합니다. 그러나
   [공개하지 않음] 회원의 성명, 연락처, 이메일, 주소, 개인별 회비 납부 내역
   [공개함]       항목별·월별 수입 "합계", 모든 지출의 건별 내역(상대방 실명 제외),
                  계좌·기금 잔액, 공개에 동의한 기부자의 표기명
   즉, "누가 얼마를 냈는지"는 공개되지 않으며 "한인회가 얼마를 어디에 썼는지"는
   전부 공개됩니다.

7. 동의를 거부할 권리와 그에 따른 불이익
   귀하는 개인정보 수집·이용에 동의하지 않을 권리가 있습니다.
   다만 필수 항목에 동의하지 않으시면 회원 등록 자체가 불가능하여
   한인회 회원 자격 취득, 회비 납부·영수증 발급, 행사 참가 신청을 하실 수 없습니다.
   선택 항목(명부 공개, 알림 수신)에 동의하지 않으셔도 회원 자격에는
   아무런 불이익이 없습니다.

8. 정보주체의 권리
   귀하는 언제든지 아래 권리를 행사하실 수 있습니다.
   ① 열람 요구      ② 정정·삭제 요구   ③ 처리정지 요구
   ④ 동의 철회      ⑤ 손해 발생 시 구제 요구
   요청은 아래 연락처로 하시면 되며, 접수 후 10일 이내에 조치하고 결과를 알려드립니다.
   (단, 3-②의 회계 증빙 보존 의무가 있는 정보는 해당 기간 동안 삭제가 제한될 수 있으며,
    이 경우 그 사유를 서면으로 알려드립니다.)
   필리핀 National Privacy Commission(NPC) 또는 대한민국 개인정보보호위원회에
   민원을 제기하실 권리도 있습니다.

9. 개인정보 보호책임자
   직책: 한인회 총무
   이메일: ${c.treasurerEmail}
   연락처: ${c.treasurerPhone}
   감사(監査) 문의: ${c.auditorEmail}

10. 안전조치
   ① 원장(개인정보 포함)은 임원 3~5명만 편집할 수 있고 나머지는 접근 불가입니다.
   ② 공개 장부에는 개인정보 항목 자체가 물리적으로 존재하지 않습니다.
   ③ 모든 데이터 변경은 감사로그에 기록되며, 행 삭제 시도는 회장·감사에게 즉시 통보됩니다.
   ④ 매주 자동 무결성 검사가 실행되어 이상 징후를 감사에게 보고합니다.

시행일: 2026-01-01`;
}

const ENGLISH_SUMMARY = `【Privacy Notice — Iloilo Korean Association】

Purpose: membership administration, annual dues collection and receipting,
event and emergency notifications, and accounting records for audit.

Data collected: name, year of birth, mobile number, email, area of residence,
membership type. We do NOT collect government ID numbers, passport numbers,
ACR I-Card numbers, bank account numbers, or sensitive personal information
as defined under RA 10173.

Retention: membership data — while you are a member plus 1 year.
Accounting records — 5 years after the fiscal year closes.

Sharing: we never sell or rent your data. Disclosure occurs only with your
consent, upon a lawful request by Philippine or Korean authorities, or when
the Embassy/Consulate of the Republic of Korea requests it to protect a
national in an emergency.

Processor: Google LLC (Google Workspace). Your data is stored on Google
servers, which may be located outside the Philippines.

Publication: our public ledger discloses every expense item by item, but
never discloses which member paid what. Income is published only as
aggregated totals.

Your rights under RA 10173: access, correction, erasure or blocking,
objection, data portability, damages, and to lodge a complaint with the
National Privacy Commission (privacy.gov.ph).

Refusal: you may refuse. Without the required items we cannot register you
as a member. Optional items carry no penalty.`;

/** 원문 그대로 보여주는 블록. 줄바꿈·들여쓰기를 보존해야 해서 pre 를 쓴다. */
function LegalBlock({ text }: { text: string }) {
  return (
    <pre
      // pre 의 기본 monospace 는 한글 가독성이 나쁘다. 본문 글꼴을 그대로 상속시킨다.
      style={{ fontFamily: "inherit" }}
      className="max-h-[28rem] overflow-auto rounded-[var(--radius-field)] border border-line bg-surface-inset p-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft"
    >
      {text}
    </pre>
  );
}

/**
 * 전문 (F1 회원가입용). 기본은 접혀 있고 펼치면 원문이 그대로 나온다.
 * 접혀 있어도 제출 전에 반드시 읽을 수 있어야 하므로 동의 체크박스 **바로 위**에 둔다.
 */
export function PrivacyConsentFull({ contact }: { contact: DpoContact }) {
  return (
    <div className="flex flex-col gap-3">
      <details className="rounded-[var(--radius-card)] border border-line bg-surface">
        <summary className="flex min-h-touch cursor-pointer items-center px-4 font-semibold text-brand-800">
          개인정보 수집·이용 동의서 전문 보기 <span className="ml-2 text-sm font-normal text-ink-muted">(RA 10173 · PIPA)</span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-line-soft p-4">
          <LegalBlock text={fullText(contact)} />
          <details>
            <summary className="inline-flex min-h-touch cursor-pointer items-center text-sm font-semibold text-brand-700">
              English summary
            </summary>
            <div className="mt-2">
              <LegalBlock text={`${ENGLISH_SUMMARY}\n\nData Protection Officer: ${contact.treasurerEmail} / ${contact.treasurerPhone}\nEffective: 2026-01-01`} />
            </div>
          </details>
        </div>
      </details>

      <Alert tone="warn" title="[운영 전 확인] 동의서 제5항">
        <p className="text-sm">
          위 전문은 구글 폼·스프레드시트 운영을 전제로 작성된 원문입니다. 이 시스템으로 실제
          전환하실 때는 제5항(처리 위탁 — Google LLC)을 실제 수탁자와 서버 소재지에 맞게 개정해야
          합니다. 프로토타입에서는 법적 문구를 임의로 고치지 않고 원문 그대로 두었습니다.
        </p>
      </Alert>
    </div>
  );
}

/**
 * 요약본 (F4 기부 · F5 행사용).
 * 원문: 같은 파일의 "F4·F5용 짧은 동의 문구". `[총무 이메일]` 자리만 실제 값으로 채웠다.
 */
export function PrivacyConsentSummary({
  contact,
  purpose,
}: {
  contact: DpoContact;
  /** "기부금" 또는 "행사 참가" */
  purpose: "기부금" | "행사 참가";
}) {
  const text = `【개인정보 수집·이용 안내 (요약)】
· 목적: ${purpose} 접수·확인·감사 인사·회계 기록
· 항목: 성명, 연락처 또는 이메일, 금액
· 보유: 회계 처리 완료 후 5년 (회계 증빙 보존)
· 제3자 제공 없음. 저장은 Google Workspace(국외 서버 포함)에서 이루어집니다.
· 동의를 거부하실 수 있으며, 그 경우 접수가 불가합니다.
· 열람·정정·삭제 요청: ${contact.treasurerEmail}
· 전문은 회원가입 폼 또는 한인회 공개 장부의 '안내' 탭에서 보실 수 있습니다.
전체 내용을 확인하였으며 이에 동의합니다. (필수)`;

  return <LegalBlock text={text} />;
}
