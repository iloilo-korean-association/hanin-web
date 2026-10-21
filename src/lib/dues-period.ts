/**
 * 회비고지 ↔ 회원 기간 동기화 — 고지를 쓴 **직후, 같은 트랜잭션에서** 부른다.
 *
 * 계산 규칙은 전부 domain/membershipPeriod.ts 에 있다(순수 함수). 이 파일은 DB 를 읽어
 * 그 함수에 넘기고, 결과를 쓰고, 감사로그를 남기는 일만 한다.
 *
 * ── 하는 일 (고지 한 건) ────────────────────────────────────────────────
 *   완납·면제인데 기간 없음   → 기간을 정해 쓴다 (INFO)
 *                               기산일 = completionDateOf: 면제는 고지일, 완납은 장부 회비 수납을
 *                               날짜순으로 쌓아 고지금액에 처음 닿은 날(없으면 최종수납일)
 *                               이어붙이기 기준 = 그 회원의 **다른** 고지들의 기간
 *   미납·부분납인데 기간 있음 → 기간을 지운다 (WARN)
 *   그 밖                     → 아무것도 안 한다. ★ 이미 기간이 있는 완납 고지에 추가 수납(과납)이
 *                               들어와도 기간은 그대로다.
 *
 * ── 되돌림의 한계 (일부러 단순하게 둔 것) ────────────────────────────────
 *  지운 기간 **뒤에 이어붙은** 다른 고지의 기간은 고치지 않는다. 그 고지는 그 자체로 완납이고,
 *  회원이 이미 그 날짜가 찍힌 회원증을 인쇄했을 수 있다. 대신 감사로그 WARN 과 화면 안내로
 *  알린다 — 바로잡으려면 그 고지의 수납을 무효 처리한 뒤 같은 날짜로 다시 적으면 기간이 다시
 *  계산된다(이번에는 지워진 기간이 없으므로 완납일부터).
 *
 * server-only — 백필 스크립트(prisma/)는 이 파일 대신 domain 의 순수 함수를 직접 쓴다.
 */
import "server-only";

import { appendAuditLog } from "@/lib/audit";
import type { Db } from "@/lib/db";
import {
  addDays,
  cfgStr,
  completionDateOf,
  formatPeriod,
  grantsMembership,
  loadSettings,
  nextPeriod,
  type MembershipPeriod,
} from "@/lib/domain";

export type PeriodChange =
  | {
      kind: "granted";
      invoiceId: string;
      period: MembershipPeriod;
      completedOn: string;
      /** 다른 고지의 기간 뒤에 이어붙었는가 */
      chained: boolean;
    }
  | {
      kind: "cleared";
      invoiceId: string;
      period: MembershipPeriod;
      /** 지운 기간 바로 다음 날부터 시작하는(=이어붙어 있던) 다른 고지 — 고치지 않고 남겨 둔다 */
      chainedAfter: string[];
    }
  | { kind: "none" };

