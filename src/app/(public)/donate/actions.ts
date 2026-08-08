"use server";

import { revalidatePath } from "next/cache";

import { prisma, type Tx } from "@/lib/db";
import {
  cfgNum,
  cfgStr,
  fiscalYearOf,
  formatMoney,
  fxTableFrom,
  loadSettings,
  toPeso,
  todayManila,
  FALLBACK_TEMPLATES,
  PUBLIC_LEDGER_PATH,
  renderFromSettings,
} from "@/lib/domain";
import { queueMail } from "@/lib/mail";
import { absoluteUrl } from "@/lib/site";
import { donationInputSchema } from "@/lib/validators";

import {
  boolOf,
  fail,
  textOf,
  zodFieldErrors,
  zodSummary,
  type FormResult,
} from "../_shared";

/**
 * /donate — 기부 접수 서버 액션.
 *
 * ★ 여기서 05_거래(입금)를 만들지 않는다.
 *   돈이 실제로 들어왔는지는 총무가 계좌·현금을 확인한 뒤 수납 화면에서 기록한다.
 *   증빙 없이 POSTED 를 만들 수 없기 때문이다(I3). 그래서 이 화면은 07_기부에
 *   상태 '접수' 로만 남기고, 영수증번호는 비워 둔다.
 *
 * ★ 금액은 어떤 경우에도 숨기지 않는다. 익명·비공개를 고르셔도 총 기부금 합계에는
 *   그대로 포함된다. 이름만 빠진다. (F4 섹션 3 설명 그대로)
 */

export interface DonateOk {
  donationId: string;
  /** 기부자에게 보여줄 표기. 익명이면 "익명" */
  displayName: string;
  amount: number;
  currency: string;
  amountPhp: number;
  isDesignated: boolean;
  fundName: string;
  designatedPurpose: string;
  isAnonymous: boolean;
  publicConsent: boolean;
  receivedOn: string;
  mailQueued: boolean;
  mailTo: string;
  resubmitted: boolean;
}

export type DonateState = FormResult<DonateOk>;

/** 07_기부.비고 에 남기는 접수 출처 표시 = 이중 제출 방지 키. */
function provenance(token: string): string {
  return `웹 접수 #${token}`;
}

