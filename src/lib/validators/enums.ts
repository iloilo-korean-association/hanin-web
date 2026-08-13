import { z } from "zod";

/**
 * 열거값의 유일한 정본.
 *
 * Prisma 는 SQLite 에서 enum 을 지원하지 않는다. 그래서 DB 컬럼은 전부 String 이고
 * 허용값 검증은 **여기 모아 둔 zod 스키마**가 한다.
 * 화면·API·시드 어디서도 문자열 리터럴을 직접 쓰지 말고 이 파일에서 가져다 쓴다.
 *
 * 원본: 02_노코드MVP/시트스키마/원장_19탭_헤더.md 의 "타입/허용값" 열.
 */

/* ── 05_거래 ───────────────────────────────────────────────────────────── */

/** 방향 */
export const DIRECTIONS = ["IN", "OUT"] as const;
export const zDirection = z.enum(DIRECTIONS);
export type Direction = (typeof DIRECTIONS)[number];

/** 통화 */
export const CURRENCIES = ["PHP", "KRW", "USD"] as const;
export const zCurrency = z.enum(CURRENCIES);
export type Currency = (typeof CURRENCIES)[number];

/** 수단 */
export const PAY_METHODS = ["CASH", "GCASH", "MAYA", "BANK", "CARD_2C2P", "INKIND"] as const;
export const zPayMethod = z.enum(PAY_METHODS);
export type PayMethod = (typeof PAY_METHODS)[number];

/** 거래 상태 — DRAFT 는 공개 집계에 잡히지 않는다. */
export const TX_STATUSES = ["DRAFT", "POSTED", "VOIDED"] as const;
export const zTxStatus = z.enum(TX_STATUSES);
export type TxStatus = (typeof TX_STATUSES)[number];

/** 상대방구분 — 공개 파일에는 이 구분만 나간다. */
export const COUNTERPARTY_TYPES = [
  "회원",
  "비회원",
  "업소",
  "법인",
  "공공",
  "익명",
  "내부이체",
] as const;
export const zCounterpartyType = z.enum(COUNTERPARTY_TYPES);
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

/** 상호(법인격)로 보는 구분. 자연인이면 마스킹 대상이다. */
export const CORPORATE_COUNTERPARTY_TYPES: readonly CounterpartyType[] = [
  "업소",
  "법인",
  "공공",
  "내부이체",
];

/* ── 01_회원 ───────────────────────────────────────────────────────────── */

export const GENDERS = ["M", "F", "미기재"] as const;
export const zGender = z.enum(GENDERS);

export const HOUSEHOLD_ROLES = ["본인", "배우자", "자녀", "동거"] as const;
export const zHouseholdRole = z.enum(HOUSEHOLD_ROLES);

export const MEMBER_TYPES = ["정회원", "준회원", "명예", "법인"] as const;
export const zMemberType = z.enum(MEMBER_TYPES);

export const MEMBER_STATUSES = ["ACTIVE", "INACTIVE", "WITHDRAWN", "중복확인필요"] as const;
export const zMemberStatus = z.enum(MEMBER_STATUSES);

/** 회비등급 — Setting 의 '회비단가.<등급>' 키와 문자열이 일치해야 한다. */
export const DUES_GRADES = ["정회원", "준회원", "학생", "명예", "법인"] as const;
export const zDuesGrade = z.enum(DUES_GRADES);
export type DuesGrade = (typeof DUES_GRADES)[number];

/* ── 02_계좌 / 03_기금 / 04_과목 ───────────────────────────────────────── */

export const ACCOUNT_KINDS = ["CASH", "GCASH", "MAYA", "BANK"] as const;
export const zAccountKind = z.enum(ACCOUNT_KINDS);

export const ACTIVE_STATUSES = ["ACTIVE", "CLOSED"] as const;
export const zActiveStatus = z.enum(ACTIVE_STATUSES);

export const FUND_KINDS = ["일반", "지정", "적립"] as const;
export const zFundKind = z.enum(FUND_KINDS);
export type FundKind = (typeof FUND_KINDS)[number];

export const CATEGORY_MAJORS = ["수입", "지출"] as const;
export const zCategoryMajor = z.enum(CATEGORY_MAJORS);

/* ── 06_회비고지 ───────────────────────────────────────────────────────── */

export const DUES_STATUSES = ["미납", "부분납", "완납", "면제"] as const;
export const zDuesStatus = z.enum(DUES_STATUSES);
export type DuesStatus = (typeof DUES_STATUSES)[number];

/* ── 07_기부 / 08_기부사용 ─────────────────────────────────────────────── */

export const DONOR_TYPES = ["회원", "비회원", "법인", "익명"] as const;
export const zDonorType = z.enum(DONOR_TYPES);

