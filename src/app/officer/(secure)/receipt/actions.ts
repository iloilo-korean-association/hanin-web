"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import {
  assertFyOpen,
  cashThresholdFrom,
  cfgStr,
  evaluateTxState,
  FALLBACK_TEMPLATES,
  formatMoney,
  fxTableFrom,
  loadSettings,
  memberLinkPath,
  nextReceiptNo,
  publicPolicyFrom,
  PUBLIC_LEDGER_PATH,
  rateFor,
  renderFromSettings,
  toPeso,
  todayManila,
} from "@/lib/domain";
import { requireOfficer } from "@/lib/guard";
import { queueMail } from "@/lib/mail";
import { ROUTES, absoluteUrl } from "@/lib/site";
import { firstIssue, receiptInputSchema } from "@/lib/validators";

import type { ActionState } from "../../_lib/action-state";
import { appendAuditLog, fail, fdBool, fdStr, ok, toActionError } from "../../_lib/server-utils";
import { saveDataUrl } from "../../_lib/upload";

/**
 * 수납 1건 기록 — 총무가 가장 많이 쓰는 쓰기 경로.
 *
 * 불변식이 여기서 어떻게 지켜지는가
 *   I5  assertFyOpen 이 마감 연도를 트랜잭션 안에서 막는다.
 *   I2  nextReceiptNo 채번과 transaction.create 가 **같은 $transaction** 안에 있다.
 *       중간에 실패하면 카운터도 함께 롤백되므로 "번호만 쓰이고 거래는 없는" 결번이 안 생긴다.
 *   I3  증빙이 없으면 evaluateTxState 가 DRAFT 로 떨어뜨린다.
 *   I4  현금 임계 초과인데 확인자가 없거나 입력자와 같으면 DRAFT.
 *   I1  이 경로는 UPDATE·DELETE 를 하지 않는다. 잘못 넣었으면 VOIDED + 정정 재집행이다.
 *
 * ★ 클라이언트가 status 를 보내와도 쓰지 않는다. 스키마에 아예 없다.
 */
