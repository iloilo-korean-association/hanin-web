"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { periodChangeNote, syncMembershipPeriod } from "@/lib/dues-period";
import {
  assertFyOpen,
  cfgStr,
  duesNeedsMember,
  duesRecategorizeBlocked,
  evaluateConflict,
  formatMoney,
  formatPeriod,
  fxTableFrom,
  loadSettings,
  nextReceiptNo,
  publicPolicyFrom,
  rateFor,
  toPeso,
  todayManila,
} from "@/lib/domain";
import { requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { bookEditSchema, bookEntrySchema, firstIssue, voidInputSchema } from "@/lib/validators";

import type { ActionState } from "../../_lib/action-state";
import { appendAuditLog, fail, fdStr, ok, toActionError } from "../../_lib/server-utils";

/**
 * 장부 직접 입력 — 총무가 한 줄 적으면 그 자리에서 확정된다.
 *
 * ── 없앤 것 ─────────────────────────────────────────────────────────────
 * 지출 요청 → 1차 결재 → 2차 결재 → 집행. 화면 2개, 제출 2~4회, 사람 2~3명이었다.
 * 전결(0단계)이라도 요청·집행 2회는 반드시 거쳐야 했다.
 *
 * ── 그래도 남긴 것 (전부 클릭 0회다) ───────────────────────────────────
 *   I5  assertFyOpen — 마감된 회계연도에는 못 쓴다. "언제든 수정" 의 실제 경계다.
 *   I2  nextReceiptNo 채번과 create 가 같은 $transaction 안 → 결번이 안 생긴다.
 *   I1  삭제하지 않는다. 무효는 VOIDED + 사유이고 행은 남는다.
 *   —   evaluateConflict — 이해상충을 자동 판정해 relatedParty 배지를 세운다.
 *       사전 승인이 없어졌으므로 "회피" 는 못 하지만 **공시는 그대로 남는다.**
 *       공격을 막는 것은 원래 결재 버튼이 아니라 공개된 배지였다.
 *
 * ── 바뀐 것 ─────────────────────────────────────────────────────────────
 * status 는 언제나 POSTED 다. 예전에는 증빙이 없으면 DRAFT 로 떨어졌고,
 * DRAFT 는 공개 잔액에 안 잡혔다 — 돈은 나갔는데 장부 잔액은 그대로였다.
 * 이제 확정해서 잔액을 맞추고, 대신 배지를 붙여 감사 큐로 보낸다(domain/direct-entry.ts).
 */

/** 화면·액션이 공유하는 폼 → 객체 변환. 세 액션이 같은 칸을 읽는다. */
function readEntry(fd: FormData) {
  return {
    direction: fdStr(fd, "direction"),
    date: fdStr(fd, "date"),
    amount: fdStr(fd, "amount"),
    currency: fdStr(fd, "currency") || "PHP",
    method: fdStr(fd, "method"),
    categoryCode: fdStr(fd, "categoryCode"),
    fundId: fdStr(fd, "fundId"),
    accountId: fdStr(fd, "accountId"),
    counterpartyName: fdStr(fd, "counterpartyName"),
    counterpartyType: fdStr(fd, "counterpartyType") || "비회원",
    memberNo: fdStr(fd, "memberNo") || undefined,
    vendorId: fdStr(fd, "vendorId") || undefined,
    eventId: fdStr(fd, "eventId") || undefined,
    externalRef: fdStr(fd, "externalRef"),
    memo: fdStr(fd, "memo"),
    verifiedBy: fdStr(fd, "verifiedBy"),
    evidenceUrl: fdStr(fd, "evidenceUrl"),
  };
}

type Prepared = {
  fxRate: number;
  amountPhp: number;
  receiptPrefix: string;
  duesCategory: string;
};

/** 환율·설정 등 트랜잭션 밖에서 끝낼 수 있는 준비. 락을 오래 잡지 않기 위해 분리했다. */
async function prepare(currency: string, amount: number): Promise<Prepared | ActionState> {
  const settings = await loadSettings(prisma);
  const fxTable = fxTableFrom(settings);
  let fxRate: number;
  try {
    fxRate = rateFor(currency, fxTable);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "환율 설정을 읽지 못했습니다.");
  }
  return {
    fxRate,
    amountPhp: toPeso(amount, currency, fxRate, fxTable),
    receiptPrefix: publicPolicyFrom(settings).receiptPrefix,
    duesCategory: cfgStr(settings, "기본.과목코드.회비", "R100"),
  };
}