export const DONATION_STATUSES = ["접수", "확인", "취소"] as const;
export const zDonationStatus = z.enum(DONATION_STATUSES);

export const DONATION_USE_STATUSES = ["계획", "집행", "취소"] as const;
export const zDonationUseStatus = z.enum(DONATION_USE_STATUSES);

/* ── 09_행사 / 10_행사신청 ─────────────────────────────────────────────── */

export const EVENT_KINDS = ["정기총회", "체육대회", "명절", "봉사", "기타"] as const;
export const zEventKind = z.enum(EVENT_KINDS);

export const EVENT_STATUSES = ["준비", "접수중", "마감", "완료", "취소"] as const;
export const zEventStatus = z.enum(EVENT_STATUSES);

export const ATTENDANCES = ["예정", "참석", "불참"] as const;
export const zAttendance = z.enum(ATTENDANCES);

export const SIGNUP_STATUSES = ["접수", "확정", "취소"] as const;
export const zSignupStatus = z.enum(SIGNUP_STATUSES);
export type SignupStatus = (typeof SIGNUP_STATUSES)[number];

/* ── [추가] 한인회 서비스 ──────────────────────────────────────────────── */

export const SERVICE_CATEGORIES = ["행정지원", "생활정착", "긴급지원", "교육문화", "기타"] as const;
export const zServiceCategory = z.enum(SERVICE_CATEGORIES);
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/** 공개 페이지(/services)에는 isPublic && '운영중' 만 나간다. */
export const SERVICE_STATUSES = ["운영중", "준비", "중단"] as const;
export const zServiceStatus = z.enum(SERVICE_STATUSES);
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/* ── [추가] 회원 사진 · 디지털 회원증 (P3) ─────────────────────────────── */

/**
 * 사진 검수 상태.
 * 올리면 '대기' → 총무가 '승인' 또는 '반려'(사유 필수).
 * 회원증은 '승인' + 당해연도 회비 납부일 때만 발급된다(domain/memberCard.ts).
 */
export const MEMBER_PHOTO_STATUSES = ["대기", "승인", "반려"] as const;
export const zMemberPhotoStatus = z.enum(MEMBER_PHOTO_STATUSES);
export type MemberPhotoStatus = (typeof MEMBER_PHOTO_STATUSES)[number];

/* ── 11_승인 ───────────────────────────────────────────────────────────── */

export const APPROVAL_KINDS = ["지출", "기금이체", "예산변경", "무효처리"] as const;
export const zApprovalKind = z.enum(APPROVAL_KINDS);

/** 1차·2차 결과. '불필요' 는 그 차수가 애초에 필요 없다는 뜻(전결 또는 1단계 건). */
export const APPROVAL_RESULTS = ["승인", "반려", "대기", "불필요"] as const;
export const zApprovalResult = z.enum(APPROVAL_RESULTS);
export type ApprovalResult = (typeof APPROVAL_RESULTS)[number];

export const APPROVAL_FINAL_STATUSES = ["대기", "승인", "반려", "집행완료"] as const;
export const zApprovalFinalStatus = z.enum(APPROVAL_FINAL_STATUSES);
export type ApprovalFinalStatus = (typeof APPROVAL_FINAL_STATUSES)[number];

/** 필요승인단계 0(전결) / 1 / 2 */
export const zRequiredStages = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type RequiredStages = 0 | 1 | 2;

/* ── 12_임원 ───────────────────────────────────────────────────────────── */

export const OFFICER_ROLES = ["회장", "부회장", "총무", "감사", "이사", "지역반장"] as const;
export const zOfficerRole = z.enum(OFFICER_ROLES);
export type OfficerRole = (typeof OFFICER_ROLES)[number];

/**
 * 임원 권한.
 *
 * 앞의 셋은 **돈을 다루는 권한**이고, 뒤의 넷은 **자료를 관리하는 권한**이다.
 * 둘을 섞지 않는 이유: 업소 목록을 고치는 사람과 돈을 승인하는 사람이
 * 반드시 같을 필요가 없고, 오히려 다른 편이 안전하다.
 */
export const PERMISSIONS = [
  // ── 돈 ──────────────────────────────────────────────
  "승인권", // 지출 승인·집행
  "조회권", // 임원 화면 열람 (감사는 이것만 가진다)
  "입력권", // 수납 기록·지출 요청

  // ── 자료 관리 ────────────────────────────────────────
  "업소관리", // 14_업소 등록·수정·비활성. 이해관계 여부와 지분율을 여기서 정한다
  "행사관리", // 09_행사 등록·수정·마감
  "서비스관리", // 한인회 서비스 안내 등록·수정. 공개 페이지(/services)에 그대로 나간다
  "연락처관리", // 긴급 연락처 등록·수정. 사람 목숨이 걸린 자료다
  "회원관리", // 회원 비밀번호 재설정(임시 비밀번호 발급). 메일 재설정 보류 기간의 수동 대체 경로다
  /**
   * ★ 메타 권한 — 다른 임원의 권한을 주고 뺏는다.
   *   이걸 가진 사람은 스스로에게 모든 권한을 줄 수 있으므로, 사실상 최상위다.
   *   그래서 두 가지를 강제한다:
   *     ① 자기 자신의 권한은 못 고친다 (스스로 승인한도를 올리는 것을 막는다)
   *     ② 모든 변경은 감사로그에 남는다
   */
  "임원관리",
] as const;
export const zPermission = z.enum(PERMISSIONS);
export type Permission = (typeof PERMISSIONS)[number];