export async function recordReceiptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    // ★ 첫 줄. write:true 를 빼면 감사 계정이 통과한다.
    const me = await requireOfficer({
      permissions: ["입력권"],
      write: true,
      screen: "수납 기록",
    });

    const parsed = receiptInputSchema.safeParse({
      payer: fdStr(formData, "payer"),
      memberNo: fdStr(formData, "memberNo") || undefined,
      amount: fdStr(formData, "amount"),
      currency: fdStr(formData, "currency") || "PHP",
      method: fdStr(formData, "method"),
      categoryCode: fdStr(formData, "categoryCode"),
      fundId: fdStr(formData, "fundId"),
      accountId: fdStr(formData, "accountId") || undefined,
      date: fdStr(formData, "date"),
      externalRef: fdStr(formData, "externalRef"),
      memo: fdStr(formData, "memo"),
      verifiedBy: fdStr(formData, "verifiedBy"),
      evidenceUrl: "", // 사진을 저장한 뒤 아래에서 채운다
      ackNoEvidence: fdBool(formData, "ackNoEvidence"),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const input = parsed.data;

    if (!input.accountId) {
      return fail(
        "어느 계좌로 받은 돈인지 골라 주십시오.",
        "계좌를 틀리면 현금실사 대사(감사 화면 C4)가 통째로 어긋납니다.",
      );
    }
    if (input.date > todayManila()) {
      return fail("미래 날짜로는 수납을 기록할 수 없습니다.");
    }

    // I4 를 서버에서 한 번 더. 화면 select 에서 본인을 빼 두었지만 폼은 직접 POST 될 수 있다.
    if (input.verifiedBy && input.verifiedBy === me.email.trim().toLowerCase()) {
      return fail(
        "확인자는 받은 사람(귀하)과 다른 사람이어야 합니다.",
        "혼자 받고 혼자 확인한 것은 2인 확인이 아닙니다(I4).",
      );
    }
    // ★ 확인자는 **실재하는 현직 임원**이어야 한다.
    //   이메일 '형식' 만 보고 통과시키면 아무 주소나(ghost@nowhere.example) 적어 넣어
    //   현금 고액을 혼자 POSTED 로 만들 수 있다 — I4 가 형식만 남는다.
    //   (적대 점검에서 실제로 ₱50,000 현금이 유령 확인자로 POSTED 되는 것을 확인했다)
    if (input.verifiedBy) {
      const verifier = await prisma.officer.findFirst({
        where: { email: input.verifiedBy },
        select: { officerId: true, status: true },
      });
      if (!verifier || verifier.status !== "ACTIVE") {
        return fail(
          `확인자 "${input.verifiedBy}" 는 현직 임원이 아닙니다.`,
          "확인자는 12_임원에 등록된 활동(ACTIVE) 중인 임원이어야 합니다. 아래 목록에서 골라 주십시오.",
        );
      }
    }

    /* ── 증빙 사진 (트랜잭션 밖에서 저장한다 — 파일 I/O 로 락을 잡고 있지 않는다) ── */
    const photo = fdStr(formData, "photoDataUrl");
    let evidenceUrl = "";
    if (photo) {
      const saved = await saveDataUrl(photo, "receipts", input.date);
      if (!saved.ok) return fail(saved.message);
      evidenceUrl = saved.url;
    } else if (!input.ackNoEvidence) {
      return fail(
        "영수증 사진이 없습니다. 사진을 첨부하시거나 “사진 없이 임시(DRAFT)로 기록”에 체크해 주십시오.",
        "증빙 없는 수납은 POSTED 가 될 수 없고(I3) 공개 회계에도 뜨지 않습니다.",
      );
    }

    /* ── 설정·환율 ── */
    const settings = await loadSettings(prisma);
    const fxTable = fxTableFrom(settings);
    let fxRate: number;
    try {
      fxRate = rateFor(input.currency, fxTable);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "환율 설정을 읽지 못했습니다.");
    }
    const amountPhp = toPeso(input.amount, input.currency, fxRate, fxTable);
    const cashThreshold = cashThresholdFrom(settings);
    const receiptPrefix = publicPolicyFrom(settings).receiptPrefix;
    const duesCategory = cfgStr(settings, "기본.과목코드.회비", "R100");

    /* ── 장부 기입 ── */
    const created = await prisma.$transaction(async (tx) => {
      const fy = await assertFyOpen(tx, input.date); // I5

      // 마스터에 없는 코드로 거래를 만들면 공개 집계에서 "(미분류)" 로 빠진다. 여기서 끊는다.
      const [account, fund, category] = await Promise.all([
        tx.account.findUnique({ where: { accountId: input.accountId! } }),
        tx.fund.findUnique({ where: { fundId: input.fundId } }),
        tx.category.findUnique({ where: { code: input.categoryCode } }),
      ]);
      if (!account) throw new Error(`02_계좌에 없는 계좌ID 입니다: ${input.accountId}`);
      if (account.status !== "ACTIVE") throw new Error(`${account.name} 계좌는 이미 폐쇄되었습니다.`);
      if (input.date < account.openedOn) {
        throw new Error(
          `${account.name} 계좌의 개시일(${account.openedOn}) 이전 날짜로는 기록할 수 없습니다. 개시일 이전 거래는 잔액 계산에서 빠집니다.`,
        );
      }
      if (!fund) throw new Error(`03_기금에 없는 기금ID 입니다: ${input.fundId}`);
      if (!category) throw new Error(`04_과목에 없는 과목코드입니다: ${input.categoryCode}`);
      if (category.majorType !== "수입") {
        throw new Error(
          `"${category.name}" 은 지출 과목입니다. 수납(수입)에는 쓸 수 없습니다. 지출은 지출 요청 화면에서 결재를 받아야 합니다.`,
        );
      }

      let member: { memberNo: string; name: string; email: string; notifyConsent: boolean } | null =
        null;
      if (input.memberNo) {
        member = await tx.member.findUnique({
          where: { memberNo: input.memberNo },
          select: { memberNo: true, name: true, email: true, notifyConsent: true },
        });
        if (!member) throw new Error(`01_회원에 없는 회원번호입니다: ${input.memberNo}`);
      }

      // I2 — 채번은 반드시 트랜잭션 안에서, 그리고 같은 트랜잭션에서 create 한다.
      const { receiptNo, seq } = await nextReceiptNo(tx, fy, receiptPrefix);

      // I3 + I4 — 최종 상태는 **서버가** 정한다.
      const state = evaluateTxState(
        {
          evidenceUrl,
          method: input.method,
          amount: input.amount,
          currency: input.currency,
          fxRate,
          enteredBy: me.email,
          verifiedBy: input.verifiedBy,
        },
        cashThreshold,
      );

      const row = await tx.transaction.create({
        data: {
          receiptNo,
          seq,
          fiscalYear: fy,
          date: input.date,
          direction: "IN",
          amount: input.amount,
          currency: input.currency,
          fxRate,
          amountPhp,
          accountId: account.accountId,
          fundId: fund.fundId,
          categoryCode: category.code,
          counterpartyType: member ? "회원" : "비회원",
          counterpartyMemberNo: member?.memberNo ?? null,
          counterpartyName: input.payer,
          method: input.method,
          // ★ 적요에 회원 실명을 적지 않는다(감사 검사 C14). 회원번호로 남긴다.
          memo:
            [category.name, member ? `회원 ${member.memberNo}` : "비회원", input.memo]
              .filter(Boolean)
              .join(" / ")
              .slice(0, 200) + (state.status === "DRAFT" ? ` [보류: ${state.reason}]` : ""),
          externalRef: input.externalRef,
          status: state.status,
          relatedParty: false,
          enteredBy: me.email,
          verifiedBy: input.verifiedBy,
          verifiedAt: input.verifiedBy ? new Date() : null,
          evidenceUrl,
        },
      });

      /* ── 회비 수납이면 06_회비고지를 같은 트랜잭션에서 갱신한다 ──
         안 하면 감사 화면 C7(회비 대사)과 prisma/verify.ts 의 회비 대사가 영원히 어긋난다.

         ★ DRAFT 도 반영한다. 회비고지.납부금액은 "장부에 반영됐나" 가 아니라
           **"돈을 실제로 받았나"** 를 뜻하기 때문이다(증빙 사진이 없어 DRAFT 여도 돈은 이미 받았다).
           데이터 계층의 검산도 `납부금액 = POSTED 합계 + DRAFT 합계` 로 대사한다
           (prisma/verify.ts 의 "회비고지 납부금액 = 수납 거래 합계"). 규칙을 여기서 바꾸면
           그 검산이 깨지고, 미납 독촉이 이미 낸 회원에게 나간다.

         ★ 미납금액을 0 으로 깎지 않는다. 스키마 정의가 `미납금액 = 고지금액 - 납부금액` 이라
           과납(음수)을 0 으로 만들면 그 항등식이 깨진다. 음수는 "선납·과납" 을 뜻한다. */
      let duesNote = "";
      if (member && category.code === duesCategory) {
        const inv = await tx.duesInvoice.findUnique({
          where: { fiscalYear_memberNo: { fiscalYear: fy, memberNo: member.memberNo } },
        });
        if (inv) {
          const paid = inv.paidAmount + amountPhp;
          const unpaid = inv.billedAmount - paid;
          const nextStatus =
            inv.status === "면제" ? "면제" : unpaid <= 0 ? "완납" : paid > 0 ? "부분납" : "미납";
          await tx.duesInvoice.update({
            where: { invoiceId: inv.invoiceId },
            data: {
              paidAmount: paid,
              unpaidAmount: unpaid,
              status: nextStatus,
              lastReceiptNo: receiptNo,
              lastPaidOn: input.date,
            },
          });
          duesNote =
            unpaid > 0
              ? `아직 ${formatMoney(unpaid)}페소가 남아 있습니다(${nextStatus}).`
              : unpaid < 0
                ? `올해 회비가 완납되었고 ${formatMoney(-unpaid)}페소가 더 들어왔습니다(과납). 총무가 확인해 주십시오.`
                : "올해 회비가 완납되었습니다.";
        } else {
          duesNote = `${fy}년 회비고지가 없는 회원입니다. 06_회비고지를 확인해 주십시오.`;
        }
      }

      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Transaction",
        recordKey: receiptNo,
        changeType: "INSERT",
        severity: state.status === "POSTED" ? "INFO" : "WARN",
        afterValue: `IN ${amountPhp} ${input.currency} / ${input.method} / ${account.accountId} / ${state.status}`,
        note: `수납 기록 (${me.officerId} ${me.role}) — ${input.payer}` + (state.reason ? ` [${state.reason}]` : ""),
      });

      return {
        receiptNo,
        status: state.status,
        reason: state.reason,
        duesNote,
        categoryName: category.name,
        member,
        amountPhp,
      };
    });

    /* ── 영수증 메일 (트랜잭션 밖. 메일이 실패해도 장부는 이미 확정됐다) ── */
    let mailNote = "";
    if (created.member?.email && created.member.notifyConsent) {
      try {
        const linkPath = await memberLinkPathFor(created.member.memberNo);
        const { subject, bodyHtml } = renderFromSettings(
          settings,
          "영수증",
          {
            성명: created.member.name,
            영수증번호: created.receiptNo,
            일자: input.date,
            금액: formatMoney(input.amount),
            통화: input.currency,
            과목명: created.categoryName,
            수단: input.method,
            입력자: me.name,
            미납안내: created.duesNote,
            공개장부URL: absoluteUrl(PUBLIC_LEDGER_PATH),
          },
          FALLBACK_TEMPLATES.영수증,
        );
        await queueMail({
          kind: "영수증",
          toEmail: created.member.email,
          toName: created.member.name,
          subject,
          bodyHtml,
          linkPath: linkPath ?? "",
          memberNo: created.member.memberNo,
          relatedId: created.receiptNo,
          trigger: "recordReceiptAction",
        });
        mailNote = " 영수증 메일을 발송함(/dev/outbox)에 넣었습니다.";
      } catch {
        // 메일 실패로 수납을 되돌리지 않는다. 돈은 이미 받았고 장부에도 들어갔다.
        mailNote = " (영수증 메일 생성에는 실패했습니다 — 총무가 직접 알려 주십시오.)";
      }
    }

    revalidatePath(ROUTES.officer);
    revalidatePath(`${ROUTES.officer}/receipt`);
    revalidatePath(`${ROUTES.officer}/audit`);
    revalidatePath(ROUTES.ledger);

    const head =
      created.status === "POSTED"
        ? `${created.receiptNo} 로 장부에 반영했습니다.`
        : `${created.receiptNo} 로 기록했으나 아직 미확정(DRAFT)입니다.`;

    return ok(head + (created.duesNote ? ` ${created.duesNote}` : "") + mailNote, {
      receiptNo: created.receiptNo,
      status: created.status,
      reason: created.reason,
    });
  } catch (e) {
    return toActionError(e);
  }
}

/** 회원 링크토큰으로 /me/XXXX 경로를 만든다. 토큰이 없으면 링크를 붙이지 않는다. */
async function memberLinkPathFor(memberNo: string): Promise<string | null> {
  const m = await prisma.member.findUnique({
    where: { memberNo },
    select: { linkToken: true },
  });
  return m?.linkToken ? memberLinkPath(m.linkToken) : null;
}
