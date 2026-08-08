"use server";

import { revalidatePath } from "next/cache";

import { prisma, type Tx } from "@/lib/db";
import { cfgNum, cfgStr, conflictNormalize, loadSettings, nameLooseMatch, todayManila } from "@/lib/domain";
import { eventSignupSchema } from "@/lib/validators";

import {
  boolOf,
  fail,
  idempotencyKey,
  phoneKey,
  textOf,
  zodFieldErrors,
  zodSummary,
  type FormResult,
} from "../_shared";

/**
 * /events — 행사 참가 신청 서버 액션.
 *
 * 서버에서 다시 확인하는 것 (화면에서 버튼을 감추는 것은 통제가 아니다)
 *   · 행사가 정말 '접수중' 인가        — 마감된 행사에 폼을 직접 POST 하는 것을 막는다
 *   · 신청 마감일이 지나지 않았는가
 *   · 정원이 남았는가                  — 정원 계산도 트랜잭션 안에서
 *   · 같은 번호로 이미 신청하지 않았는가
 *   · 적어 낸 회원번호가 정말 본인인가 — 이름이 안 맞으면 회원 연결을 하지 않는다
 */

export interface EventSignupOk {
  signupId: string;
  eventId: string;
  eventTitle: string;
  eventPlace: string;
  applicantName: string;
  totalPeople: number;
  feeTotal: number;
  /** 회원번호를 적었고 이름까지 맞아 회원 기록에 연결된 경우 */
  linkedMemberNo: string | null;
  /** 회원번호를 적었지만 이름이 달라 연결하지 않은 경우 */
  memberLinkRejected: boolean;
  resubmitted: boolean;
}

export type EventSignupState = FormResult<EventSignupOk>;

