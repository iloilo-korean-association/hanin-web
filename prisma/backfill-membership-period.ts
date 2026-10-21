/* eslint-disable no-console */
/**
 * 회원 기간 백필 — 완납·면제인데 기간(validFrom/validUntil)이 비어 있는 06_회비고지를 채운다.
 *
 *   드라이런(기본):  npx tsx prisma/backfill-membership-period.ts
 *   실제 적용     :  npx tsx prisma/backfill-membership-period.ts --apply
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────
 *  대표 결정 2026-10-21 로 회원 자격이 "회계연도" 에서 "회비 완납일부터 1년" 으로 바뀌었다.
 *  새 코드는 완납·면제가 되는 순간 기간을 쓰지만(src/lib/dues-period.ts), 그 전에 이미 완납·면제였던
 *  고지에는 기간이 없다 → 새 코드에서는 회원증이 "회비 납부 후 발급됩니다" 로 막힌다.
 *  마이그레이션 20261021000000_dues_membership_period 를 적용한 **뒤에** 돌린다.
 *
 * ── 규칙 (src/lib/domain/membershipPeriod.ts 의 순수 함수만 쓴다 — 서버 액션과 같은 계산) ──
 *  완납일 = 장부 회비 수납(POSTED·IN·회비 과목·그 회원·그 회계연도)을 날짜순으로 쌓아
 *           고지금액에 처음 닿은 날. 장부로 셀 수 없으면 lastPaidOn, 그것도 없으면 billedOn.
 *  면제   = billedOn.
 *  회원별로 **완납일 순서대로** nextPeriod 를 적용한다(이어붙이기). 이미 기간이 있는 고지는
 *  건드리지 않고 기준으로만 쓴다.
 *
 * ── 안전장치 ────────────────────────────────────────────────────────────
 *  ① 드라이런 기본 — --apply 가 없으면 SELECT 만 한다. 마이그레이션 전이어도 돈다
 *     (새 컬럼이 없으면 "전부 비어 있음" 으로 보고 계산만 보여 준다).
 *  ② 비어 있는 칸만 채운다 — UPDATE … WHERE validFrom IS NULL. 이미 있는 기간은 덮어쓰지 않는다.
 *     계획한 건수와 실제 갱신 건수가 다르면 통째로 롤백한다. 몇 번을 돌려도 같은 결과다(멱등).
 *  ③ 감사로그 1건(배치, changeType SCRIPT). 고지별 기간은 note 에 남긴다.
 *  지우는 일이 없으므로 db-guard(파괴적 명령 가드)는 걸지 않는다. 대신 대상 호스트를 먼저 찍는다.
 */
import { PrismaClient } from "@prisma/client";

import {
  activePeriod,
  planPeriodBackfill,
  type BackfillInvoice,
  type DuesReceiptLike,
} from "../src/lib/domain/membershipPeriod";
import { todayManila } from "../src/lib/domain/money";

const APPLY = process.argv.includes("--apply");
const ACTOR = "backfill-membership-period";

const prisma = new PrismaClient();