function isActionState(v: unknown): v is ActionState {
  return typeof v === "object" && v !== null && "ok" in v && "message" in v;
}

/**
 * 이해상충 판정에 필요한 마스터를 읽어 판정한다.
 *
 * ★ undetermined(판정 불가)여도 **막지 않는다.** 예전 지출 요청 화면은 여기서 접수를 거부했는데,
 *   그러면 총무가 이름을 바꿔 가며 통과할 때까지 다시 치게 된다 — 판정을 회피하는 연습이 된다.
 *   대신 relatedParty=true 로 세워 감사 큐에 올린다. "모르겠다" 는 "깨끗하다" 가 아니라
 *   "사람이 봐야 한다" 로 흘러가야 한다.
 */
async function judgeConflict(counterpartyName: string, vendorId?: string) {
  const [vendors, conflicts, officers] = await Promise.all([
    prisma.vendor.findMany(),
    prisma.conflictOfInterest.findMany(),
    prisma.officer.findMany(),
  ]);
  return evaluateConflict({ counterpartyName, vendorId: vendorId ?? null }, vendors, conflicts, officers);
}

/* ════════════════════════════════════════════════════════════════════════
 * 적기
 * ════════════════════════════════════════════════════════════════════════ */

export async function addEntryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireOfficer({ permissions: ["입력권"], write: true, screen: "장부" });

    const parsed = bookEntrySchema.safeParse(readEntry(fd));
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const input = parsed.data;

    if (input.date > todayManila()) {
      return fail(
        "미래 날짜로는 적을 수 없습니다.",
        "아직 일어나지 않은 거래를 장부에 올리면 잔액이 통장과 안 맞습니다.",
      );
    }
    if (input.verifiedBy && input.verifiedBy === me.email.trim().toLowerCase()) {
      return fail(
        "확인자는 적은 사람(귀하)과 다른 사람이어야 합니다.",
        "혼자 쓰고 혼자 확인한 것은 2인 확인이 아닙니다. 비워 두시면 감사가 확인합니다.",
      );
    }
    if (input.verifiedBy) {
      const verifier = await prisma.officer.findFirst({
        where: { email: input.verifiedBy },
        select: { status: true },
      });
      if (!verifier || verifier.status !== "ACTIVE") {
        return fail(`확인자 "${input.verifiedBy}" 는 현직 임원이 아닙니다.`);
      }
    }

    const prep = await prepare(input.currency, input.amount);
    if (isActionState(prep)) return prep;

    /* ── 회비는 회원을 연결해야 받는다 ──
       이름만 적힌 회비는 06_회비고지에 반영되지 않는다. 돈은 냈는데 미납·회원증 미발급으로
       남고, 감사 C7 회비 대사도 어긋난다. 화면 경고는 JS 가 꺼지면 사라지므로 여기서 막는다. */
    if (duesNeedsMember(input, prep.duesCategory)) {
      return fail(
        "회비는 납부한 회원을 연결해야 합니다.",
        "상대방 칸에 이름을 치면 나오는 목록에서 회원을 골라 주십시오. 아직 회원이 아니면 먼저 회원 등록을 해 주십시오.",
      );
    }

    // 이해상충은 지출에서만 본다. 회비를 낸 사람이 이해관계자인 것은 문제가 아니다.
    const verdict =
      input.direction === "OUT" ? await judgeConflict(input.counterpartyName, input.vendorId) : null;
    const relatedParty = !!verdict && (verdict.related || verdict.undetermined);

    const created = await prisma.$transaction(async (tx) => {
      const fy = await assertFyOpen(tx, input.date); // I5

      const [account, fund, category] = await Promise.all([
        tx.account.findUnique({ where: { accountId: input.accountId } }),
        tx.fund.findUnique({ where: { fundId: input.fundId } }),
        tx.category.findUnique({ where: { code: input.categoryCode } }),
      ]);
      if (!account) throw new Error(`02_계좌에 없는 계좌ID 입니다: ${input.accountId}`);
      if (account.status !== "ACTIVE") throw new Error(`${account.name} 계좌는 이미 폐쇄되었습니다.`);
      if (input.date < account.openedOn) {
        throw new Error(
          `${account.name} 계좌의 개시일(${account.openedOn}) 이전 날짜로는 적을 수 없습니다.`,
        );
      }
      if (!fund) throw new Error(`03_기금에 없는 기금ID 입니다: ${input.fundId}`);
      if (!category) throw new Error(`04_과목에 없는 과목코드입니다: ${input.categoryCode}`);

      // 방향과 과목 대분류가 어긋나면 공개 집계에서 수입이 지출로 잡힌다. 여기서 끊는다.
      const want = input.direction === "IN" ? "수입" : "지출";
      if (category.majorType !== want) {
        throw new Error(
          `"${category.name}" 은 ${category.majorType} 과목입니다. ${want} 으로는 쓸 수 없습니다. 위에서 방향이나 과목을 바꿔 주십시오.`,
        );
      }

      let member: { memberNo: string; name: string } | null = null;
      if (input.memberNo) {
        member = await tx.member.findUnique({
          where: { memberNo: input.memberNo },
          select: { memberNo: true, name: true },
        });
        if (!member) throw new Error(`01_회원에 없는 회원번호입니다: ${input.memberNo}`);
      }

      let event: { eventId: string; title: string; settlementReceiptNos: string } | null = null;
      if (input.eventId) {
        event = await tx.event.findUnique({
          where: { eventId: input.eventId },
          select: { eventId: true, title: true, settlementReceiptNos: true },
        });
        if (!event) throw new Error(`09_행사에 없는 행사ID 입니다: ${input.eventId}`);
      }

      const { receiptNo, seq } = await nextReceiptNo(tx, fy, prep.receiptPrefix); // I2

      await tx.transaction.create({
        data: {
          receiptNo,
          seq,
          fiscalYear: fy,
          date: input.date,
          direction: input.direction,
          amount: input.amount,
          currency: input.currency,
          fxRate: prep.fxRate,
          amountPhp: prep.amountPhp,
          accountId: account.accountId,
          fundId: fund.fundId,
          categoryCode: category.code,
          counterpartyType: member ? "회원" : input.counterpartyType,
          counterpartyMemberNo: member?.memberNo ?? null,
          counterpartyName: input.counterpartyName,
          method: input.method,
          // ★ 적요에 회원 실명을 적지 않는다(감사 C14). 회원번호로 남긴다.
          memo: [category.name, member ? `회원 ${member.memberNo}` : "", input.memo]
            .filter(Boolean)
            .join(" / ")
            .slice(0, 200),
          externalRef: input.externalRef,
          status: "POSTED", // ★ 직접 입력은 언제나 확정. 미비점은 배지로 드러낸다
          relatedParty,
          enteredBy: me.email,
          verifiedBy: input.verifiedBy,
          verifiedAt: input.verifiedBy ? new Date() : null,
          evidenceUrl: input.evidenceUrl,
        },
      });

      /* ── 회비 수납이면 06_회비고지를 같은 트랜잭션에서 갱신 ──
         안 하면 감사 C7 과 prisma/verify.ts 의 회비 대사가 영원히 어긋나고,
         이미 낸 회원에게 독촉이 나간다. */
      let duesNote = "";
      if (member && input.direction === "IN" && category.code === prep.duesCategory) {
        const inv = await tx.duesInvoice.findUnique({
          where: { fiscalYear_memberNo: { fiscalYear: fy, memberNo: member.memberNo } },
        });
        if (inv) {
          const paid = inv.paidAmount + prep.amountPhp;
          // 미납금액을 0 으로 깎지 않는다. `미납 = 고지 - 납부` 항등식이 깨진다. 음수 = 과납.
          const unpaid = inv.billedAmount - paid;
          await tx.duesInvoice.update({
            where: { invoiceId: inv.invoiceId },
            data: {
              paidAmount: paid,
              unpaidAmount: unpaid,
              status: inv.status === "면제" ? "면제" : unpaid <= 0 ? "완납" : "부분납",
              lastReceiptNo: receiptNo,
              lastPaidOn: input.date,
            },
          });
          // 회원 기간 (대표 결정 2026-10-21) — 이 수납으로 완납에 닿았으면 그 날부터 1년(이어붙이기 포함).
          // 이미 기간이 있는 완납 고지에 더 낸 돈(과납)은 기간을 바꾸지 않는다 — syncMembershipPeriod 참조.
          const periodChange = await syncMembershipPeriod(tx, inv.invoiceId, {
            actor: me.email,
            via: `장부 수납 ${receiptNo}`,
            duesCategory: prep.duesCategory,
          });
          duesNote =
            (unpaid > 0
              ? ` 회비 ${formatMoney(unpaid)}페소가 남았습니다.`
              : unpaid < 0
                ? ` 회비 완납 + ${formatMoney(-unpaid)}페소 과납입니다.`
                : " 회비 완납입니다.") + periodChangeNote(periodChange);
        } else {
          duesNote = ` ${fy}년 회비고지가 없는 회원입니다.`;
        }
      }

      /* ── 행사 정산 연결 ──
         이 필드는 지금까지 시드만 채웠고 임원 화면에 쓰는 경로가 없었다.
         그래서 공개 페이지의 "행사별 정산" 이 운영 중에는 영원히 비어 있었다. */
      if (event) {
        const nos = event.settlementReceiptNos.split(",").map((s) => s.trim()).filter(Boolean);
        if (!nos.includes(receiptNo)) {
          await tx.event.update({
            where: { eventId: event.eventId },
            data: { settlementReceiptNos: [...nos, receiptNo].join(",") },
          });
        }
      }

      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Transaction",
        recordKey: receiptNo,
        changeType: "INSERT",
        // 이해관계자 건은 INFO 로 묻히면 안 된다. 감사가 로그만 훑어도 눈에 띄어야 한다.
        severity: relatedParty ? "WARN" : "INFO",
        afterValue: `${input.direction} ${prep.amountPhp} ${input.currency} / ${input.method} / ${account.accountId} / POSTED`,
        note:
          `장부 직접 입력 (${me.officerId} ${me.role}) — ${input.counterpartyName}` +
          (verdict?.reasons.length ? ` [이해상충: ${verdict.reasons[0]}]` : "") +
          (event ? ` [행사 ${event.title}]` : ""),
      });

      return { receiptNo, duesNote, eventTitle: event?.title ?? "" };
    });

    revalidatePath(`${ROUTES.officer}/book`);
    revalidatePath(`${ROUTES.officer}/audit`);
    revalidatePath(ROUTES.officer);
    revalidatePath(ROUTES.ledger);

    return ok(
      `${created.receiptNo} 로 적었습니다.` +
        created.duesNote +
        (created.eventTitle ? ` 행사 "${created.eventTitle}" 정산에 묶었습니다.` : "") +
        (relatedParty ? " ⚠ 이해관계 건으로 감사 확인 대기에 올렸습니다." : ""),
      { receiptNo: created.receiptNo },
    );
  } catch (e) {
    return toActionError(e);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 수정
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 이미 적은 줄을 고친다.
 *
 * ★ 영수증번호·회계연도·일련번호는 바꾸지 않는다. 바꾸면 I2(결번 없음)가 무너진다.
 * ★ 마감된 회계연도는 못 고친다(I5). **원래 날짜와 새 날짜 양쪽**을 검사한다 —
 *   한쪽만 보면 마감된 연도의 거래를 열린 연도로 끌어내 고칠 수 있다.
 * ★ 회비 수납의 금액을 고치면 06_회비고지가 어긋나므로, 회비 건은 금액 수정을 막는다.
 *   (무효 후 다시 적으면 대사가 정상적으로 다시 계산된다)
 */
export async function editEntryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireOfficer({ permissions: ["입력권"], write: true, screen: "장부 수정" });

    const parsed = bookEditSchema.safeParse({ ...readEntry(fd), receiptNo: fdStr(fd, "receiptNo") });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const input = parsed.data;

    if (input.date > todayManila()) return fail("미래 날짜로는 적을 수 없습니다.");

    const prep = await prepare(input.currency, input.amount);
    if (isActionState(prep)) return prep;

    const verdict =
      input.direction === "OUT" ? await judgeConflict(input.counterpartyName, input.vendorId) : null;
    const relatedParty = !!verdict && (verdict.related || verdict.undetermined);

    const edited = await prisma.$transaction(async (tx) => {
      const before = await tx.transaction.findUnique({ where: { receiptNo: input.receiptNo } });
      if (!before) throw new Error(`거래 ${input.receiptNo} 를 찾을 수 없습니다.`);
      if (before.status === "VOIDED") {
        throw new Error("무효 처리된 거래는 고칠 수 없습니다. 새로 적어 주십시오.");
      }

      await assertFyOpen(tx, before.date); // 원래 날짜의 연도가 열려 있는가
      const fy = await assertFyOpen(tx, input.date); // 새 날짜의 연도도 열려 있는가
      if (fy !== before.fiscalYear) {
        throw new Error(
          `회계연도를 넘겨서 옮길 수 없습니다(${before.fiscalYear} → ${fy}). 무효 처리 후 새로 적어 주십시오.`,
        );
      }

      const [account, fund, category] = await Promise.all([
        tx.account.findUnique({ where: { accountId: input.accountId } }),
        tx.fund.findUnique({ where: { fundId: input.fundId } }),
        tx.category.findUnique({ where: { code: input.categoryCode } }),
      ]);
      if (!account || account.status !== "ACTIVE") throw new Error("계좌를 확인해 주십시오.");
      if (!fund) throw new Error(`03_기금에 없는 기금ID 입니다: ${input.fundId}`);
      if (!category) throw new Error(`04_과목에 없는 과목코드입니다: ${input.categoryCode}`);
      const want = input.direction === "IN" ? "수입" : "지출";
      if (category.majorType !== want) {
        throw new Error(`"${category.name}" 은 ${category.majorType} 과목입니다.`);
      }

      // 다른 과목 → 회비로 바꾸는데 회원이 연결돼 있지 않으면 막는다.
      // 수정 화면은 회원 연결을 바꾸지 못하므로, 여기서 통과시키면 회원 없는 회비가 생긴다.
      // (원래부터 회비였던 줄의 메모·날짜 수정은 막지 않는다)
      if (duesRecategorizeBlocked(before, category.code, prep.duesCategory)) {
        throw new Error(
          "회비는 납부한 회원을 연결해야 합니다. 수정으로는 회원을 연결할 수 없으니, 이 줄을 무효 처리한 뒤 상대방 목록에서 회원을 골라 새로 적어 주십시오.",
        );
      }

      // 회비 수납은 06_회비고지.납부금액에 이미 반영돼 있다. 금액을 여기서 고치면 대사가 깨진다.
      if (
        before.counterpartyMemberNo &&
        before.categoryCode === prep.duesCategory &&
        before.amountPhp !== prep.amountPhp
      ) {
        throw new Error(
          "회비 수납의 금액은 여기서 고칠 수 없습니다. 무효 처리한 뒤 올바른 금액으로 새로 적어 주십시오. (회비고지 대사가 어긋납니다)",
        );
      }

      await tx.transaction.update({
        where: { receiptNo: input.receiptNo },
        data: {
          date: input.date,
          direction: input.direction,
          amount: input.amount,
          currency: input.currency,
          fxRate: prep.fxRate,
          amountPhp: prep.amountPhp,
          accountId: account.accountId,
          fundId: fund.fundId,
          categoryCode: category.code,
          counterpartyName: input.counterpartyName,
          counterpartyType: input.counterpartyType,
          method: input.method,
          memo: input.memo.slice(0, 200),
          externalRef: input.externalRef,
          relatedParty,
          // 감사 확인 도장은 "그때 그 내용" 에 찍은 것이다. 내용이 바뀌면 무효로 되돌린다.
          reviewedBy: "",
          reviewedAt: null,
        },
      });

      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Transaction",
        recordKey: input.receiptNo,
        fieldName: "(장부 수정)",
        beforeValue: `${before.date} ${before.direction} ${before.amountPhp} ${before.categoryCode} ${before.counterpartyName}`,
        afterValue: `${input.date} ${input.direction} ${prep.amountPhp} ${input.categoryCode} ${input.counterpartyName}`,
        changeType: "EDIT",
        // 금액이 바뀐 수정은 CRITICAL. 공개한 숫자가 사후에 바뀌는 일이다.
        severity: before.amountPhp !== prep.amountPhp ? "CRITICAL" : "WARN",
        note: `장부 수정 (${me.officerId} ${me.role})` + (before.reviewedAt ? " — 감사 확인 후 수정됨" : ""),
      });

      /* ── 회원 기간은 수정으로 다시 계산하지 않는다 ──
         회비 수납의 날짜를 고쳐도 이미 정해진 회원 기간(완납일부터 1년)은 그대로다. 다시 계산하면
         그 뒤에 이어붙은 기간까지 연쇄로 흔들린다. 대신 알린다 — 바로잡는 길은 무효 후 재입력이고,
         그러면 무효에서 기간이 지워지고 재입력에서 새 날짜로 다시 정해진다. */
      let periodWarn = "";
      if (
        before.counterpartyMemberNo &&
        before.direction === "IN" &&
        before.categoryCode === prep.duesCategory &&
        before.date !== input.date
      ) {
        const inv = await tx.duesInvoice.findUnique({
          where: {
            fiscalYear_memberNo: { fiscalYear: before.fiscalYear, memberNo: before.counterpartyMemberNo },
          },
          select: { invoiceId: true, validFrom: true, validUntil: true },
        });
        if (inv?.validFrom && inv.validUntil) {
          periodWarn =
            ` ⚠ 회원 기간(${formatPeriod({ validFrom: inv.validFrom, validUntil: inv.validUntil })})은 날짜를 고쳐도 바뀌지 않습니다.` +
            " 기간도 바로잡으려면 이 줄을 무효 처리한 뒤 올바른 날짜로 새로 적어 주십시오.";
          await appendAuditLog(tx, {
            actor: me.email,
            tableName: "DuesInvoice",
            recordKey: inv.invoiceId,
            fieldName: "validFrom~validUntil",
            beforeValue: `${inv.validFrom} ~ ${inv.validUntil}`,
            afterValue: `${inv.validFrom} ~ ${inv.validUntil}`,
            changeType: "OTHER",
            severity: "WARN",
            relatedKey: before.counterpartyMemberNo,
            note: `회비 수납 ${input.receiptNo} 날짜 수정(${before.date} → ${input.date}) — 회원 기간은 다시 계산하지 않음`,
          });
        }
      }
      return { periodWarn };
    });

    revalidatePath(`${ROUTES.officer}/book`);
    revalidatePath(`${ROUTES.officer}/audit`);
    revalidatePath(ROUTES.ledger);
    return ok(`${input.receiptNo} 를 고쳤습니다. 감사 확인 대기로 다시 올라갑니다.` + edited.periodWarn);
  } catch (e) {
    return toActionError(e);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 무효 (I1)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 무효 처리. **행을 지우지 않는다.**
 *
 * 지우면 공개 장부에서 "그런 지출이 있었다" 는 사실 자체가 사라진다.
 * 회비·거래를 참조하는 다른 행(회비고지·행사신청)도 맥락을 잃는다.
 * 그래서 status 만 VOIDED 로 바꾸고 사유를 남긴다. 공개 화면에는 줄이 그어진 채 보인다.
 */
export async function voidEntryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireOfficer({ permissions: ["입력권"], write: true, screen: "장부 무효" });

    const parsed = voidInputSchema.safeParse({
      receiptNo: fdStr(fd, "receiptNo"),
      reason: fdStr(fd, "reason"),
      reversalDate: fdStr(fd, "reversalDate") || todayManila(),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const input = parsed.data;

    const voided = await prisma.$transaction(async (tx) => {
      const before = await tx.transaction.findUnique({ where: { receiptNo: input.receiptNo } });
      if (!before) throw new Error(`거래 ${input.receiptNo} 를 찾을 수 없습니다.`);
      if (before.status === "VOIDED") throw new Error("이미 무효 처리된 거래입니다.");
      await assertFyOpen(tx, before.date); // I5

      await tx.transaction.update({
        where: { receiptNo: input.receiptNo },
        data: { status: "VOIDED", voidReason: input.reason, reviewedBy: "", reviewedAt: null },
      });

      /* ── 회비 수납을 무효로 하면 06_회비고지를 되돌린다 ──
         안 되돌리면 "돈은 안 받았는데 완납" 인 회원이 생기고, 그 사람은 독촉을 영영 안 받는다.
         완납이 부분납·미납으로 돌아가면 회원 기간도 같이 지운다(회원증 무효). */
      let periodNote = "";
      if (before.counterpartyMemberNo && before.direction === "IN") {
        const inv = await tx.duesInvoice.findUnique({
          where: {
            fiscalYear_memberNo: {
              fiscalYear: before.fiscalYear,
              memberNo: before.counterpartyMemberNo,
            },
          },
        });
        if (inv && inv.lastReceiptNo === before.receiptNo) {
          const paid = Math.max(0, inv.paidAmount - before.amountPhp);
          const unpaid = inv.billedAmount - paid;
          await tx.duesInvoice.update({
            where: { invoiceId: inv.invoiceId },
            data: {
              paidAmount: paid,
              unpaidAmount: unpaid,
              status: inv.status === "면제" ? "면제" : unpaid <= 0 ? "완납" : paid > 0 ? "부분납" : "미납",
              // ★ "" 가 아니라 null. lastReceiptNo 는 05_거래를 가리키는 외래키라
              //   "" 를 넣으면 FK 위반으로 무효 처리 전체가 롤백된다(DuesInvoice_lastReceiptNo_fkey).
              lastReceiptNo: null,
            },
          });
          periodNote = periodChangeNote(
            await syncMembershipPeriod(tx, inv.invoiceId, {
              actor: me.email,
              via: `장부 무효 ${input.receiptNo}`,
            }),
          );
        }
      }

      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "Transaction",
        recordKey: input.receiptNo,
        fieldName: "status",
        beforeValue: before.status,
        afterValue: "VOIDED",
        changeType: "EDIT",
        severity: "CRITICAL",
        note: `장부 무효 (${me.officerId} ${me.role}) — ${input.reason}`,
      });
      return { periodNote };
    });

    revalidatePath(`${ROUTES.officer}/book`);
    revalidatePath(`${ROUTES.officer}/audit`);
    revalidatePath(ROUTES.ledger);
    return ok(
      `${input.receiptNo} 를 무효 처리했습니다. 행은 사유와 함께 장부에 남습니다.` + voided.periodNote,
    );
  } catch (e) {
    return toActionError(e);
  }
}
