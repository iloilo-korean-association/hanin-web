"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Tx } from "@/lib/db";
import { prisma } from "@/lib/db";
import { newLinkToken, todayManila } from "@/lib/domain";
import { requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";
import { zMemberNo } from "@/lib/validators";

import type { ActionState } from "../../../_lib/action-state";
import { appendAuditLog, fail, fdStr, ok, toActionError } from "../../../_lib/server-utils";

/**
 * 납부자 표기 → 회원 연결 (L4).
 *
 * 엑셀에는 "이름" 만 있다. 그 이름이 누구인지는 총무만 안다. 그래서 세 갈래로 정리한다:
 *   ① 기존 회원 선택      → PayerAlias(kind=회원) + 그 표기의 전 거래 회원번호 일괄 갱신
 *   ② 이 이름으로 회원 생성 → 01_회원 신규 등록 후 ①과 같게 처리
 *   ③ 회원 아님           → PayerAlias(kind=회원아님, memberNo=null)
 *
 * ★ ③ 을 반드시 기록으로 남기는 이유: 교회·선교사협의회 같은 단체를 "판단 안 함" 과
 *   구분하지 않으면 미연결 목록이 영원히 줄지 않고, 총무는 볼 때마다 같은 이름을 다시 본다.
 *
 * ★ 부부 병기("○○/○○")·상호 병기는 **쪼개지 않는다.** 원문 그대로 하나의 표기로 두고
 *   회원 연결만 총무 판단에 맡긴다. 쪼개는 순간 엑셀 합계와 대조가 불가능해진다.
 *
 * ★ 연결하면 06_회비고지를 연도별로 소급 반영한다 → 회원 포털(P2)이 코드 변경 없이 표시한다.
 *   회비수입 블록만 넣는다. 후원·기부는 회비가 아니므로 고지에 넣지 않는다.
 */

const LINK_PATH = `${ROUTES.officer}/ledger-import/link`;

/** 임포트가 만든 회비고지임을 나타내는 표식. 사람이 만든 고지를 덮어쓰지 않기 위한 안전장치다. */
const IMPORT_DUES_NOTE = "장부 임포트 소급 완납";
/** 임포트가 만든 회원임을 나타내는 표식(대표 지시 문구). */
const IMPORT_MEMBER_NOTE = "장부 임포트 생성";

const zAlias = z.string().trim().min(1, "납부자 표기가 비어 있습니다.").max(120);
const zDecision = z.enum(["기존회원", "신규회원", "회원아님"]);

/* ═══════════════════════ 액션 ═══════════════════════ */

export async function decidePayerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["입력권"],
      write: true,
      screen: "납부자 회원 연결",
    });

    const alias = zAlias.parse(fdStr(formData, "alias"));
    const decision = zDecision.parse(fdStr(formData, "decision"));
    const note = fdStr(formData, "note").slice(0, 200);

    /* ── ③ 회원 아님 ── */
    if (decision === "회원아님") {
      const prev = await prisma.payerAlias.findUnique({ where: { alias } });
      const result = await prisma.$transaction(async (tx) => {
        await tx.payerAlias.upsert({
          where: { alias },
          create: { alias, memberNo: null, kind: "회원아님", createdBy: me.email, note },
          update: { memberNo: null, kind: "회원아님", createdBy: me.email, note },
        });
        // 이전에 회원으로 연결돼 있었다면 거래의 회원 표시를 되돌린다.
        const unlinked = prev?.memberNo ? await unlinkTransactions(tx, alias) : 0;
        await appendAuditLog(tx, {
          actor: me.email,
          tableName: "PayerAlias",
          recordKey: alias,
          beforeValue: prev ? `${prev.kind} ${prev.memberNo ?? ""}` : "(미판정)",
          afterValue: "회원아님",
          changeType: prev ? "EDIT" : "INSERT",
          severity: "INFO",
          note: `납부자 표기 판정: 회원 아님 (${me.officerId} ${me.role})${note ? ` — ${note}` : ""}`,
        });
        return { unlinked, hadMember: prev?.memberNo ?? null };
      });

      revalidateLink();
      return ok(
        `"${alias}" 를 회원 아님(단체·오기재)으로 표시했습니다.` +
          (result.hadMember
            ? ` 이전 연결(${result.hadMember})을 해제하고 거래 ${result.unlinked}건의 회원 표시를 지웠습니다. 그 회원의 ${IMPORT_DUES_NOTE} 회비고지가 있으면 총무가 직접 확인해 주십시오.`
            : ""),
      );
    }

    /* ── ①② 회원 연결 ── */
    let memberNo: string;
    let createdNew = false;

    if (decision === "기존회원") {
      memberNo = zMemberNo.parse(fdStr(formData, "memberNo"));
      const member = await prisma.member.findUnique({
        where: { memberNo },
        select: { memberNo: true, status: true },
      });
      if (!member) return fail(`01_회원에 없는 회원번호입니다: ${memberNo}`);
      if (member.status === "WITHDRAWN") {
        return fail(
          `${memberNo} 는 탈퇴 처리된 회원입니다.`,
          "탈퇴 회원에게 과거 납부를 연결하려면 먼저 회원 상태를 확인해 주십시오.",
        );
      }
    } else {
      // ② 신규 생성 — 회원 마스터에 쓰는 일이므로 "회원관리" 권한을 따로 본다.
      if (!me.can("회원관리")) {
        return fail(
          '"회원관리" 권한이 없어 회원을 새로 만들 수 없습니다.',
          "기존 회원을 골라 연결하시거나, 회원관리 권한이 있는 임원에게 요청해 주십시오.",
        );
      }
      memberNo = "";
      createdNew = true;
    }

    const first = await earliestDateFor(alias);

    const result = await prisma.$transaction(async (tx) => {
      if (createdNew) {
        memberNo = await nextMemberNo(tx);
        await tx.member.create({
          data: {
            memberNo,
            name: alias,
            // 가입일은 장부에서 확인되는 **가장 이른 납부일**을 쓴다. 없으면 오늘.
            // 오늘로 찍으면 2021년 납부가 "가입 전 납부" 가 되어 대사가 이상해진다.
            joinedOn: first ?? todayManila(),
            memberType: "정회원",
            status: "ACTIVE",
            duesGrade: "정회원",
            rosterConsent: false,
            notifyConsent: true,
            linkToken: await freshLinkToken(tx),
            note: `${IMPORT_MEMBER_NOTE}${note ? ` — ${note}` : ""}`,
            createdBy: me.email,
          },
        });
      }

      const prev = await tx.payerAlias.findUnique({ where: { alias } });
      await tx.payerAlias.upsert({
        where: { alias },
        create: { alias, memberNo, kind: "회원", createdBy: me.email, note },
        update: { memberNo, kind: "회원", createdBy: me.email, note },
      });

      // 이전에 다른 회원에게 붙어 있었다면 먼저 떼어낸다 — 두 회원에게 같은 돈이 잡히면 안 된다.
      if (prev?.memberNo && prev.memberNo !== memberNo) await unlinkTransactions(tx, alias);

      const linked = await linkTransactions(tx, alias, memberNo);
      const dues = await syncImportDues(tx, memberNo);

      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "PayerAlias",
        recordKey: alias,
        beforeValue: prev ? `${prev.kind} ${prev.memberNo ?? ""}` : "(미판정)",
        afterValue: `회원 ${memberNo}`,
        changeType: prev ? "EDIT" : "INSERT",
        severity: "INFO",
        relatedKey: memberNo,
        note:
          `납부자 표기 회원 연결 (${me.officerId} ${me.role}) — 거래 ${linked}건 갱신, 회비고지 ${dues.years.length}개 연도` +
          (createdNew ? " · 회원 신규 생성" : ""),
      });

      return { linked, dues, prevMemberNo: prev?.memberNo ?? null };
    });

    revalidateLink();
    revalidatePath(ROUTES.ledger);

    const duesNote =
      result.dues.years.length > 0
        ? ` 회비고지 ${result.dues.years.map((y) => `${y.year}년 ₱${y.amount.toLocaleString("en-PH")}`).join(" · ")} 를 소급 완납으로 기록했습니다.`
        : " 아직 반영된 회비 거래가 없어 회비고지는 만들지 않았습니다(반영 후 다시 연결하면 생성됩니다).";
    const skipNote =
      result.dues.skipped.length > 0
        ? ` (사람이 만든 고지 ${result.dues.skipped.join(", ")} 는 고지금액을 덮어쓰지 않고 납부금액만 갱신했습니다.)`
        : "";

    return ok(
      `"${alias}" 를 회원 ${memberNo}${createdNew ? "(신규 생성)" : ""} 에 연결했습니다. 거래 ${result.linked}건의 회원번호를 갱신했습니다.` +
        duesNote +
        skipNote,
    );
  } catch (e) {
    return toActionError(e);
  }
}

