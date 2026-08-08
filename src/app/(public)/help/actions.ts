"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { cfgNum, cfgStr, escapeHtml, loadSettings, manilaDateTimeStr, todayManila } from "@/lib/domain";
import { queueMail } from "@/lib/mail";
import { EMERGENCY_NUMBER } from "@/lib/site";

import { fail, textOf, zodFieldErrors, zodSummary, type FormResult } from "../_shared";
import {
  CONFLICT_CHOICES,
  CONSENT_CHOICES,
  INJURIES,
  MEMBERSHIPS,
  SEVERITIES,
  SITUATION_TYPES,
} from "./constants";

/**
 * /help — 긴급 지원 요청 접수.
 *
 * 원본: 04_운영SOP/24시간_긴급대응_SOP.md §5 "접수 로그 — 구글폼 문항".
 *   임원용 로그는 23문항이지만, **당사자가 직접 채울 수 있는 것만** 공개 폼에 둔다.
 *   접수 채널·상급 보고·72시간 팔로업 같은 항목은 임원이 나중에 채운다.
 *
 * ★ 접수 단계에서 회비 납부 여부를 묻지 않는다(SOP 서두). 회원 여부 문항은 통계용이며
 *   대응 수준에 영향을 주지 않는다고 화면에 명시한다.
 *
 * ★ 이해상충 체크(R-4). '대표 사업체 관계자' 로 답하면 **회장(=대표)을 통보 라인에서 빼고**
 *   부회장에게 총괄이 넘어간다. 화면 안내만이 아니라 실제 수신자 목록이 바뀐다.
 *
 * 저장 위치: 이 프로토타입에는 긴급대응 로그 테이블이 없다(원장 20탭에 없다).
 *   그래서 담당 임원에게 나가는 **통보 메일**이 곧 기록이다 — 15_알림로그 + 발송함에 남는다.
 *   // [확인 필요] 운영 전환 시에는 전용 테이블(EmergencyLog, SOP 23문항)을 만들어야 한다.
 */

/**
 * 공개 접수 폼 검증.
 * 이 문항들은 SOP 전용이라 validators/enums.ts(원장 20탭의 열거값)에 없다. 여기서 정의한다.
 */
const helpIntakeSchema = z.object({
  situationType: z.enum(SITUATION_TYPES),
  severity: z.enum(SEVERITIES),
  personName: z.string().trim().min(1, "당사자 성명을 적어 주십시오.").max(40),
  personPhone: z
    .string()
    .trim()
    .refine((s) => s.replace(/\D/g, "").length >= 7, "연락이 닿는 번호를 적어 주십시오(숫자 7자리 이상)."),
  location: z.string().trim().min(1, "현재 위치를 적어 주십시오. 바랑가이·랜드마크면 충분합니다.").max(200),
  summary: z
    .string()
    .trim()
    .min(10, "무슨 일이 있었는지 조금만 더 적어 주십시오(10자 이상).")
    .max(2000),
  injury: z.enum(INJURIES),
  membership: z.enum(MEMBERSHIPS).default("불명"),
  conflictCheck: z.enum(CONFLICT_CHOICES),
  contactedAgencies: z.string().trim().max(200).default(""),
  privacyChoice: z.enum(CONSENT_CHOICES),
});

export interface HelpOk {
  logNo: string;
  situationType: string;
  severity: string;
  /** 이 건을 통보받은 임원 (직책 + 이름). 연락처는 화면에 따로 안내한다. */
  notifiedTo: string[];
  /** R-4 회피가 발동해 회장을 라인에서 제외했는가 */
  presidentRecused: boolean;
  hotline: string | null;
  resubmitted: boolean;
}

export type HelpState = FormResult<HelpOk>;

/** 발송함에 심는 기계용 표식. 이중 제출을 걸러내는 열쇠다(사람 눈에는 안 보인다). */
function marker(token: string): string {
  return `<!--ika-intake:${token}-->`;
}