/** 돈을 움직이는 권한. 화면 분류·설명에 쓴다. */
export const MONEY_PERMISSIONS = ["승인권", "조회권", "입력권"] as const;
/** 자료를 관리하는 권한. 관리자가 임원에게 위임할 수 있는 것들이다. */
export const ADMIN_PERMISSIONS = ["업소관리", "행사관리", "서비스관리", "연락처관리", "회원관리", "임원관리"] as const;

/** 권한별 한 줄 설명. 위임 화면에서 그대로 보여준다. */
export const PERMISSION_HELP: Record<Permission, string> = {
  승인권: "지출을 승인하고 장부에 집행 기록합니다. 승인한도 안에서만 가능합니다.",
  조회권: "임원 화면을 열람합니다. 이것만 있으면 읽기 전용(감사)입니다.",
  입력권: "수납을 기록하고 지출을 요청합니다.",
  업소관리: "업소 안내를 등록·수정합니다. 이해관계 여부와 지분율도 여기서 정합니다.",
  행사관리: "행사를 등록·수정하고 신청을 마감합니다.",
  서비스관리: "한인회 서비스 안내를 등록·수정합니다. 공개 페이지(/services)에 그대로 나갑니다.",
  연락처관리: "긴급 연락처를 등록·수정합니다. 출처와 검증등급을 반드시 남겨야 합니다.",
  회원관리:
    "회원 비밀번호를 재설정해 임시 비밀번호를 발급합니다. 임시 비밀번호는 화면에 한 번만 표시되며 모든 발급이 감사로그에 남습니다.",
  임원관리: "다른 임원의 권한과 승인한도를 바꿉니다. 본인 것은 못 바꿉니다.",
};

/**
 * 운영·설정용 계정의 직책. **실제 사람이 아니다.**
 *
 * 전 권한(승인권·조회권·입력권)을 가지므로 임원 화면은 전부 열리지만,
 * 다음 두 곳에서는 반드시 제외한다:
 *   ① 공개 임원 명단(/about) — 없는 사람을 한인회 임원이라고 공시하면 안 된다
 *   ② 긴급 대응 통보 라인 — 받는 사람이 없는 주소로 알림이 나가면
 *      "통보했다"는 기록만 남고 실제로는 아무도 못 받는다. 그게 가장 위험하다.
 *
 * 이 계정도 I4(현금 2인 확인)와 이해상충 회피의 예외가 아니다 —
 * 그 둘은 권한이 아니라 **신원**으로 판정하기 때문이다.
 */
export const SYSTEM_ADMIN_ROLE = "관리자";

/** 'ACTIVE'/'INACTIVE' — 회원·임원 공통 */
export const ON_OFF_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const zOnOffStatus = z.enum(ON_OFF_STATUSES);

/* ── 13_이해상충 / 14_업소 ─────────────────────────────────────────────── */

export const CONFLICT_COUNTERPARTY_TYPES = ["업소", "법인", "개인"] as const;
export const zConflictCounterpartyType = z.enum(CONFLICT_COUNTERPARTY_TYPES);

export const RELATION_TYPES = ["본인", "가족", "사업파트너", "지분보유", "기타"] as const;
export const zRelationType = z.enum(RELATION_TYPES);
export type RelationType = (typeof RELATION_TYPES)[number];

/* ── 15_알림로그 / 16_감사로그 ─────────────────────────────────────────── */

export const NOTIFY_KINDS = [
  "환영",
  "영수증",
  "독촉1",
  "독촉2",
  "독촉3",
  "감사장",
  "월결산",
  "경고",
  "무결성",
  "매직링크",
] as const;
export const zNotifyKind = z.enum(NOTIFY_KINDS);
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export const NOTIFY_RESULTS = ["SUCCESS", "FAIL", "SKIP", "DEFERRED"] as const;
export const zNotifyResult = z.enum(NOTIFY_RESULTS);

export const CHANGE_TYPES = ["EDIT", "INSERT", "DELETE_ATTEMPT", "SCRIPT", "OTHER"] as const;
export const zChangeType = z.enum(CHANGE_TYPES);
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const SEVERITIES = ["INFO", "WARN", "CRITICAL"] as const;
export const zSeverity = z.enum(SEVERITIES);
export type Severity = (typeof SEVERITIES)[number];