export async function submitDonation(
  _prev: DonateState,
  formData: FormData,
): Promise<DonateState> {
  const formToken = textOf(formData, "formToken");
  if (!formToken) {
    return fail(
      "신청서 정보가 유실되었습니다.",
      "페이지를 새로고침(F5)한 뒤 다시 작성해 주십시오.",
    );
  }

  const settings = await loadSettings(prisma);
  const contactEmail = cfgStr(settings, "웹앱.문의이메일", "");

  /* ① 이중 제출 — 같은 접수를 두 번 저장하지 않는다. */
  const already = await prisma.donation.findFirst({
    where: { note: { contains: provenance(formToken) } },
    include: { fund: { select: { name: true } } },
  });
  if (already) {
    return {
      status: "ok",
      donationId: already.donationId,
      displayName: already.isAnonymous ? "익명" : already.donorName || "익명",
      amount: already.amount,
      currency: already.currency,
      amountPhp: already.amountPhp,
      isDesignated: already.isDesignated,
      fundName: already.fund?.name ?? "일반회계",
      designatedPurpose: already.designatedPurpose,
      isAnonymous: already.isAnonymous,
      publicConsent: already.publicConsent,
      receivedOn: already.receivedOn,
      mailQueued: false,
      mailTo: "",
      resubmitted: true,
    };
  }

  /* ② 개인정보 동의 (F4 요약 동의문) */
  if (!boolOf(formData, "privacyConsent")) {
    return fail(
      "개인정보 수집·이용에 동의하셔야 기부를 접수할 수 있습니다.",
      "동의하지 않으실 경우 총무에게 직접 연락해 주시면 서면으로 처리해 드립니다.",
      { privacyConsent: "동의 여부를 확인해 주십시오." },
    );
  }

  /* ③ zod 재검증 */
  const donorTypeRaw = textOf(formData, "donorType");
  const anonymousDonor = donorTypeRaw === "익명";
  const isAnonymous = anonymousDonor || boolOf(formData, "isAnonymous");
  // 라디오(isDesignatedChoice)와 hidden(isDesignated) 둘 다 본다.
  // 자바스크립트가 아직 도착하지 않은 상태로 제출해도 지정 기부가 일반회계로 새지 않게.
  const isDesignated =
    boolOf(formData, "isDesignated") || textOf(formData, "isDesignatedChoice") === "yes";
  const today = todayManila();

  const parsed = donationInputSchema.safeParse({
    donorType: donorTypeRaw,
    // 기부자를 '익명' 으로 고르셨으면 이름·연락처를 아예 받지 않는다.
    donorName: anonymousDonor ? "" : textOf(formData, "donorName"),
    donorPhone: anonymousDonor ? "" : textOf(formData, "donorPhone"),
    donorEmail: anonymousDonor ? "" : textOf(formData, "donorEmail"),
    amount: textOf(formData, "amount"),
    currency: textOf(formData, "currency") || "PHP",
    method: textOf(formData, "method"),
    receivedOn: today,
    isDesignated,
    fundId: isDesignated ? textOf(formData, "fundId") || undefined : undefined,
    designatedPurpose: isDesignated ? textOf(formData, "designatedPurpose") : "",
    isAnonymous,
    // 익명 기부는 공개 표기 자체가 불가능하다(스키마도 두 값을 함께 못 켜게 막는다).
    publicConsent: isAnonymous ? false : boolOf(formData, "publicConsent"),
    publicDisplayName: isAnonymous ? "" : textOf(formData, "publicDisplayName"),
    note: textOf(formData, "note"),
  });

  if (!parsed.success) {
    return fail(zodSummary(parsed.error), "빨간 글씨가 붙은 칸을 고쳐 주십시오.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;

  /* ④ 같은 분이 하루에 너무 많이 접수하는 것을 막는다 (00_설정 웹앱.제한.기부_개인).
        오타로 같은 건을 여러 번 올리는 사고가 실제로 흔하다. */
  if (input.donorName) {
    const perDay = cfgNum(settings, "웹앱.제한.기부_개인", 5);
    const mine = await prisma.donation.count({
      where: { donorName: input.donorName, receivedOn: today },
    });
    if (mine >= perDay) {
      return fail(
        "오늘 접수하신 건수가 설정된 한도를 넘었습니다.",
        `같은 성함으로 하루 ${perDay}건까지 받도록 되어 있습니다. 이미 접수하신 건이 있는지 확인해 주시고, 맞다면 총무(${contactEmail || "한인회"})에게 직접 연락해 주십시오.`,
      );
    }
  }

  /* ⑤ 지정 기금 확인 — 지정 기부는 그 목적에만 쓸 수 있다. */
  let fundName = "일반회계";
  if (input.isDesignated) {
    const fund = await prisma.fund.findUnique({ where: { fundId: input.fundId! } });
    if (!fund || fund.status !== "ACTIVE") {
      return fail("고르신 기금을 찾을 수 없습니다.", "목록에서 다시 골라 주십시오.", {
        fundId: "사용할 수 없는 기금입니다.",
      });
    }
    if (fund.kind === "일반") {
      return fail(
        "일반회계는 '지정 기부' 대상이 아닙니다.",
        "용도를 지정하지 않으시려면 '아니오 — 한인회가 필요한 곳에 써 주세요' 를 골라 주십시오.",
        { fundId: "지정 기금(장학·긴급구호·적립금) 중에서 골라 주십시오." },
      );
    }
    fundName = fund.name;
  }

  /* ⑥ 페소 환산 — 집계는 언제나 페소환산 기준이다. */
  let amountPhp: number;
  try {
    amountPhp = toPeso(input.amount, input.currency, null, fxTableFrom(settings));
  } catch (e) {
    console.error("[donate] 환율 없음", e);
    return fail(
      "환율 설정이 없어 외화 기부를 접수할 수 없습니다.",
      `총무(${contactEmail || "한인회"})에게 알려 주십시오. 페소(PHP)로는 바로 접수하실 수 있습니다.`,
      { currency: "이 통화의 환율이 설정돼 있지 않습니다." },
    );
  }

  const fiscalYear = cfgNum(settings, "회계연도", fiscalYearOf(today));
  const noteParts = [input.note, provenance(formToken)].filter(Boolean);

  let donationId: string;
  try {
    donationId = await prisma.$transaction(async (tx: Tx) => {
      const id = await nextDonationId(tx, fiscalYear);
      await tx.donation.create({
        data: {
          donationId: id,
          receivedOn: today,
          donorType: input.donorType,
          donorMemberNo: null,
          donorName: input.isAnonymous ? "" : input.donorName,
          donorPhone: input.isAnonymous ? "" : input.donorPhone,
          amount: input.amount,
          currency: input.currency,
          amountPhp,
          isDesignated: input.isDesignated,
          fundId: input.isDesignated ? input.fundId! : null,
          designatedPurpose: input.designatedPurpose,
          method: input.method,
          accountId: null,
          receiptNo: null, // 실제 입금 확인 후 총무가 수납 화면에서 연결한다
          isAnonymous: input.isAnonymous,
          publicConsent: input.publicConsent,
          publicDisplayName: input.publicConsent ? input.publicDisplayName : "",
          status: "접수",
          note: noteParts.join(" / "),
        },
      });
      return id;
    });
  } catch (e) {
    console.error("[donate] 저장 실패", e);
    return fail(
      "기부 접수를 저장하지 못했습니다.",
      "잠시 후 다시 시도해 주십시오. 계속 같은 화면이 나오면 총무에게 알려 주십시오.",
    );
  }

  /* ⑦ 감사 인사 — 실제 발송이 아니라 발송함에 기록한다. */
  let mailQueued = false;
  const mailTo = input.isAnonymous ? "" : input.donorEmail;
  if (mailTo) {
    const { subject, bodyHtml } = renderFromSettings(
      settings,
      "감사장",
      {
        기부자명: input.donorName || "기부자",
        기부ID: donationId,
        금액: formatMoney(input.amount),
        통화: input.currency,
        지정용도: input.isDesignated
          ? `${fundName}${input.designatedPurpose ? ` — ${input.designatedPurpose}` : ""}`
          : "지정 없음(일반회계)",
        // 메일 본문의 링크는 반드시 절대주소여야 한다. 메일 클라이언트에는
        // "현재 사이트" 가 없어서 /ledger 같은 상대경로는 눌리지 않는 죽은 링크가 된다.
        공개장부URL: absoluteUrl(PUBLIC_LEDGER_PATH),
      },
      FALLBACK_TEMPLATES.감사장,
    );
    try {
      await queueMail({
        kind: "감사장",
        toEmail: mailTo,
        toName: input.donorName,
        subject,
        // 덧붙이는 문장은 고정 문자열이라 이스케이프가 필요 없다.
        bodyHtml:
          bodyHtml +
          "<br><br>※ 이 메일은 <b>접수 확인</b>입니다. 총무가 실제 입금을 확인하면 영수증번호가 붙고 " +
          "공개 장부의 기금 현황에 반영됩니다.",
        linkPath: PUBLIC_LEDGER_PATH,
        relatedId: donationId,
        trigger: "submitDonation",
      });
      mailQueued = true;
    } catch (e) {
      console.error("[donate] 감사장 기록 실패", e);
    }
  }

  revalidatePath("/dev/outbox");

  return {
    status: "ok",
    donationId,
    displayName: input.isAnonymous ? "익명" : input.donorName || "익명",
    amount: input.amount,
    currency: input.currency,
    amountPhp,
    isDesignated: input.isDesignated,
    fundName,
    designatedPurpose: input.designatedPurpose,
    isAnonymous: input.isAnonymous,
    publicConsent: input.publicConsent,
    receivedOn: today,
    mailQueued,
    mailTo,
    resubmitted: false,
  };
}

/** 07_기부 DN-2026-0001 */
async function nextDonationId(tx: Tx, fiscalYear: number): Promise<string> {
  const rows = await tx.donation.findMany({
    where: { donationId: { startsWith: `DN-${fiscalYear}-` } },
    select: { donationId: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.donationId.split("-").pop());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `DN-${fiscalYear}-${String(max + 1).padStart(4, "0")}`;
}
