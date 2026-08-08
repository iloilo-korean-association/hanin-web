import { CORPORATE_COUNTERPARTY_TYPES, type PayeePolicy } from "../validators/enums";

/**
 * 이름 대조·마스킹 — 이해상충 판정과 공개 회계 실명 가리기가 **둘 다** 이걸 쓴다.
 *
 * 원본: 02_노코드MVP/AppsScript/00_공통_유틸.gs 의 상충정규화_
 *       02_노코드MVP/AppsScript/11_웹앱_공개.gs 의 개인이름마스킹_ · 공개_수취인_ · 실명완전일치_ · 실명가리기_
 *       02_노코드MVP/AppsScript/13_웹앱_임원.gs 의 이름부분일치_
 *
 * ★ 정규화가 두 벌이면 느슨한 쪽이 통째로 우회로가 된다. 이 파일 하나만 쓴다.
 */

/**
 * 이름 대조 전용 정규화.
 *   ① NFKC — 전각을 반각으로, 분해된 한글 자모(NFD)를 완성형으로 합친다.
 *   ② **화이트리스트** — 영숫자·완성형 한글·가나·한자만 남기고 나머지를 전부 지운다.
 *   ③ 소문자화.
 *
 * 왜 화이트리스트인가 (이게 핵심이다):
 *   처음에는 "지울 부호 목록" 을 나열한 블랙리스트였다. 목록에 없는 표기로 전부 뚫렸다 —
 *   제로폭공백(U+200B, JS \s 에 안 잡힌다) · 제로폭비결합자 · 단어결합자 · 소프트하이픈,
 *   NFD 자모분리('오톤' 이 화면상 '오톤' 과 육안 구별이 안 된다),
 *   ASCII + ~ ` % = , 전각 －．，＿｜～ , 불릿 • ‧ , 【】〔〕［］ , 마이너스 − , 구두점 。
 *   **실측 37개 페이로드 중 28개가 통과했다.**
 *   블랙리스트는 새 기호가 나올 때마다 진다. 남길 것을 정하면 모르는 기호는 자동으로 걸러진다.
 *
 * ★ 결과가 빈 문자열이면 호출자는 "이해관계자 없음" 이 아니라 **"판정 불가"** 로 다뤄야 한다.
 *   (conflict.ts 의 evaluateConflict 가 그렇게 처리한다)
 */
export function conflictNormalize(s: unknown): string {
  let t = String(s ?? "");
  try {
    t = t.normalize("NFKC");
  } catch {
    /* 정규화를 못 해도 죽지 않는다 — 아래 화이트리스트가 여전히 대부분을 막는다 */
  }
  // 남기는 것: 숫자 · ASCII 문자 · 완성형 한글 · 히라가나 · 가타카나 · 한자
  return t.replace(/[^0-9a-zA-Z가-힣ぁ-ゖァ-ヺ一-鿿]/g, "").toLowerCase();
}

/**
 * 이름 두 개가 같은 대상을 가리키는가. 양쪽 다 conflictNormalize 를 거친 값이어야 한다.
 *
 * 부분일치를 허용하는 이유: '오톤' 과 '오톤 하드웨어' 는 같은 곳이다.
 * 이해상충 판정은 **과탐이 안전한 방향**이다 — 놓치면 임원이 자기 업체 건을 스스로 승인하지만,
 * 잘못 잡히면 견적을 한 장 더 받고 이사회를 한 번 더 거칠 뿐이다.
 *
 * 다만 짧은 쪽이 1글자면 곤란하다. 업소명에 'A' 나 '김' 이 한 글자로 등록되는 순간
 * 그 글자를 포함한 모든 거래가 이해관계자로 잡혀 경고가 무의미해진다.
 * → 부분일치는 **짧은 쪽이 2글자 이상일 때만**. 1글자는 완전일치만 인정한다.
 */
export function nameLooseMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

/** 개인 이름 마스킹. '김민준' → '김OO'. 1글자면 '○'. (원본 개인이름마스킹_) */
export function maskPersonName(name: unknown): string {
  const s = String(name ?? "").trim();
  if (!s) return "";
  if (s.length < 2) return "○";
  return s.charAt(0) + "O".repeat(s.length - 1);
}

/** 이메일 마스킹. 'treasurer@x.com' → 'tr***@x.com' */
export function maskEmail(e: unknown): string {
  const s = String(e ?? "").trim();
  const at = s.indexOf("@");
  if (at < 1) return s ? "***" : "";
  const head = s.slice(0, at);
  const keep = head.length <= 2 ? head.slice(0, 1) : head.slice(0, 2);
  return keep + "***" + s.slice(at);
}

/** 전화번호 마스킹. '+63 917 123 4567' → '***4567' */
export function maskPhone(p: unknown): string {
  const d = String(p ?? "").replace(/\D/g, "");
  if (d.length < 4) return d ? "***" : "";
  return "***" + d.slice(-4);
}

