/**
 * 회비고지 일괄 생성 — 계획에 필요한 행을 읽어 planDuesInvoices 에 넘긴다.
 *
 * ★ 화면(미리보기)과 액션(실제 생성)이 **같은 함수**로 읽는다.
 *   둘이 각자 쿼리를 쓰면 미리보기에서 본 명단과 실제로 만들어지는 명단이 어긋난다.
 *   액션은 이것을 $transaction 안에서 tx 로 다시 부른다 — 화면이 보낸 명단은 믿지 않는다.
 *
 * ★ server-only. "use server" 파일(actions.ts)에 두지 않은 이유: 거기서 export 한
 *   async 함수는 전부 브라우저가 부를 수 있는 서버 액션이 된다.
 */
import "server-only";

import type { Db } from "@/lib/db";
import {
  cfgNum,
  cfgStr,
  duesTableFrom,
  fiscalYearOf,
  planDuesInvoices,
  type DuesPlan,
  type SettingMap,
} from "@/lib/domain";

export type DuesContext = {
  fiscalYear: number;
  today: string;
  configuredDue: string;
  duesTable: Record<string, number>;
  duesCategory: string;
};

/** 설정에서 일괄 고지 기준값을 꺼낸다. 기본값은 가입(join/actions.ts)과 같다. */
export function duesContextFrom(settings: SettingMap, today: string): DuesContext {
  const fiscalYear = cfgNum(settings, "회계연도", fiscalYearOf(today));
  return {
    fiscalYear,
    today,
    configuredDue: cfgStr(settings, "회비.납기일", `${fiscalYear}-02-28`),
    duesTable: duesTableFrom(settings),
    duesCategory: cfgStr(settings, "기본.과목코드.회비", "R100"),
  };
}

export async function loadDuesPlan(
  db: Db,
  ctx: DuesContext,
): Promise<{ plan: DuesPlan; existingInvoiceIds: string[] }> {
  const [members, invoices, receipts, existingPeriods] = await Promise.all([
    db.member.findMany({
      where: { status: "ACTIVE" },
      orderBy: { memberNo: "asc" },
      select: { memberNo: true, name: true, duesGrade: true, status: true },
    }),
    // 그 해 고지 전부(회원 상태 무관) — 회원 대조와 고지ID 채번에 같이 쓴다.
    db.duesInvoice.findMany({
      where: { fiscalYear: ctx.fiscalYear },
      select: { invoiceId: true, memberNo: true },
    }),
    // 고지 없이 먼저 받은 회비 — 회원이 연결된 것만. 조건은 planDuesInvoices 가 한 번 더 건다.
    db.transaction.findMany({
      where: {
        fiscalYear: ctx.fiscalYear,
        status: "POSTED",
        direction: "IN",
        categoryCode: ctx.duesCategory,
        counterpartyMemberNo: { not: null },
      },
      select: {
        receiptNo: true,
        date: true,
        seq: true,
        fiscalYear: true,
        status: true,
        direction: true,
        categoryCode: true,
        counterpartyMemberNo: true,
        amountPhp: true,
      },
    }),
    // 이미 회원 기간이 있는 고지(연도 무관) — 완납·면제로 만들어질 고지의 이어붙이기 기준
    db.duesInvoice.findMany({
      where: { validFrom: { not: null } },
      select: { memberNo: true, validFrom: true, validUntil: true },
    }),
  ]);

  const plan = planDuesInvoices({
    fiscalYear: ctx.fiscalYear,
    today: ctx.today,
    configuredDue: ctx.configuredDue,
    duesTable: ctx.duesTable,
    duesCategory: ctx.duesCategory,
    members,
    invoicedMemberNos: invoices.map((i) => i.memberNo),
    receipts,
    existingPeriods,
  });

  return { plan, existingInvoiceIds: invoices.map((i) => i.invoiceId) };
}