export async function submitEventSignup(
  _prev: EventSignupState,
  formData: FormData,
): Promise<EventSignupState> {
  const formToken = textOf(formData, "formToken");
  if (!formToken) {
    return fail("신청서 정보가 유실되었습니다.", "페이지를 새로고침(F5)한 뒤 다시 작성해 주십시오.");
  }

  const settings = await loadSettings(prisma);
  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");

  /* ① 이중 제출 */
  const already = await prisma.eventSignup.findFirst({
    where: { formResponseId: idempotencyKey(formToken) },
    include: { event: { select: { title: true, place: true } } },
  });
  if (already) {
    return {
      status: "ok",
      signupId: already.signupId,
      eventId: already.eventId,
      eventTitle: already.event.title,
      eventPlace: already.event.place,
      applicantName: already.applicantName,
      totalPeople: already.totalPeople,
      feeTotal: already.feeTotal,
      linkedMemberNo: already.memberNo,
      memberLinkRejected: false,
      resubmitted: true,
    };
  }

  /* ② 개인정보 동의 */
  if (!boolOf(formData, "privacyConsent")) {
    return fail(
      "개인정보 수집·이용에 동의하셔야 행사 신청을 접수할 수 있습니다.",
      "동의가 어려우시면 총무에게 직접 연락해 주십시오.",
      { privacyConsent: "동의 여부를 확인해 주십시오." },
    );
  }

  /* ③ zod 재검증 */
  const parsed = eventSignupSchema.safeParse({
    eventId: textOf(formData, "eventId"),
    memberNo: textOf(formData, "memberNo") || undefined,
    applicantName: textOf(formData, "applicantName"),
    phone: textOf(formData, "phone"),
    guests: textOf(formData, "guests") || "0",
    specialNote: textOf(formData, "specialNote"),
  });
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), "빨간 글씨가 붙은 칸을 고쳐 주십시오.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  /* ④ 접수 폭주 차단 */
  const hourlyLimit = cfgNum(settings, "웹앱.제한.행사_시간당", 40);
  const recent = await prisma.eventSignup.count({
    where: { appliedAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  if (recent >= hourlyLimit) {
    return fail(
      "지금은 신청이 몰려 접수를 잠시 멈췄습니다.",
      `한 시간에 ${hourlyLimit}건까지만 받도록 설정돼 있습니다. 잠시 뒤 다시 시도해 주십시오.`,
    );
  }

  /* ⑤ 회원 연결 — 회원번호만 맞히면 남의 기록에 붙일 수 있으므로 이름까지 본다. */
  let linkedMemberNo: string | null = null;
  let memberLinkRejected = false;
  if (input.memberNo) {
    const m = await prisma.member.findUnique({
      where: { memberNo: input.memberNo },
      select: { memberNo: true, name: true, status: true },
    });
    if (m && m.status !== "WITHDRAWN" && nameLooseMatch(conflictNormalize(m.name), conflictNormalize(input.applicantName))) {
      linkedMemberNo = m.memberNo;
    } else {
      // 신청 자체는 받는다. 회원 연결만 하지 않고 총무가 나중에 붙인다.
      memberLinkRejected = true;
    }
  }

  const totalPeople = 1 + input.guests;
  const today = todayManila();

  /* ⑥ 저장 — 정원 검사와 채번을 같은 트랜잭션에서 한다. */
  type Fail = { kind: "fail"; message: string; howToFix: string | null; field?: string };
  type Done = { kind: "ok"; signupId: string; title: string; place: string; feeTotal: number };

  let result: Fail | Done;
  try {
    result = await prisma.$transaction(async (tx: Tx): Promise<Fail | Done> => {
      const ev = await tx.event.findUnique({ where: { eventId: input.eventId } });
      if (!ev || !ev.isPublic) {
        return { kind: "fail", message: "그 행사를 찾을 수 없습니다.", howToFix: "행사 목록에서 다시 골라 주십시오.", field: "eventId" };
      }
      if (ev.status !== "접수중") {
        return {
          kind: "fail",
          message: `"${ev.title}" 은 지금 신청을 받지 않습니다 (상태: ${ev.status}).`,
          howToFix: `문의는 ${contactEmail || "총무"} 로 해 주십시오.`,
          field: "eventId",
        };
      }
      if (ev.signupDeadline && today > ev.signupDeadline) {
        return {
          kind: "fail",
          message: `"${ev.title}" 의 신청 마감일(${ev.signupDeadline})이 지났습니다.`,
          howToFix: `자리가 남아 있을 수 있으니 총무(${contactEmail || "한인회"})에게 문의해 주십시오.`,
          field: "eventId",
        };
      }

      // 정원 — 취소된 신청은 빼고 센다.
      if (ev.capacity > 0) {
        const agg = await tx.eventSignup.aggregate({
          where: { eventId: ev.eventId, status: { not: "취소" } },
          _sum: { totalPeople: true },
        });
        const taken = agg._sum.totalPeople ?? 0;
        const left = ev.capacity - taken;
        if (totalPeople > left) {
          return {
            kind: "fail",
            message:
              left <= 0
                ? `"${ev.title}" 은 정원 ${ev.capacity}명이 모두 찼습니다.`
                : `남은 자리가 ${left}명뿐입니다. ${totalPeople}명은 접수할 수 없습니다.`,
            howToFix:
              left <= 0
                ? `대기 등록을 원하시면 총무(${contactEmail || "한인회"})에게 연락해 주십시오.`
                : `동반 인원을 ${Math.max(0, left - 1)}명 이하로 줄여 주시거나 총무에게 문의해 주십시오.`,
            field: "guests",
          };
        }
      }

      // 같은 번호로 이미 신청했는가.
      // '0917 222 3344' 와 '+63 917 222 3344' 는 같은 번호다 — phoneKey 가 뒤 10자리로 맞춘다.
      const mine = phoneKey(input.phone);
      const existing = await tx.eventSignup.findMany({
        where: { eventId: ev.eventId, status: { not: "취소" } },
        select: { signupId: true, phone: true },
      });
      if (mine.length >= 7 && existing.some((s) => phoneKey(s.phone) === mine)) {
        return {
          kind: "fail",
          message: "이 연락처로 이미 신청하셨습니다.",
          howToFix: `인원을 바꾸시려면 총무(${contactEmail || "한인회"})에게 말씀해 주십시오. 같은 번호로 두 번 접수하지 않습니다.`,
          field: "phone",
        };
      }

      const signupId = await nextSignupId(tx);
      const feeTotal = ev.fee * totalPeople;

      await tx.eventSignup.create({
        data: {
          signupId,
          eventId: ev.eventId,
          appliedAt: new Date(),
          memberNo: linkedMemberNo,
          applicantName: input.applicantName,
          phone: input.phone,
          guests: input.guests,
          totalPeople,
          feeTotal,
          paid: false,
          receiptNo: null,
          attendance: "예정",
          specialNote: input.specialNote,
          status: "접수",
          formResponseId: idempotencyKey(formToken),
        },
      });

      return { kind: "ok", signupId, title: ev.title, place: ev.place, feeTotal };
    });
  } catch (e) {
    console.error("[events] 저장 실패", e);
    return fail(
      "행사 신청을 저장하지 못했습니다.",
      "잠시 후 다시 시도해 주십시오. 계속 같은 화면이 나오면 총무에게 알려 주십시오.",
    );
  }

  if (result.kind === "fail") {
    return fail(result.message, result.howToFix, result.field ? { [result.field]: result.message } : undefined);
  }

  revalidatePath("/events");

  return {
    status: "ok",
    signupId: result.signupId,
    eventId: input.eventId,
    eventTitle: result.title,
    eventPlace: result.place,
    applicantName: input.applicantName,
    totalPeople,
    feeTotal: result.feeTotal,
    linkedMemberNo,
    memberLinkRejected,
    resubmitted: false,
  };
}

/** 10_행사신청 EA-0001 */
async function nextSignupId(tx: Tx): Promise<string> {
  const rows = await tx.eventSignup.findMany({ select: { signupId: true } });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.signupId.replace(/\D/g, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return "EA-" + String(max + 1).padStart(4, "0");
}