function revalidateLink(): void {
  revalidatePath(LINK_PATH);
  revalidatePath(`${ROUTES.officer}/ledger-import`);
  revalidatePath(`${ROUTES.officer}/members`);
}

/* ═══════════════════════ 거래 연결 ═══════════════════════ */

/** 이 표기로 만들어진 임포트 거래의 영수증번호들. 수입(IN)만 본다. */
async function importReceiptsOf(tx: Tx, alias: string): Promise<string[]> {
  const rows = await tx.importRow.findMany({
    where: { payerName: alias, receiptNo: { not: null } },
    select: { receiptNo: true },
  });
  return rows.map((r) => r.receiptNo as string);
}

async function linkTransactions(tx: Tx, alias: string, memberNo: string): Promise<number> {
  const receiptNos = await importReceiptsOf(tx, alias);
  if (receiptNos.length === 0) return 0;
  const res = await tx.transaction.updateMany({
    where: { receiptNo: { in: receiptNos }, direction: "IN" },
    data: { counterpartyMemberNo: memberNo, counterpartyType: "회원" },
  });
  return res.count;
}

async function unlinkTransactions(tx: Tx, alias: string): Promise<number> {
  const receiptNos = await importReceiptsOf(tx, alias);
  if (receiptNos.length === 0) return 0;
  const res = await tx.transaction.updateMany({
    where: { receiptNo: { in: receiptNos }, direction: "IN" },
    data: { counterpartyMemberNo: null, counterpartyType: "비회원" },
  });
  return res.count;
}