export async function submitHelpRequest(_prev: HelpState, formData: FormData): Promise<HelpState> {
  const formToken = textOf(formData, "formToken");
  if (!formToken) {
    return fail(
      "접수 양식 정보가 유실되었습니다.",
      `페이지를 새로고침(F5)한 뒤 다시 적어 주십시오. 위급하시면 지금 바로 ${EMERGENCY_NUMBER} 로 전화하십시오.`,
    );
  }

  const settings = await loadSettings(prisma);
  const hotlineRaw = cfgStr(settings, "웹앱.긴급핫라인", "");
  const hotline = hotlineRaw && !hotlineRaw.startsWith("CHANGE_ME") ? hotlineRaw : null;

  /* ① 이중 제출 */
  const dup = await prisma.outboxMail.findFirst({
    where: { kind: "경고", bodyHtml: { contains: marker(formToken) } },
    select: { subject: true },
  });
  if (dup) {
    const m = /IL-\d{8}-\d{2}/.exec(dup.subject);
    return {
      status: "ok",
      logNo: m?.[0] ?? "(접수됨)",
      situationType: textOf(formData, "situationType"),
      severity: textOf(formData, "severity"),
      notifiedTo: [],
      presidentRecused: false,
      hotline,
      resubmitted: true,
    };
  }

  /* ② 검증 */
  const parsed = helpIntakeSchema.safeParse({
    situationType: textOf(formData, "situationType"),
    severity: textOf(formData, "severity"),
    personName: textOf(formData, "personName"),
    personPhone: textOf(formData, "personPhone"),
    location: textOf(formData, "location"),
    summary: textOf(formData, "summary"),
    injury: textOf(formData, "injury"),
    membership: textOf(formData, "membership") || "불명",
    conflictCheck: textOf(formData, "conflictCheck"),
    contactedAgencies: textOf(formData, "contactedAgencies"),
    privacyChoice: textOf(formData, "privacyChoice"),
  });
  if (!parsed.success) {
    return fail(
      zodSummary(parsed.error),
      `빨간 글씨가 붙은 칸을 채워 주십시오. 지금 생명이 위험하시면 양식을 채우지 마시고 즉시 ${EMERGENCY_NUMBER} 로 전화하십시오.`,
      zodFieldErrors(parsed.error),
    );
  }
  const input = parsed.data;

  /* ③ 통보 대상 — R-4 이해상충 회피를 실제 수신자 목록에 반영한다. */
  const officers = await prisma.officer.findMany({
    where: { status: "ACTIVE" },
    select: { officerId: true, name: true, role: true, email: true, phone: true },
  });
  const presidentRecused = input.conflictCheck === "대표 사업체 관계자";

  // 감사는 독립성 때문에 대응 라인에 넣지 않는다(사후 감사 대상이다).
  const line = officers.filter((o) => !o.role.includes("감사"));
  const recipients = line.filter((o) => {
    if (o.role === "총무") return true; // 총무는 항상 기록·연락 담당
    if (o.role === "회장") return !presidentRecused;
    if (o.role === "부회장") return true; // 회장이 빠지면 총괄, 아니면 백업
    return false;
  });

  if (recipients.length === 0) {
    return fail(
      "지금 통보할 담당 임원을 찾지 못했습니다.",
      `임원 명부가 비어 있습니다. 위급하시면 즉시 ${EMERGENCY_NUMBER} 로 전화하십시오.`,
    );
  }

  /* ④ 접수 폭주 차단. ★ 막히더라도 911 안내는 반드시 함께 나간다. */
  const hourlyLimit = cfgNum(settings, "웹앱.제한.접수_시간당", 100);
  const recent = await prisma.notifyLog.count({
    where: { kind: "경고", sentAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  if (recent >= hourlyLimit) {
    const phones = recipients.map((o) => `${o.role} ${o.name} ${o.phone}`).join(" / ");
    return fail(
      "지금 접수가 몰려 자동 접수를 잠시 멈췄습니다. 전화로 연락해 주십시오.",
      `생명이 위험하시면 즉시 ${EMERGENCY_NUMBER}. 한인회 담당자 직통: ${phones}` +
        (hotline ? ` / 긴급 핫라인 ${hotline}` : ""),
    );
  }

  /* ⑤ 로그번호 IL-YYYYMMDD-NN (SOP §5 자동 생성 규칙) */
  const today = todayManila();
  const stamp = today.replace(/-/g, "");
  const sameDay = await prisma.notifyLog.findMany({
    where: { relatedId: { startsWith: `IL-${stamp}-` } },
    select: { relatedId: true },
  });
  const seq = new Set(sameDay.map((r) => r.relatedId)).size + 1;
  const logNo = `IL-${stamp}-${String(seq).padStart(2, "0")}`;

  /* ⑥ 통보 메일 — 이것이 곧 접수 기록이다. */
  const subjectBody = `${logNo} · ${input.severity} · ${input.situationType} 접수`;
  const subject = cfgStr(settings, "템플릿.경고.제목", "[긴급][한인회] {{제목}}").replace(
    "{{제목}}",
    subjectBody,
  );

  const rows: Array<[string, string]> = [
    ["로그번호", logNo],
    ["접수 일시", manilaDateTimeStr(new Date()) + " (Asia/Manila)"],
    ["접수 채널", "웹 접수 폼 (/help)"],
    ["심각도", input.severity],
    ["상황 유형", input.situationType],
    ["당사자 성명", input.personName],
    ["연락처", input.personPhone],
    ["현재 위치", input.location],
    ["부상·인명피해", input.injury],
    ["회원 여부", `${input.membership} (⚠ 대응 수준에 영향 없음 · 통계 목적)`],
    ["이해상충 체크 (R-4)", input.conflictCheck],
    ["이미 연락한 기관", input.contactedAgencies || "(없음)"],
    ["개인정보 처리", input.privacyChoice],
  ];

  const recusalNote = presidentRecused
    ? '<p style="color:#7a3ba8;font-weight:bold">R-4 발동: 대표 사업체 관계자 건이므로 <u>회장(대표)을 대응 라인에서 제외</u>하고 부회장이 총괄합니다. (이해상충 관리규정)</p>'
    : "";

  const bodyHtml =
    marker(formToken) +
    `<h2 style="margin:0 0 8px">${escapeHtml(subjectBody)}</h2>` +
    `<p style="margin:0 0 12px">웹 접수 폼으로 긴급 지원 요청이 들어왔습니다. <b>SOP §2 해당 유형 플로우</b>에 따라 대응하고, 임원용 접수 로그 23문항을 채워 주십시오.</p>` +
    recusalNote +
    '<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:14px">' +
    rows
      .map(
        ([k, v]) =>
          `<tr><th align="left" style="background:#eef2f7;white-space:nowrap">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`,
      )
      .join("") +
    "</table>" +
    `<h3 style="margin:16px 0 4px">상황 요약</h3><p style="white-space:pre-wrap">${escapeHtml(input.summary)}</p>` +
    `<hr><p style="font-size:13px;color:#56606f">당사자 실명·연락처가 들어 있습니다. 임원 외에 공유하지 마십시오. 단톡방·SNS 게시 금지. 개인정보 포함 원본은 2년 보관 후 삭제합니다. (SOP §5 로그 운영규칙)</p>`;

  let queued = 0;
  for (const o of recipients) {
    try {
      await queueMail({
        kind: "경고",
        toEmail: o.email,
        toName: `${o.name} ${o.role}`,
        subject,
        bodyHtml,
        relatedId: logNo,
        trigger: "submitHelpRequest",
      });
      queued += 1;
    } catch (e) {
      console.error("[help] 통보 메일 기록 실패", o.officerId, e);
    }
  }

  if (queued === 0) {
    const phones = recipients.map((o) => `${o.role} ${o.name} ${o.phone}`).join(" / ");
    return fail(
      "접수를 기록하지 못했습니다. 전화로 연락해 주십시오.",
      `생명이 위험하시면 즉시 ${EMERGENCY_NUMBER}. 한인회 담당자 직통: ${phones}`,
    );
  }

  revalidatePath("/dev/outbox");

  return {
    status: "ok",
    logNo,
    situationType: input.situationType,
    severity: input.severity,
    notifiedTo: recipients.map((o) => `${o.name} ${o.role}`),
    presidentRecused,
    hotline,
    resubmitted: false,
  };
}
