"use server";

import { revalidatePath } from "next/cache";

import { prisma, type Tx } from "@/lib/db";
import {
  addDays,
  cfgNum,
  cfgStr,
  duesTableFrom,
  fiscalYearOf,
  formatMoney,
  loadSettings,
  newLinkToken,
  memberLinkPath,
  phoneLast4,
  todayManila,
  FALLBACK_TEMPLATES,
  PUBLIC_LEDGER_PATH,
  renderFromSettings,
} from "@/lib/domain";
import { hashPassword } from "@/lib/auth";
import { queueMail } from "@/lib/mail";
import { absoluteUrl, ROUTES } from "@/lib/site";
import { joinInputSchema, joinPasswordSchema } from "@/lib/validators";

import {
  boolOf,
  fail,
  idempotencyKey,
  textOf,
  zodFieldErrors,
  zodSummary,
  type FormResult,
} from "../_shared";
import { JOIN_GRADES, memberTypeOf, type JoinGrade } from "./constants";

/**
 * /join — 가입 신청 서버 액션.
 *
 * 하는 일 (전부 서버에서, 하나의 트랜잭션 안에서)
 *   ① zod 재검증 (클라이언트 검증은 신뢰하지 않는다)
 *   ② 이중 제출 차단 — 01_회원.폼응답ID 를 멱등 키로 쓴다
 *   ③ 중복 회원 검사 — 성명 + 출생연도 + 연락처 뒷4자리
 *   ④ 회원번호 결번 없이 채번 (M0001 …)
 *   ⑤ 06_회비고지 자동 생성 (회비단가표 × 회비등급)
 *   ⑥ 환영 메일을 발송함에 기록 — 실제로 보내지 않는다(/dev/outbox 에서 확인)
 *
 * ★ 여권번호·ACR I-Card·주민등록번호는 받지 않는다. 폼에 칸 자체가 없다.
 */

export interface JoinOk {
  memberNo: string;
  name: string;
  linkToken: string;
  /** 본인 전용 조회 링크 (/me/XXXXXXXX) */
  linkPath: string;
  fiscalYear: number;
  duesGrade: string;
  billedAmount: number;
  billedOn: string;
  dueOn: string;
  /** 환영 메일을 발송함에 넣었는가 (알림 미동의면 false) */
  mailQueued: boolean;
  mailTo: string;
  /** 새로고침·재전송으로 같은 신청이 다시 들어와 기존 결과를 돌려준 경우 */
  resubmitted: boolean;
}

export type JoinState = FormResult<JoinOk>;