/** 이 표기의 임포트 행 중 가장 이른 날짜. 없으면 null. */
async function earliestDateFor(alias: string): Promise<string | null> {
  const row = await prisma.importRow.findFirst({
    where: { payerName: alias, date: { not: null } },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  return row?.date ?? null;
}

/* ═══════════════════════ 회비고지 소급 ═══════════════════════ */

type DuesSync = { years: { year: number; amount: number }[]; skipped: string[] };

/**
 * 이 회원의 **임포트 유래 회비수입 거래**를 연도별로 합산해 06_회비고지를 맞춘다.
 *
 * ★ 회비수입 블록만 센다. 후원금·기부는 회비가 아니다.
 * ★ POSTED 만 센다 — 공개 회계·회원 포털(P2)과 같은 규칙이다. 규칙이 갈라지면
 *   회원 화면의 합계와 회비고지가 서로 다른 숫자를 말하게 된다.
 * ★ 사람이 만든 고지(가입 시 자동 생성 등)의 **고지금액은 덮어쓰지 않는다.**
 *   덮어쓰면 "얼마를 고지했는가" 라는 사실이 사라진다. 납부금액만 갱신한다.
 */
async function syncImportDues(tx: Tx, memberNo: string): Promise<DuesSync> {
  const member = await tx.member.findUnique({
    where: { memberNo },
    select: { name: true, duesGrade: true },
  });
  if (!member) return { years: [], skipped: [] };

  const txs = await tx.transaction.findMany({
    where: {
      counterpartyMemberNo: memberNo,
      status: "POSTED",
      direction: "IN",
      importRows: { some: { blockType: "회비수입" } },
    },
    select: { receiptNo: true, fiscalYear: true, amountPhp: true, date: true },
    orderBy: [{ date: "asc" }, { seq: "asc" }],
  });
  if (txs.length === 0) return { years: [], skipped: [] };

  const byYear = new Map<
    number,
    { amount: number; firstOn: string; lastOn: string; lastReceiptNo: string }
  >();
  for (const t of txs) {
    const cur = byYear.get(t.fiscalYear);
    if (!cur) {
      byYear.set(t.fiscalYear, {
        amount: t.amountPhp,
        firstOn: t.date,
        lastOn: t.date,
        lastReceiptNo: t.receiptNo,
      });
    } else {
      cur.amount += t.amountPhp;
      if (t.date > cur.lastOn) {
        cur.lastOn = t.date;
        cur.lastReceiptNo = t.receiptNo;
      }
      if (t.date < cur.firstOn) cur.firstOn = t.date;
    }
  }

  const years: { year: number; amount: number }[] = [];
  const skipped: string[] = [];

  for (const [year, agg] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const existing = await tx.duesInvoice.findUnique({
      where: { fiscalYear_memberNo: { fiscalYear: year, memberNo } },
    });

    if (!existing) {
      await tx.duesInvoice.create({
        data: {
          invoiceId: await nextInvoiceId(tx, year),
          fiscalYear: year,
          memberNo,
          memberName: member.name,
          duesGrade: member.duesGrade,
          billedAmount: agg.amount,
          currency: "PHP",
          billedOn: agg.firstOn,
          dueOn: agg.lastOn,
          paidAmount: agg.amount,
          unpaidAmount: 0,
          status: "완납",
          lastReceiptNo: agg.lastReceiptNo,
          lastPaidOn: agg.lastOn,
          note: IMPORT_DUES_NOTE,
        },
      });
      years.push({ year, amount: agg.amount });
      continue;
    }

    if (existing.note.includes(IMPORT_DUES_NOTE)) {
      await tx.duesInvoice.update({
        where: { invoiceId: existing.invoiceId },
        data: {
          memberName: member.name,
          billedAmount: agg.amount,
          paidAmount: agg.amount,
          unpaidAmount: 0,
          status: existing.status === "면제" ? "면제" : "완납",
          billedOn: agg.firstOn,
          lastReceiptNo: agg.lastReceiptNo,
          lastPaidOn: agg.lastOn,
        },
      });
      years.push({ year, amount: agg.amount });
      continue;
    }

    // 사람이 만든 고지 — 고지금액은 그대로 두고 납부만 반영한다.
    const unpaid = existing.billedAmount - agg.amount;
    await tx.duesInvoice.update({
      where: { invoiceId: existing.invoiceId },
      data: {
        paidAmount: agg.amount,
        unpaidAmount: unpaid,
        status: existing.status === "면제" ? "면제" : unpaid <= 0 ? "완납" : "부분납",
        lastReceiptNo: agg.lastReceiptNo,
        lastPaidOn: agg.lastOn,
      },
    });
    years.push({ year, amount: agg.amount });
    skipped.push(existing.invoiceId);
  }

  return { years, skipped };
}

/* ═══════════════════════ 채번 ═══════════════════════ */

/**
 * 회원번호 M0001 … — (public)/join/actions.ts 의 nextMemberNo 와 **같은 규칙**이다.
 * (그 파일은 "use server" 라 비동기 액션 말고는 export 할 수 없어서 규칙을 옮겨 적었다.
 *  한쪽을 고치면 다른 쪽도 함께 고쳐야 한다.)
 * ★ M9xxx 시스템 계정 대역은 최대값 계산에서 제외한다.
 */
async function nextMemberNo(tx: Tx): Promise<string> {
  const rows = await tx.member.findMany({ select: { memberNo: true } });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.memberNo.replace(/\D/g, ""));
    if (!Number.isFinite(n)) continue;
    if (n >= 9000) continue;
    if (n > max) max = n;
  }
  return "M" + String(max + 1).padStart(4, "0");
}

async function freshLinkToken(tx: Tx): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const t = newLinkToken();
    const hit = await tx.member.findUnique({ where: { linkToken: t }, select: { memberNo: true } });
    if (!hit) return t;
  }
  throw new Error("링크토큰을 만들지 못했습니다(6회 연속 충돌).");
}

async function nextInvoiceId(tx: Tx, fiscalYear: number): Promise<string> {
  const rows = await tx.duesInvoice.findMany({
    where: { fiscalYear },
    select: { invoiceId: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.invoiceId.split("-").pop() ?? "");
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `DU-${fiscalYear}-${String(max + 1).padStart(4, "0")}`;
}