/** 전화 뒷 4자리 (중복검사 키). */
export function phoneLast4(p: unknown): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : d;
}

/**
 * 이름이 회원 실명 목록 중 하나와 **통째로** 같은가.
 *
 * ★ 공백만 지우는 느슨한 정규화를 쓰면 안 된다.
 *   상대방구분을 '업소' 로 찍고 수취인명을 '김민준.' 처럼 마침표 하나만 붙이면 이 안전망을 빠져나가
 *   회원 실명이 공개 장부에 영구 노출된다.
 *   (실측: '김민준.' '(김민준)' '김민준,' '김-민-준' '·김민준' '김민준*' 전부 노출됐다)
 *   → 이해상충 대조와 **같은 정규화**를 쓴다.
 */
export function isExactRealName(name: unknown, realNames: readonly string[]): boolean {
  if (!realNames.length) return false;
  const k = conflictNormalize(name);
  if (!k) return false;
  return realNames.some((n) => conflictNormalize(n) === k);
}

/**
 * 마스킹에 쓸 회원 실명 목록을 만든다.
 * 2~5글자만 쓴다 — 1글자는 아무 문장이나 걸리고, 6글자 이상은 한국 이름이 아닐 확률이 높다.
 * 긴 이름부터 지워야 '김민준' 을 '김민' 이 먼저 잡아먹지 않는다.
 * ★ 이 목록은 서버 안에서만 돌고 화면으로 절대 내보내지 않는다.
 */
export function buildRealNameList(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const s = String(raw ?? "").trim();
    if (s.length >= 2 && s.length <= 5 && !out.includes(s)) out.push(s);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * 적요·무효사유·지정용도에 섞인 회원 실명을 가린다.
 * ★ 한국어는 어절 경계가 없어 과잉 마스킹이 난다(회원 이름이 '이수' 면 '이수리' 도 걸린다).
 *   과잉은 안전한 방향의 오류다. 반대 방향(실명 노출)이 법 위반이라 이쪽을 택했다.
 */
export function maskRealNames(text: unknown, realNames: readonly string[]): string {
  let s = String(text ?? "");
  if (!s || !realNames.length) return s;
  for (const n of realNames) {
    if (!s.includes(n)) continue;
    s = s.split(n).join(maskPersonName(n));
  }
  return s;
}

/**
 * 지출 수취인의 공개 표기.
 *   업소/법인/공공/내부이체 → 상호 그대로 (상호는 개인정보가 아니다)
 *   회원/비회원/익명/미기재  → 정책에 따라 마스킹(기본) / 전체 / 숨김
 *
 * ★ 안전망: 상대방구분이 '업소/법인/공공' 으로 **잘못 찍혀 있어도**, 그 이름이 회원 실명과
 *   통째로 같으면 자연인으로 보고 마스킹한다.
 *   왜 필요한가 — 법인격 가지는 어떤 설정으로도 마스킹을 켤 수 없는 유일한 무조건 노출 경로였다.
 *   드롭다운을 한 칸 잘못 고르는 것만으로 회원 실명이 영구 공개된다(공개 회계는 캐시·인쇄·
 *   검색엔진에 그대로 퍼진다). 되돌릴 수 없는 사고라 설정으로 끌 수 없게 해 두었다.
 * ★ 완전일치만 본다. 부분일치로 하면 '김민수상사' 같은 정상 상호까지 뭉갠다.
 */
export function publicPayee(
  counterpartyType: string,
  name: string,
  policy: PayeePolicy,
  realNames: readonly string[],
): string {
  const g = String(counterpartyType ?? "").trim();
  const n = String(name ?? "").trim();
  if (!n) return "(미기재)";
  const isCorporate = (CORPORATE_COUNTERPARTY_TYPES as readonly string[]).includes(g);
  if (isCorporate) {
    // 안전망에 걸리면 부호를 지운 뒤 마스킹한다.
    // '김 민 준' 이나 '김-민-준' 을 그대로 마스킹하면 '김OOOO' 가 되어 글자 수까지 흘린다.
    return isExactRealName(n, realNames) ? maskPersonName(conflictNormalize(n) || n.replace(/\s+/g, "")) : n;
  }
  if (policy === "전체") return n;
  if (policy === "숨김") return `(${g || "개인"})`;
  return maskPersonName(n);
}

/**
 * "지분 40%" / "40% 보유" 같은 자유 텍스트에서 백분율만 뽑는다.
 * ★ 이제는 ConflictOfInterest.ownershipPct / Vendor.ownershipPct 정식 컬럼이 있다.
 *   이 함수는 **컬럼이 비었을 때의 폴백**일 뿐이다. 없으면 null 을 주고 지어내지 않는다.
 */
export function extractOwnershipPct(text: unknown): number | null {
  const m = /(\d{1,3}(?:\.\d+)?)\s*(?:%|퍼센트|프로)/.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}