export async function syncMembershipPeriod(
  db: Db,
  invoiceId: string,
  ctx: {
    actor: string;
    /** 감사로그에 남길 경로 설명. 예: "장부 수납 IKA-2026-000085" */
    via: string;
    /** 설정 '기본.과목코드.회비'. 호출자가 이미 읽었으면 넘긴다(아니면 여기서 읽는다) */
    duesCategory?: string;
  },
): Promise<PeriodChange> {
  const inv = await db.duesInvoice.findUnique({
    where: { invoiceId },
    select: {
      invoiceId: true,
      memberNo: true,
      fiscalYear: true,
      status: true,
      billedAmount: true,
      billedOn: true,
      lastPaidOn: true,
      validFrom: true,
      validUntil: true,
    },
  });
  if (!inv) return { kind: "none" };

  const grants = grantsMembership(inv.status);

  /* ── 부여 ── */
  if (grants && !inv.validFrom) {
    let receipts: { date: string; seq: number; amountPhp: number }[] = [];
    if (inv.status === "완납") {
      const duesCategory =
        ctx.duesCategory ?? cfgStr(await loadSettings(db), "기본.과목코드.회비", "R100");
      receipts = await db.transaction.findMany({
        where: {
          counterpartyMemberNo: inv.memberNo,
          fiscalYear: inv.fiscalYear,
          status: "POSTED",
          direction: "IN",
          categoryCode: duesCategory,
        },
        select: { date: true, seq: true, amountPhp: true },
      });
    }
    const completion = completionDateOf({ ...inv, receipts });
    if (!completion) return { kind: "none" };

    const others = await db.duesInvoice.findMany({
      where: { memberNo: inv.memberNo, invoiceId: { not: inv.invoiceId }, validFrom: { not: null } },
      select: { validFrom: true, validUntil: true },
    });
    const period = nextPeriod({ completedOn: completion.date, existingPeriods: others });
    const chained = period.validFrom !== completion.date;

    await db.duesInvoice.update({
      where: { invoiceId: inv.invoiceId },
      data: { validFrom: period.validFrom, validUntil: period.validUntil },
    });
    await appendAuditLog(db, {
      actor: ctx.actor,
      tableName: "DuesInvoice",
      recordKey: inv.invoiceId,
      fieldName: "validFrom~validUntil",
      beforeValue: "(없음)",
      afterValue: `${period.validFrom} ~ ${period.validUntil}`,
      changeType: "EDIT",
      severity: "INFO",
      relatedKey: inv.memberNo,
      note:
        `회원 기간 부여 — ${ctx.via}. ${inv.status}, 기산일 ${completion.date}(${completion.source})` +
        (chained ? ", 기존 기간 만료일 다음 날로 이어붙임" : ""),
    });
    return { kind: "granted", invoiceId: inv.invoiceId, period, completedOn: completion.date, chained };
  }

  /* ── 되돌림 ── */
  if (!grants && inv.validFrom) {
    const period: MembershipPeriod = {
      validFrom: inv.validFrom,
      validUntil: inv.validUntil ?? inv.validFrom,
    };
    const nextDay = addDays(period.validUntil, 1);
    const later = await db.duesInvoice.findMany({
      where: { memberNo: inv.memberNo, invoiceId: { not: inv.invoiceId }, validFrom: nextDay },
      select: { invoiceId: true },
    });
    const chainedAfter = later.map((l) => l.invoiceId);

    await db.duesInvoice.update({
      where: { invoiceId: inv.invoiceId },
      data: { validFrom: null, validUntil: null },
    });
    await appendAuditLog(db, {
      actor: ctx.actor,
      tableName: "DuesInvoice",
      recordKey: inv.invoiceId,
      fieldName: "validFrom~validUntil",
      beforeValue: `${period.validFrom} ~ ${period.validUntil}`,
      afterValue: "(지움)",
      changeType: "EDIT",
      severity: "WARN",
      relatedKey: inv.memberNo,
      note:
        `회원 기간 삭제 — ${ctx.via}. 고지 상태가 ${inv.status}(으)로 돌아감` +
        (chainedAfter.length
          ? `. ⚠ 이 기간 뒤에 이어붙은 ${chainedAfter.join(", ")} 의 기간은 고치지 않고 남김 — 총무 확인 필요`
          : ""),
    });
    return { kind: "cleared", invoiceId: inv.invoiceId, period, chainedAfter };
  }

  return { kind: "none" };
}

/** 액션 결과 문장에 덧붙일 안내. 바뀐 것이 없으면 "". 앞에 공백 하나를 붙여 돌려준다. */
export function periodChangeNote(change: PeriodChange): string {
  if (change.kind === "granted") {
    return (
      ` 회원 기간 ${formatPeriod(change.period)}` +
      (change.chained ? "(기존 기간에 이어붙임)" : "") +
      " 이 정해졌습니다."
    );
  }
  if (change.kind === "cleared") {
    return (
      ` 회원 기간(${formatPeriod(change.period)})을 지웠습니다 — 회원증이 무효가 됩니다.` +
      (change.chainedAfter.length
        ? ` ⚠ 이 기간 뒤에 이어붙은 ${change.chainedAfter.join(", ")} 의 기간은 그대로 두었습니다. ` +
          "바로잡으려면 그 고지의 수납을 무효 처리한 뒤 같은 날짜로 다시 적어 주십시오."
        : "")
    );
  }
  return "";
}