function targetHost(): string {
  const url = process.env.DATABASE_URL ?? "";
  try {
    const u = new URL(url);
    return `${u.hostname}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(DATABASE_URL 을 읽지 못함)";
  }
}

async function hasPeriodColumns(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'DuesInvoice' AND column_name IN ('validFrom', 'validUntil')`;
  return rows.length === 2;
}

async function main(): Promise<void> {
  const today = todayManila();
  console.log(`회원 기간 백필 — ${APPLY ? "★ 적용 모드 (--apply)" : "드라이런 (읽기만)"}`);
  console.log(`대상 DB : ${targetHost()}`);
  console.log(`오늘(마닐라): ${today}\n`);

  const columns = await hasPeriodColumns();
  if (!columns) {
    if (APPLY) {
      console.error(
        "✕ DuesInvoice.validFrom/validUntil 컬럼이 없습니다. 마이그레이션(20261021000000_dues_membership_period)을 먼저 적용하십시오.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("ⓘ 새 컬럼이 아직 없습니다(마이그레이션 전). 모든 고지의 기간을 '비어 있음' 으로 보고 계산만 합니다.\n");
  }

  const duesCategory =
    (await prisma.setting.findUnique({ where: { key: "기본.과목코드.회비" }, select: { value: true } }))?.value?.trim() ||
    "R100";

  // ★ 컬럼이 없을 수 있으므로 select 를 명시한다(전체 컬럼 SELECT 는 마이그레이션 전 DB 에서 실패한다).
  const baseSelect = {
    invoiceId: true,
    memberNo: true,
    memberName: true,
    fiscalYear: true,
    status: true,
    billedAmount: true,
    paidAmount: true,
    billedOn: true,
    lastPaidOn: true,
  } as const;
  const invoices = columns
    ? await prisma.duesInvoice.findMany({
        select: { ...baseSelect, validFrom: true, validUntil: true },
        orderBy: [{ memberNo: "asc" }, { fiscalYear: "asc" }],
      })
    : (
        await prisma.duesInvoice.findMany({
          select: baseSelect,
          orderBy: [{ memberNo: "asc" }, { fiscalYear: "asc" }],
        })
      ).map((r) => ({ ...r, validFrom: null as string | null, validUntil: null as string | null }));

  const receipts = await prisma.transaction.findMany({
    where: {
      status: "POSTED",
      direction: "IN",
      categoryCode: duesCategory,
      counterpartyMemberNo: { not: null },
    },
    select: { receiptNo: true, date: true, seq: true, amountPhp: true, fiscalYear: true, counterpartyMemberNo: true },
  });
  const receiptsBy = new Map<string, (DuesReceiptLike & { receiptNo: string })[]>();
  for (const r of receipts) {
    const key = `${r.counterpartyMemberNo}|${r.fiscalYear}`;
    const arr = receiptsBy.get(key);
    const row = { receiptNo: r.receiptNo, date: r.date, seq: r.seq, amountPhp: r.amountPhp };
    if (arr) arr.push(row);
    else receiptsBy.set(key, [row]);
  }

  const rows: BackfillInvoice[] = invoices.map((inv) => ({
    invoiceId: inv.invoiceId,
    memberNo: inv.memberNo,
    fiscalYear: inv.fiscalYear,
    status: inv.status,
    billedAmount: inv.billedAmount,
    billedOn: inv.billedOn,
    lastPaidOn: inv.lastPaidOn,
    validFrom: inv.validFrom,
    validUntil: inv.validUntil,
    receipts: receiptsBy.get(`${inv.memberNo}|${inv.fiscalYear}`) ?? [],
  }));

  const plan = planPeriodBackfill(rows);

  /* ── 현황 ── */
  const byStatus = new Map<string, number>();
  for (const inv of invoices) byStatus.set(inv.status, (byStatus.get(inv.status) ?? 0) + 1);
  const already = invoices.filter((i) => i.validFrom).length;
  console.log(`회비 과목코드(설정 '기본.과목코드.회비'): ${duesCategory}`);
  console.log(
    `회비고지 ${invoices.length}건 — ` +
      [...byStatus.entries()].map(([s, n]) => `${s} ${n}`).join(" · ") +
      ` · 이미 기간 있음 ${already}`,
  );
  console.log(`채울 고지: ${plan.length}건\n`);

  if (plan.length > 0) {
    const invById = new Map(invoices.map((i) => [i.invoiceId, i]));
    console.log("고지ID        회원    회계연도 상태  고지      납부      최종수납일   완납일(근거)              → 회원 기간");
    for (const p of plan) {
      const inv = invById.get(p.invoiceId)!;
      const ledger = receiptsBy.get(`${p.memberNo}|${p.fiscalYear}`) ?? [];
      console.log(
        [
          p.invoiceId.padEnd(13),
          p.memberNo.padEnd(7),
          String(p.fiscalYear).padEnd(8),
          p.status.padEnd(4),
          `₱${inv.billedAmount}`.padEnd(9),
          `₱${inv.paidAmount}`.padEnd(9),
          (inv.lastPaidOn ?? "—").padEnd(12),
          `${p.completedOn}(${p.source})`.padEnd(24),
          `→ ${p.period.validFrom} ~ ${p.period.validUntil}${p.chained ? " (이어붙임)" : ""}`,
        ].join(" "),
      );
      if (ledger.length > 0) {
        console.log(
          `              장부 회비 수납 ${ledger.length}건: ` +
            ledger.map((r) => `${r.receiptNo} ${r.date} ₱${r.amountPhp}`).join(", "),
        );
      }
    }

    // 백필 뒤 오늘 기준 회원증 기간(사진·회원 상태는 별도) — 확인용
    console.log("\n백필 후 오늘 기준 회원 기간 (회원증 판정의 기간 부분만):");
    const members = [...new Set(plan.map((p) => p.memberNo))].sort();
    for (const m of members) {
      const periods = [
        ...invoices.filter((i) => i.memberNo === m && i.validFrom),
        ...plan.filter((p) => p.memberNo === m).map((p) => p.period),
      ];
      const active = activePeriod(periods, today);
      console.log(`  ${m}: ${active ? `유효 ${active.validFrom} ~ ${active.validUntil}` : "오늘 유효한 기간 없음"}`);
    }
  }

  if (!APPLY) {
    console.log("\n드라이런 종료 — 아무것도 바꾸지 않았습니다. 적용하려면 --apply 를 붙이십시오.");
    return;
  }
  if (plan.length === 0) {
    console.log("\n채울 것이 없습니다. 아무것도 바꾸지 않았습니다.");
    return;
  }

  /* ── 적용 ── */
  const now = new Date();
  await prisma.$transaction(
    async (tx) => {
      let updated = 0;
      for (const p of plan) {
        const res = await tx.duesInvoice.updateMany({
          where: { invoiceId: p.invoiceId, validFrom: null },
          data: { validFrom: p.period.validFrom, validUntil: p.period.validUntil },
        });
        updated += res.count;
      }
      if (updated !== plan.length) {
        throw new Error(
          `계획 ${plan.length}건 중 ${updated}건만 갱신됐습니다(그 사이 다른 경로가 기간을 썼을 수 있음). 롤백했습니다 — 다시 드라이런부터 돌려 주십시오.`,
        );
      }

      // 감사로그 1건 (lib/audit.ts 와 같은 채번 관례 — server-only 라 직접 못 쓴다)
      const last = await tx.auditLog.findFirst({ orderBy: { logId: "desc" }, select: { logId: true } });
      const n = last ? Number(last.logId.replace(/\D/g, "")) + 1 : 1;
      const detail = plan
        .map((p) => `${p.invoiceId} ${p.period.validFrom}~${p.period.validUntil}`)
        .join(", ");
      await tx.auditLog.create({
        data: {
          logId: "AU-" + String(n).padStart(6, "0"),
          occurredAt: now,
          actor: ACTOR,
          tableName: "DuesInvoice",
          recordKey: plan.length === 1 ? plan[0].invoiceId : `${plan[0].invoiceId}…${plan[plan.length - 1].invoiceId}`,
          fieldName: "validFrom~validUntil",
          beforeValue: "(없음)",
          afterValue: `${plan.length}건 회원 기간 부여`,
          changeType: "SCRIPT",
          severity: "INFO",
          relatedKey: "",
          note: `회원 기간 백필 (대표 결정 2026-10-21, 완납일부터 1년) — ${detail}`.slice(0, 500),
        },
      });
    },
    { timeout: 120_000 },
  );

  const after = await prisma.duesInvoice.findMany({
    where: { invoiceId: { in: plan.map((p) => p.invoiceId) } },
    select: { invoiceId: true, validFrom: true, validUntil: true },
  });
  console.log(`\n✓ 적용 완료 — ${after.length}건`);
  for (const a of after) console.log(`  ${a.invoiceId}: ${a.validFrom} ~ ${a.validUntil}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