/* ── 17_현금실사 / 18_인수인계 / 99_대사 ───────────────────────────────── */

export const CASH_COUNT_STATUSES = ["정상", "차액발생", "조사중", "종결"] as const;
export const zCashCountStatus = z.enum(CASH_COUNT_STATUSES);

export const HANDOVER_KINDS = ["임원교체", "연도마감"] as const;
export const zHandoverKind = z.enum(HANDOVER_KINDS);

export const HANDOVER_STATUSES = ["진행", "완료", "이의"] as const;
export const zHandoverStatus = z.enum(HANDOVER_STATUSES);

export const MATCH_STATUSES = [
  "MATCHED",
  "UNMATCHED_EXT",
  "UNMATCHED_BOOK",
  "PARTIAL",
] as const;
export const zMatchStatus = z.enum(MATCH_STATUSES);

/* ── 회계연도 · 매직링크 ───────────────────────────────────────────────── */

export const FY_STATUSES = ["OPEN", "CLOSED"] as const;
export const zFyStatus = z.enum(FY_STATUSES);

/**
 * PASSWORD_RESET 은 P1 시점에는 **정의만** 있다 (휴면 준비).
 * Resend(실발송)·도메인이 보류라 재설정 메일을 보낼 수 없기 때문이다 —
 * 그동안은 총무가 임원 화면에서 임시 비밀번호를 수동 발급한다.
 * 키가 생기면 이 purpose 로 매직링크를 발급하는 재설정 흐름을 붙인다.
 */
export const MAGIC_PURPOSES = ["OFFICER_LOGIN", "MEMBER_LINK", "PASSWORD_RESET"] as const;
export const zMagicPurpose = z.enum(MAGIC_PURPOSES);
export type MagicPurpose = (typeof MAGIC_PURPOSES)[number];

/* ── [추가] 장부 임포트 (엑셀 → 웹 장부) ───────────────────────────────── */

/** 임포트 배치 상태. '반영됨' 은 행 반영이 끝나 배치를 닫았다는 뜻. */
export const IMPORT_BATCH_STATUSES = ["검토중", "반영됨", "폐기"] as const;
export const zImportBatchStatus = z.enum(IMPORT_BATCH_STATUSES);
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

/**
 * 임포트 행 상태.
 * 파서는 '정상'/'확인필요' 만 만든다. '제외'/'반영됨' 은 검토 화면(L3)에서 정해진다.
 * '확인필요' 는 날짜 누락·해석 불가·금액 없음 등 — 임의로 해석하지 않고 사람이 정한다.
 */
export const IMPORT_ROW_STATUSES = ["정상", "확인필요", "제외", "반영됨"] as const;
export const zImportRowStatus = z.enum(IMPORT_ROW_STATUSES);
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

/** 엑셀 블록 구분 — 어느 표에서 나온 행인가. */
export const IMPORT_BLOCK_TYPES = [
  "회비수입", // 연도 시트 좌측 A~E (원화 D / 페소 E)
  "지출", // 연도 시트 우측 G~J
  "후원수입", // 후원금 현금 블록 (2022 사무실 오픈 기부, 2024 족구·체육대회 등)
  "현물후원", // TV·쿠폰·물품 — method=INKIND, 평가액 없으면 확인필요
  "금부원수입", // '금부원 교민지원' 시트 수입 (한화 B~C / 페소 E~F)
  "금부원지출", // '금부원 교민지원' 시트 지출·지원 항목 — 지정기금 거래로 반영
] as const;
export const zImportBlockType = z.enum(IMPORT_BLOCK_TYPES);
export type ImportBlockType = (typeof IMPORT_BLOCK_TYPES)[number];

/**
 * 납부자 표기 판정 (L4).
 * '회원' 이면 memberNo 가 반드시 있고, '회원아님'(단체·오기재)이면 반드시 null 이다.
 * 두 경우 다 PayerAlias 행을 남긴다 — 남기지 않으면 "아직 안 봤다" 와 구분되지 않는다.
 */
export const PAYER_ALIAS_KINDS = ["회원", "회원아님"] as const;
export const zPayerAliasKind = z.enum(PAYER_ALIAS_KINDS);
export type PayerAliasKind = (typeof PAYER_ALIAS_KINDS)[number];

/* ── 공개 표기 정책 (00_설정 '공개.수취인_개인표기') ──────────────────── */

export const PAYEE_POLICIES = ["마스킹", "전체", "숨김"] as const;
export const zPayeePolicy = z.enum(PAYEE_POLICIES);
export type PayeePolicy = (typeof PAYEE_POLICIES)[number];