export async function submitJoin(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const formToken = textOf(formData, "formToken");
  if (!formToken) {
    return fail(
      "신청서 정보가 유실되었습니다.",
      "페이지를 새로고침(F5)한 뒤 처음부터 다시 작성해 주십시오. 작성하신 내용은 저장되지 않았습니다.",
    );
  }

  const settings = await loadSettings(prisma);
  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");

  /* ① 이중 제출 — 같은 신청서를 두 번 받으면 첫 결과를 그대로 돌려준다. */
  const already = await prisma.member.findFirst({
    where: { formResponseId: idempotencyKey(formToken) },
    select: { memberNo: true, name: true, linkToken: true, email: true, duesGrade: true, notifyConsent: true },
  });
  if (already) {
    const inv = await prisma.duesInvoice.findFirst({
      where: { memberNo: already.memberNo },
      orderBy: { fiscalYear: "desc" },
    });
    return {
      status: "ok",
      memberNo: already.memberNo,
      name: already.name,
      linkToken: already.linkToken,
      linkPath: memberLinkPath(already.linkToken),
      fiscalYear: inv?.fiscalYear ?? fiscalYearOf(todayManila()),
      duesGrade: already.duesGrade,
      billedAmount: inv?.billedAmount ?? 0,
      billedOn: inv?.billedOn ?? todayManila(),
      dueOn: inv?.dueOn ?? todayManila(),
      mailQueued: already.notifyConsent,
      mailTo: already.email,
      resubmitted: true,
    };
  }

  /* ② 회원 구분 화이트리스트 — 폼을 직접 POST 해서 '명예' 를 넣는 것을 막는다. */
  const gradeRaw = textOf(formData, "duesGrade");
  if (!(JOIN_GRADES as readonly string[]).includes(gradeRaw)) {
    return fail("회원 구분을 골라 주십시오.", null, { duesGrade: "목록에서 하나를 골라 주십시오." });
  }
  const grade = gradeRaw as JoinGrade;

  /* ③ zod 재검증. 개인정보 동의(privacyConsent)는 스키마가 literal(true) 로 강제한다. */
  const birthYearRaw = textOf(formData, "birthYear");
  const parsed = joinInputSchema.safeParse({
    name: textOf(formData, "name"),
    nameEn: textOf(formData, "nameEn"),
    birthYear: birthYearRaw === "" ? undefined : birthYearRaw,
    gender: textOf(formData, "gender") || "미기재",
    phone: textOf(formData, "phone"),
    email: textOf(formData, "email"),
    region: textOf(formData, "region"),
    householdRole: textOf(formData, "householdRole") || "본인",
    memberType: memberTypeOf(grade),
    duesGrade: grade,
    rosterConsent: boolOf(formData, "rosterConsent"),
    notifyConsent: boolOf(formData, "notifyConsent"),
    privacyConsent: boolOf(formData, "privacyConsent"),
    note: textOf(formData, "note"),
  });

  if (!parsed.success) {
    return fail(zodSummary(parsed.error), "빨간 글씨가 붙은 칸을 고쳐 주십시오.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  /* ③-1 비밀번호 (P1) — 가입 즉시 회원번호(아이디)+비밀번호 로그인이 가능해야 한다.
     joinInputSchema 와 별도로 parse 한다: 비밀번호 평문이 input 객체에 섞여
     로그·직렬화 경로로 새는 것을 막기 위해서다. */
  const pwParsed = joinPasswordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    passwordConfirm: String(formData.get("passwordConfirm") ?? ""),
  });
  if (!pwParsed.success) {
    return fail(zodSummary(pwParsed.error), "빨간 글씨가 붙은 칸을 고쳐 주십시오.", zodFieldErrors(pwParsed.error));
  }
  // 해시는 트랜잭션 밖에서 미리 만든다 — bcrypt 는 느려서 트랜잭션을 붙잡으면 안 된다.
  const passwordHash = await hashPassword(pwParsed.data.password);

  // 출생연도는 중복 검사 키다. 스키마에서는 선택이지만 가입 폼에서는 받는다.
  if (input.birthYear === undefined) {
    return fail("출생연도를 적어 주십시오.", "중복 가입을 막는 데 쓰입니다. 예: 1968", {
      birthYear: "태어난 해 4자리를 적어 주십시오. 예: 1968",
    });
  }
  const birthYear = input.birthYear;
  const last4 = phoneLast4(input.phone);
  if (!last4 || last4.length < 4) {
    return fail("연락처를 확인해 주십시오.", "숫자가 최소 4자리는 있어야 합니다. 예: 0917 123 4567", {
      phone: "숫자로 적어 주십시오. 예: 0917 123 4567",
    });
  }

  /* ④ 접수 폭주 차단 (00_설정 웹앱.제한.가입_시간당) */
  const hourlyLimit = cfgNum(settings, "웹앱.제한.가입_시간당", 30);
  const recent = await prisma.member.count({
    where: { createdAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  if (recent >= hourlyLimit) {
    return fail(
      "지금은 가입 신청이 몰려 접수를 잠시 멈췄습니다.",
      `한 시간에 ${hourlyLimit}건까지만 받도록 설정돼 있습니다. 잠시 뒤 다시 시도해 주시거나 총무(${contactEmail || "한인회"})에게 연락해 주십시오.`,
    );
  }

  /* ⑤ 중복 회원 — 성명 + 출생연도 + 연락처 뒷4자리 */
  const dup = await prisma.member.findFirst({
    where: {
      name: input.name,
      birthYear,
      phoneLast4: last4,
      status: { not: "WITHDRAWN" },
    },
    select: { memberNo: true },
  });
  if (dup) {
    // 회원번호·링크토큰은 알려주지 않는다. 이름·출생연도·번호 뒷자리만 맞히면
    // 남의 조회 링크를 받아갈 수 있게 되기 때문이다.
    return fail(
      "이미 등록된 회원 정보와 일치합니다.",
      `성명·출생연도·연락처 뒷 4자리가 같은 회원이 이미 있습니다. 본인이시라면 새로 가입하실 필요가 없습니다. ` +
        `조회 링크를 잃어버리셨다면 총무(${contactEmail || "한인회"})에게 재발송을 요청해 주십시오.`,
      { name: "이미 등록된 회원입니다." },
    );
  }

  /* ⑥ 회비 계산 — 00_설정 회비단가표. 신규 가입 일할계산은 하지 않는다(회비.신규가입_일할계산=N). */
  const fiscalYear = cfgNum(settings, "회계연도", fiscalYearOf(todayManila()));
  const duesTable = duesTableFrom(settings);
  const billedAmount = duesTable[input.duesGrade] ?? 0;
  const today = todayManila();
  const configuredDue = cfgStr(settings, "회비.납기일", `${fiscalYear}-02-28`);
  // 연중 가입자에게 이미 지난 납기일을 찍어 두면 그 자리에서 '미납' 이 된다.
  // 설정 납기일이 지났으면 가입일 + 30일을 납기로 준다.
  const dueOn = configuredDue > today ? configuredDue : addDays(today, 30);
  const duesStatus = billedAmount === 0 ? "면제" : "미납";

  /* ⑦ 저장 — 회원번호 채번과 고지 생성을 한 트랜잭션으로 묶는다. */
  let created: { memberNo: string; linkToken: string; invoiceId: string };
  try {
    created = await prisma.$transaction(async (tx: Tx) => {
      const memberNo = await nextMemberNo(tx);
      const linkToken = await freshLinkToken(tx);
      const invoiceId = await nextInvoiceId(tx, fiscalYear);
      const now = new Date();

      await tx.member.create({
        data: {
          memberNo,
          name: input.name,
          nameEn: input.nameEn,
          birthYear,
          gender: input.gender,
          phone: input.phone,
          phoneLast4: last4,
          email: input.email,
          region: input.region,
          districtTeam: "",
          householdRole: input.householdRole,
          joinedOn: today,
          memberType: input.memberType,
          status: "ACTIVE",
          duesGrade: input.duesGrade,
          rosterConsent: input.rosterConsent,
          notifyConsent: input.notifyConsent,
          // 동의 시각을 남기는 것이 RA 10173 / PIPA 상 동의의 증거다.
          privacyConsentAt: now,
          linkToken,
          note: input.note,
          createdBy: "WEB",
          createdAt: now,
          formResponseId: idempotencyKey(formToken),
        },
      });

      await tx.duesInvoice.create({
        data: {
          invoiceId,
          fiscalYear,
          memberNo,
          memberName: input.name,
          duesGrade: input.duesGrade,
          billedAmount,
          currency: "PHP",
          billedOn: today,
          dueOn,
          paidAmount: 0,
          unpaidAmount: billedAmount,
          status: duesStatus,
          exemptReason: billedAmount === 0 ? "회비 단가 0원 등급" : "",
          note: "웹 가입 신청 시 자동 생성",
        },
      });

      // P1: 가입 트랜잭션 안에서 비밀번호까지 함께 만든다.
      // 회원은 생겼는데 비밀번호가 없는 어정쩡한 상태를 만들지 않는다.
      await tx.memberCredential.create({
        data: { memberNo, passwordHash, mustChange: false, updatedBy: "WEB" },
      });

      return { memberNo, linkToken, invoiceId };
    });
  } catch (e) {
    // 동시에 두 명이 같은 번호를 잡으면 PK 충돌로 여기 온다 — 저장은 되지 않았다.
    console.error("[join] 저장 실패", e);
    return fail(
      "가입 신청을 저장하지 못했습니다.",
      "잠시 후 다시 시도해 주십시오. 계속 같은 화면이 나오면 총무에게 알려 주십시오. (같은 신청이 두 번 저장되지는 않습니다)",
    );
  }

  /* ⑧ 환영 메일 — 실제 발송이 아니라 발송함(OutboxMail)에 기록한다.
       알림 수신에 동의하지 않으셨으면 보내지 않는다(F1 문항 8의 약속). */
  let mailQueued = false;
  if (input.notifyConsent && input.email) {
    const { subject, bodyHtml } = renderFromSettings(
      settings,
      "환영",
      {
        성명: input.name,
        회원번호: created.memberNo,
        회계연도: fiscalYear,
        고지금액: formatMoney(billedAmount),
        납기일: dueOn,
        // 메일 본문의 링크는 반드시 절대주소여야 한다. 메일 클라이언트에는
        // "현재 사이트" 가 없어서 /ledger 같은 상대경로는 눌리지 않는 죽은 링크가 된다.
        공개장부URL: absoluteUrl(PUBLIC_LEDGER_PATH),
        // P1: 회원번호(아이디)+비밀번호 로그인 안내 (FALLBACK_TEMPLATES.환영 참조)
        로그인URL: absoluteUrl(ROUTES.login),
      },
      FALLBACK_TEMPLATES.환영,
    );
    try {
      await queueMail({
        kind: "환영",
        toEmail: input.email,
        toName: input.name,
        subject,
        bodyHtml,
        linkPath: memberLinkPath(created.linkToken),
        memberNo: created.memberNo,
        relatedId: created.invoiceId,
        trigger: "submitJoin",
      });
      mailQueued = true;
    } catch (e) {
      // 메일이 안 들어가도 가입 자체는 성립한다. 조용히 삼키지 말고 로그는 남긴다.
      console.error("[join] 환영 메일 기록 실패", e);
    }
  }

  revalidatePath("/dev/outbox");

  return {
    status: "ok",
    memberNo: created.memberNo,
    name: input.name,
    linkToken: created.linkToken,
    linkPath: memberLinkPath(created.linkToken),
    fiscalYear,
    duesGrade: input.duesGrade,
    billedAmount,
    billedOn: today,
    dueOn,
    mailQueued,
    mailTo: input.email,
    resubmitted: false,
  };
}

/* ═══════════════════════ 채번 (전부 트랜잭션 안에서) ═══════════════════════ */

/**
 * 회원번호 M0001 … 결번 없는 순번.
 *
 * 문자열 최대값이 아니라 **숫자로** 최대값을 찾는다. M9999 다음에 M10000 이 생기면
 * 문자열 정렬에서 'M10000' < 'M9999' 가 되어 번호가 되감기기 때문이다.
 * 회원 수가 수백 명 규모라 전체를 읽어도 비용이 무시할 만하다.
 *
 * ★ M9xxx(9000번대)는 시스템 계정 대역이다 — 관리자 M9999(ensure-admin.ts)가 여기 산다.
 *   이 대역을 최대값 계산에 넣으면 실회원이 M10000 부터 발번되는 사고가 난다(실제 있었다).
 *   그래서 9000 이상은 건너뛰고 **실회원 최대값 + 1** 을 쓴다.
 *   (실회원이 8,999명을 넘는 날이 오면 이 규칙을 다시 설계해야 한다 — 현재 수백 명 규모)
 */
async function nextMemberNo(tx: Tx): Promise<string> {
  const rows = await tx.member.findMany({ select: { memberNo: true } });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.memberNo.replace(/\D/g, ""));
    if (!Number.isFinite(n)) continue;
    if (n >= 9000) continue; // 시스템 계정 대역(M9999 등)은 발번에서 제외
    if (n > max) max = n;
  }
  return "M" + String(max + 1).padStart(4, "0");
}

/** 06_회비고지 DU-2026-0001 */
async function nextInvoiceId(tx: Tx, fiscalYear: number): Promise<string> {
  const rows = await tx.duesInvoice.findMany({
    where: { fiscalYear },
    select: { invoiceId: true },
  });
  let max = 0;
  for (const r of rows) {
    const tail = r.invoiceId.split("-").pop() ?? "";
    const n = Number(tail);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `DU-${fiscalYear}-${String(max + 1).padStart(4, "0")}`;
}

/** 겹치지 않는 링크토큰. 31^8 이라 충돌은 사실상 없지만 확인은 한다. */
async function freshLinkToken(tx: Tx): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const t = newLinkToken();
    const hit = await tx.member.findUnique({ where: { linkToken: t }, select: { memberNo: true } });
    if (!hit) return t;
  }
  throw new Error("링크토큰을 만들지 못했습니다(6회 연속 충돌).");
}
