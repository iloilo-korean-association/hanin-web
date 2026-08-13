"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  accountSlotOf,
  assertFyOpen,
  BLOCK_DIRECTION,
  BLOCK_FUND,
  cashThresholdFrom,
  collectImportNeeds,
  evaluateTxState,
  fiscalYearOf,
  formatMoney,
  formatReceiptNo,
  loadSettings,
  publicPolicyFrom,
  recomputeRowStatus,
  resolveImportBaseData,
  SNAP_AMOUNT,
  SNAP_DATE,
  SNAP_DESC,
  SNAP_STATUS,
  splitRawJson,
  todayManila,
  type AccountSlot,
} from "@/lib/domain";
import { parseLedgerXlsx, type ParsedRow } from "@/lib/domain/importXlsx";
import { requireOfficer } from "@/lib/guard";
import { ROUTES } from "@/lib/site";

import type { ActionState } from "../../_lib/action-state";
import { appendAuditLog, fail, fdStr, ok, toActionError } from "../../_lib/server-utils";
import { saveDataUrlTo, XLSX_MIME } from "../../_lib/upload";

/**
 * 장부 가져오기 (L3) — 실제 회계장부 엑셀(2021~2026) → 05_거래.
 *
 * ── 세 개의 액션 ────────────────────────────────────────────────────────
 *  ① 업로드   : .xlsx → 비공개 Blob 보관 → 파싱 → ImportBatch + ImportRow
 *  ② 행 편집  : 확인필요 행의 날짜·금액·내역 지정 / 제외 / 원상복구
 *  ③ 반영     : status=정상 인 행만 Transaction 으로. 확인필요는 건너뛴다.
 *
 * ── 이 화면이 지키는 것 ─────────────────────────────────────────────────
 *  I1  반영 취소를 만들지 않는다. 잘못 반영된 거래는 기존 무효(VOID)+역분개 경로로만 고친다.
 *  I2  영수증번호는 회계연도별 ReceiptSequence 로 채번한다. 결번이 생기지 않게
 *      "필요한 개수만큼 한 번에 증가" 시키고 그 구간을 그대로 쓴다(같은 트랜잭션).
 *  I3  evidenceUrl = 배치의 엑셀 원본 Blob URL. 증빙 없는 행은 애초에 만들지 않는다.
 *  I4  현금 임계 초과는 evaluateTxState 가 판정한다. 확인자를 지정하지 않으면 그 행은
 *      DRAFT 로 떨어진다 — 유령 확인자를 만들어 통과시키지 않는다.
 *  I5  마감·미등록 회계연도의 행은 건너뛴다(반영 자체는 진행).
 *
 * ── 멱등 ────────────────────────────────────────────────────────────────
 *  ImportRow.externalRef 가 전역 unique 다. 같은 파일을 다시 올려도 행이 두 벌 생기지 않고,
 *  같은 externalRef 를 가진 거래가 이미 있으면 반영에서 건너뛴다.
 *  값이 달라졌으면 만들지 않고 "차이 있음" 으로 보고한다 — 조용히 덮어쓰지 않는다.
 */

/* ═══════════════════════ 공용 ═══════════════════════ */

const IMPORT_PATH = `${ROUTES.officer}/ledger-import`;

/** 화면·감사로그에 찍히는 최대 길이 — 실명이 길게 흘러가지 않게 자른다. */
const MAX_NOTE = 400;

const zBatchId = z.string().trim().regex(/^IB-\d{4,}$/, "배치ID 형식이 올바르지 않습니다.");
const zRowId = z.string().trim().min(1).max(64);
const zDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 yyyy-MM-dd 형식이어야 합니다.");

function revalidateImport(batchId?: string): void {
  revalidatePath(IMPORT_PATH);
  if (batchId) revalidatePath(`${IMPORT_PATH}/${batchId}`);
  revalidatePath(`${IMPORT_PATH}/link`);
}

/* ═══════════════════════ ① 업로드 ═══════════════════════ */

/**
 * .xlsx 업로드 → 비공개 Blob → 파싱 → 배치·행 생성.
 *
 * ── 왜 서버 액션인가 (route handler 가 아니라) ──────────────────────────
 *  Next 서버 액션 body 기본 상한은 1MB 다. 실제 원본(한인회비 내역 2(수정).xlsx)은
 *  63,847바이트이고 dataURL 로 바꾸면 약 85,000자 — 상한의 8% 라 여유가 크다.
 *  upload.ts 의 MAX_DATAURL_CHARS(780,000자 ≈ 585KB 파일)까지는 이 경로로 충분하므로
 *  스트리밍 route handler 를 따로 만들지 않았다. 그 이상 커지면(시트가 몇 배로 늘면)
 *  route handler + FormData 스트리밍으로 바꿔야 한다.
 */
export async function uploadLedgerXlsxAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    // ★ 첫 줄. write:true 를 빼면 감사 계정이 통과한다.
    const me = await requireOfficer({
      permissions: ["입력권"],
      write: true,
      screen: "장부 가져오기(업로드)",
    });

    const dataUrl = fdStr(formData, "fileDataUrl");
    const rawName = fdStr(formData, "fileName");
    if (!dataUrl) {
      return fail(
        "엑셀 파일을 선택해 주십시오.",
        "장부 원본 .xlsx 파일을 고르면 아래에 파일 이름과 크기가 표시됩니다.",
      );
    }

    const m = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return fail("첨부 파일 형식을 읽을 수 없습니다. 파일을 다시 선택해 주십시오.");
    if (m[1].toLowerCase() !== XLSX_MIME) {
      return fail(
        `지원하지 않는 파일 형식입니다(${m[1]}).`,
        "엑셀 .xlsx 파일만 받습니다. 구형 .xls 는 먼저 .xlsx 로 저장한 뒤 올려 주십시오.",
      );
    }

    const buf = Buffer.from(m[2], "base64");
    if (buf.byteLength === 0) return fail("첨부 파일이 비어 있습니다.");

    /* ── 파싱 먼저. 못 읽는 파일이면 저장소에 쓰레기를 남기지 않는다 ── */
    let parsed;
    try {
      parsed = await parseLedgerXlsx(buf);
    } catch (e) {
      return fail(
        "엑셀을 읽지 못했습니다: " + (e instanceof Error ? e.message : String(e)),
        "원본 파일이 손상되지 않았는지, .xlsx 형식이 맞는지 확인해 주십시오.",
      );
    }
    if (parsed.rows.length === 0) {
      return fail(
        "읽을 수 있는 행이 하나도 없습니다.",
        '시트 이름이 "YYYY년 한인회비" 또는 "금부원 교민지원" 이어야 합니다. ' +
          (parsed.warnings.length > 0 ? `파서 경고: ${parsed.warnings.join(" / ")}` : ""),
      );
    }

    /* ── 원본 보관 (트랜잭션 밖. 파일 I/O 로 DB 락을 잡고 있지 않는다) ── */
    const saved = await saveDataUrlTo("imports/ledger", dataUrl, todayManila());
    if (!saved.ok) return fail(saved.message);

    const fileName = (rawName || "ledger.xlsx").slice(0, 200);

    /* ── 배치·행 생성 ── */
    const refs = parsed.rows.map((r) => r.externalRef);
    const result = await prisma.$transaction(
      async (tx) => {
        const last = await tx.importBatch.findFirst({
          orderBy: { batchId: "desc" },
          select: { batchId: true },
        });
        const n = last ? Number(last.batchId.replace(/\D/g, "")) + 1 : 1;
        const batchId = "IB-" + String(n).padStart(4, "0");

        // 이미 있는 행은 손대지 않는다 — 총무가 고쳐 둔 날짜·금액을 재업로드가 지우면 안 된다.
        const existing = await tx.importRow.findMany({
          where: { externalRef: { in: refs } },
          select: { externalRef: true, batchId: true },
        });
        const existingRefs = new Set(existing.map((e) => e.externalRef));
        const existingBatches = [...new Set(existing.map((e) => e.batchId))].sort();

        await tx.importBatch.create({
          data: {
            batchId,
            fileName,
            blobUrl: saved.url,
            uploadedBy: me.email,
            status: "검토중",
            summaryJson: JSON.stringify({
              sheetSummaries: parsed.sheetSummaries,
              warnings: parsed.warnings,
              parsedRowCount: parsed.rows.length,
              fileBytes: buf.byteLength,
            }),
            note:
              existingRefs.size > 0
                ? `재업로드 — 이미 등록된 행 ${existingRefs.size}건은 기존 배치(${existingBatches.join(", ")})에 그대로 두었습니다.`
                : "",
          },
        });

        const fresh = parsed.rows.filter((r) => !existingRefs.has(r.externalRef));
        if (fresh.length > 0) {
          await tx.importRow.createMany({
            data: fresh.map((r) => toRowData(batchId, r)),
            skipDuplicates: true,
          });
        }

        await appendAuditLog(tx, {
          actor: me.email,
          tableName: "ImportBatch",
          recordKey: batchId,
          changeType: "INSERT",
          severity: "WARN",
          afterValue: `행 ${fresh.length}건 생성 / 기존 유지 ${existingRefs.size}건 / 시트 ${parsed.sheetSummaries.length}장`,
          note: `장부 엑셀 업로드 (${me.officerId} ${me.role}) — ${fileName} ${buf.byteLength}바이트`.slice(
            0,
            MAX_NOTE,
          ),
        });

        return { batchId, created: fresh.length, kept: existingRefs.size };
      },
      { timeout: 120_000 },
    );

    revalidateImport(result.batchId);

    const needsReview = parsed.rows.filter((r) => r.status === "확인필요").length;
    return ok(
      `${result.batchId} 배치를 만들었습니다 — 행 ${result.created}건 생성` +
        (result.kept > 0 ? `, 이미 등록돼 있던 ${result.kept}건은 기존 배치에 그대로 두었습니다` : "") +
        `. 확인필요 ${needsReview}건. 아래 배치 목록에서 "검토" 를 눌러 대조표를 확인해 주십시오.`,
    );
  } catch (e) {
    return toActionError(e);
  }
}

/** ParsedRow → ImportRow.create 데이터. 파서 원본값을 rawJson 에 함께 찍는다(원상복구용). */
function toRowData(batchId: string, r: ParsedRow) {
  return {
    batchId,
    sheetName: r.sheetName,
    rowNo: r.rowNo,
    blockType: r.blockType,
    rawJson: JSON.stringify({
      ...r.raw,
      [SNAP_DATE]: r.date ?? "",
      [SNAP_AMOUNT]: String(r.amount),
      [SNAP_DESC]: r.description,
      [SNAP_STATUS]: r.status,
    }),
    date: r.date,
    payerName: r.payerName,
    description: r.description,
    amount: r.amount,
    currency: r.currency,
    method: r.method,
    parseWarning: r.warnings.join(" | "),
    status: r.status,
    externalRef: r.externalRef,
  };
}

/* ═══════════════════════ ② 행 편집 ═══════════════════════ */

/**
 * 확인필요 행 해소 — 날짜·금액·내역 지정 / 제외 / 원상복구.
 *
 * ★ ImportRow 만 고친다. 이미 반영된(반영됨) 행은 거절한다 —
 *   장부에 들어간 값을 여기서 되돌리면 05_거래와 임포트 기록이 어긋난다(I1).
 *   반영된 거래를 고치는 길은 무효(VOID)+역분개 하나뿐이다.
 */
export async function editImportRowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["입력권"],
      write: true,
      screen: "장부 임포트 행 편집",
    });

    const rowId = zRowId.parse(fdStr(formData, "rowId"));
    const op = fdStr(formData, "op"); // 저장 / 제외 / 복구

    const row = await prisma.importRow.findUnique({ where: { id: rowId } });
    if (!row) return fail("행을 찾을 수 없습니다. 화면을 새로고침해 주십시오.");
    if (row.status === "반영됨") {
      return fail(
        `이미 장부에 반영된 행입니다(${row.receiptNo ?? ""}).`,
        "반영된 거래는 여기서 고칠 수 없습니다. 잘못되었다면 승인·집행 화면에서 무효 처리하고 정정 거래를 새로 만들어야 합니다(I1).",
      );
    }

    const before = `${row.status} / ${row.date ?? "날짜없음"} / ${row.amount}${row.currency}`;
    let data: { date?: string | null; amount?: number; description?: string; status: string };
    let what: string;

    if (op === "제외") {
      data = { status: "제외" };
      what = "제외 처리";
    } else if (op === "복구") {
      // 파서가 처음 읽은 값으로 되돌린다 (rawJson 에 찍어 둔 스냅샷).
      const { snapshot } = splitRawJson(row.rawJson);
      const snapDate = (snapshot[SNAP_DATE] ?? "").trim();
      const snapAmount = Number(snapshot[SNAP_AMOUNT] ?? "0");
      const snapDesc = snapshot[SNAP_DESC] ?? "";
      const date = snapDate ? snapDate : null;
      const amount = Number.isFinite(snapAmount) ? Math.round(snapAmount) : 0;
      data = {
        date,
        amount,
        description: snapDesc,
        status: recomputeRowStatus({
          blockType: row.blockType,
          date,
          amount,
          description: snapDesc,
          currentStatus: row.status,
        }),
      };
      what = "원상복구(파서 원본값)";
    } else {
      const dateRaw = fdStr(formData, "date");
      const amountRaw = fdStr(formData, "amount");
      const descRaw = fdStr(formData, "description");

      let date: string | null = null;
      if (dateRaw) {
        date = zDate.parse(dateRaw);
        const year = fiscalYearOf(date);
        // 시트 연도와 다른 해를 찍으면 그 해 장부에 남의 거래가 들어간다. 시트명에서 연도를 읽어 대조한다.
        const sheetYear = /^(\d{4})년/.exec(row.sheetName)?.[1];
        if (sheetYear && Number(sheetYear) !== year) {
          return fail(
            `"${row.sheetName}" 시트의 행에 ${year}년 날짜를 지정했습니다.`,
            "시트 연도와 다른 해로 반영하면 그 해 공개 회계가 어긋납니다. 정말 다른 해가 맞다면 총무·감사가 함께 확인한 뒤 진행해 주십시오. (현재는 막습니다)",
          );
        }
        if (date > todayManila()) return fail("미래 날짜로는 지정할 수 없습니다.");
      }

      let amount = row.amount;
      if (amountRaw !== "") {
        const n = Number(amountRaw.replace(/[,\s₱P]/gi, ""));
        if (!Number.isFinite(n) || n < 0) return fail("금액은 0 이상의 숫자여야 합니다.");
        amount = Math.round(n);
      }

      const description = descRaw.slice(0, 200);
      data = {
        date,
        amount,
        description,
        status: recomputeRowStatus({
          blockType: row.blockType,
          date,
          amount,
          description,
          currentStatus: row.status,
        }),
      };
      what = "값 지정";
    }

    await prisma.$transaction(async (tx) => {
      await tx.importRow.update({ where: { id: rowId }, data });
      await appendAuditLog(tx, {
        actor: me.email,
        tableName: "ImportRow",
        recordKey: row.externalRef,
        fieldName: "date/amount/description/status",
        beforeValue: before,
        afterValue: `${data.status} / ${data.date ?? row.date ?? "날짜없음"} / ${data.amount ?? row.amount}${row.currency}`,
        changeType: "EDIT",
        severity: "INFO",
        relatedKey: row.batchId,
        note: `장부 임포트 행 ${what} (${me.officerId} ${me.role}) — ${row.sheetName} r${row.rowNo}`.slice(
          0,
          MAX_NOTE,
        ),
      });
    });

    revalidateImport(row.batchId);
    return ok(
      `${row.sheetName} ${row.rowNo}행 — ${what} 완료. 상태: ${data.status}.` +
        (data.status === "확인필요" ? " (날짜·금액이 아직 비어 있습니다)" : ""),
    );
  } catch (e) {
    return toActionError(e);
  }
}

/* ═══════════════════════ ③ 반영 ═══════════════════════ */

/**
 * 배치의 status=정상 행을 05_거래로 만든다.
 *
 * ★ 확인필요 행은 **건너뛴다**(반영 자체는 진행). 임의 해석으로 장부에 넣지 않는다.
 * ★ 기초데이터(과목·기금·계좌·연도별 환율)가 없으면 만들지 않고 거부한다.
 */
export async function applyBatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await requireOfficer({
      permissions: ["입력권"],
      write: true,
      screen: "장부 임포트 반영",
    });

    const batchId = zBatchId.parse(fdStr(formData, "batchId"));
    const verifiedByRaw = fdStr(formData, "verifiedBy").toLowerCase();

    const batch = await prisma.importBatch.findUnique({ where: { batchId } });
    if (!batch) return fail("배치를 찾을 수 없습니다.");
    if (!batch.blobUrl) {
      return fail(
        "이 배치에는 원본 파일이 없습니다.",
        "증빙 없이 POSTED 가 될 수 없습니다(I3). 엑셀을 다시 업로드해 주십시오.",
      );
    }

    /* ── 확인자 (I4) — 실재하는 현직 임원이어야 하고 본인과 달라야 한다 ── */
    if (verifiedByRaw) {
      if (verifiedByRaw === me.email.trim().toLowerCase()) {
        return fail(
          "확인자는 반영하는 사람(귀하)과 다른 임원이어야 합니다.",
          "혼자 넣고 혼자 확인한 것은 2인 확인이 아닙니다(I4).",
        );
      }
      const verifier = await prisma.officer.findFirst({
        where: { email: verifiedByRaw },
        select: { status: true },
      });
      if (!verifier || verifier.status !== "ACTIVE") {
        return fail(
          `확인자 "${verifiedByRaw}" 는 현직 임원이 아닙니다.`,
          "12_임원에 등록된 활동(ACTIVE) 임원 중에서 골라 주십시오.",
        );
      }
    }

    const rows = await prisma.importRow.findMany({
      where: { batchId, status: "정상", receiptNo: null },
      orderBy: [{ sheetName: "asc" }, { rowNo: "asc" }],
    });
    const pendingReview = await prisma.importRow.count({
      where: { batchId, status: "확인필요" },
    });
    if (rows.length === 0) {
      return fail(
        "반영할 '정상' 행이 없습니다.",
        pendingReview > 0
          ? `확인필요 ${pendingReview}건은 날짜·금액을 지정해야 반영 대상이 됩니다.`
          : "이미 전부 반영되었거나 제외되었습니다.",
      );
    }

    /* ── 기초데이터 해석 ── */
    const [settings, categories, funds, accounts, fiscalYears] = await Promise.all([
      loadSettings(prisma),
      prisma.category.findMany({
        select: { code: true, name: true, majorType: true, isActive: true },
      }),
      prisma.fund.findMany({ select: { fundId: true, name: true, kind: true, status: true } }),
      prisma.account.findMany({
        select: {
          accountId: true,
          name: true,
          kind: true,
          currency: true,
          status: true,
          openedOn: true,
        },
      }),
      prisma.fiscalYear.findMany({ select: { year: true, status: true } }),
    ]);

    const needs = collectImportNeeds(rows);
    const resolved = resolveImportBaseData(needs, { categories, funds, accounts, settings });
    if (!resolved.ok) {
      return fail(
        `기초데이터가 준비되지 않아 반영할 수 없습니다 (${resolved.missing.length}건 부족).`,
        "화면의 “기초데이터 준비 필요” 목록을 먼저 채워 주십시오: " +
          resolved.missing.map((x) => x.what).join(" · "),
      );
    }
    const plan = resolved.plan;

    const accountById = new Map(accounts.map((a) => [a.accountId, a]));
    const categoryByCode = new Map(categories.map((c) => [c.code, c]));
    const fyStatus = new Map(fiscalYears.map((f) => [f.year, f.status.toUpperCase()]));
    const cashThreshold = cashThresholdFrom(settings);
    const receiptPrefix = publicPolicyFrom(settings).receiptPrefix;

    /* ── 이미 반영된 externalRef (재반영 멱등) ── */
    const refs = rows.map((r) => r.externalRef);
    const already = await prisma.transaction.findMany({
      where: { externalRef: { in: refs } },
      select: { externalRef: true, receiptNo: true, date: true, amountPhp: true, status: true },
    });
    const alreadyByRef = new Map(already.map((t) => [t.externalRef, t]));

    /* ── 납부자 → 회원 연결 (L4 결과를 그대로 쓴다) ── */
    const aliases = await prisma.payerAlias.findMany({
      where: { kind: "회원", memberNo: { not: null } },
      select: { alias: true, memberNo: true },
    });
    const memberByAlias = new Map(aliases.map((a) => [a.alias, a.memberNo as string]));

    /* ── 행별 계획 세우기 (DB 쓰기 전에 전부 판정한다) ── */
    /** 영수증번호·일련번호는 트랜잭션 안에서 채번한다(I2). 그 둘만 빼고 미리 다 만들어 둔다. */
    type TxCreate = Omit<Prisma.TransactionCreateManyInput, "receiptNo" | "seq">;
    type Planned = {
      rowId: string;
      externalRef: string;
      year: number;
      data: TxCreate;
      draftReason: string;
    };
    const planned: Planned[] = [];
    const skipped: { ref: string; reason: string }[] = [];
    const diffs: string[] = [];

    for (const r of rows) {
      if (!r.date) {
        skipped.push({ ref: r.externalRef, reason: "날짜 없음" });
        continue;
      }
      const year = fiscalYearOf(r.date);
      const currency = r.currency.toUpperCase() === "KRW" ? "KRW" : "PHP";
      const fxRate = currency === "KRW" ? (plan.fxByYear[year] ?? 0) : 1;
      if (!(fxRate > 0)) {
        skipped.push({ ref: r.externalRef, reason: `환율.${year} 설정 없음` });
        continue;
      }
      const amountPhp = Math.round(r.amount * fxRate);

      const prev = alreadyByRef.get(r.externalRef);
      if (prev) {
        if (prev.date !== r.date || prev.amountPhp !== amountPhp) {
          diffs.push(
            `${r.sheetName} r${r.rowNo}: 장부 ${prev.receiptNo} ${prev.date} ₱${formatMoney(prev.amountPhp)} ↔ 임포트 ${r.date} ₱${formatMoney(amountPhp)}`,
          );
        }
        skipped.push({ ref: r.externalRef, reason: `이미 반영됨(${prev.receiptNo})` });
        continue;
      }

      const status = fyStatus.get(year);
      if (status !== "OPEN") {
        skipped.push({
          ref: r.externalRef,
          reason: status === "CLOSED" ? `${year} 회계연도 마감(I5)` : `${year} 회계연도 미등록`,
        });
        continue;
      }

      const block = r.blockType;
      const direction = BLOCK_DIRECTION[block as keyof typeof BLOCK_DIRECTION];
      const fundId = plan.fundByKind[BLOCK_FUND[block as keyof typeof BLOCK_FUND]];
      const categoryCode = plan.categoryByBlock[block];
      const slot: AccountSlot = accountSlotOf(currency, r.method);
      const accountId = plan.accountBySlot[slot];
      if (!direction || !fundId || !categoryCode || !accountId) {
        skipped.push({ ref: r.externalRef, reason: `블록 "${block}" 매핑 없음` });
        continue;
      }
      const account = accountById.get(accountId)!;
      if (r.date < account.openedOn) {
        skipped.push({
          ref: r.externalRef,
          reason: `${account.name} 개시일(${account.openedOn}) 이전 날짜`,
        });
        continue;
      }

      const memberNo = direction === "IN" ? (memberByAlias.get(r.payerName) ?? null) : null;
      const state = evaluateTxState(
        {
          evidenceUrl: batch.blobUrl,
          method: r.method,
          amount: r.amount,
          currency,
          fxRate,
          enteredBy: me.email,
          verifiedBy: verifiedByRaw,
        },
        cashThreshold,
      );
      const categoryName = categoryByCode.get(categoryCode)?.name ?? categoryCode;

      planned.push({
        rowId: r.id,
        externalRef: r.externalRef,
        year,
        draftReason: state.reason,
        data: {
          date: r.date,
          direction,
          amount: r.amount,
          currency,
          fxRate,
          amountPhp,
          accountId,
          fundId,
          categoryCode,
          counterpartyType: memberNo ? "회원" : "비회원",
          counterpartyMemberNo: memberNo,
          // ★ 실명은 상대방명에만 둔다. 공개 화면은 여기에 마스킹 정책을 건다.
          counterpartyName: r.payerName,
          method: r.method,
          // ★ 적요에 실명을 넣지 않는다(감사 C14). 회원은 번호로만 남긴다.
          memo: [r.description || categoryName, memberNo ? `회원 ${memberNo}` : ""]
            .filter(Boolean)
            .join(" / ")
            .slice(0, 200),
          externalRef: r.externalRef,
          status: state.status,
          relatedParty: false,
          enteredBy: me.email,
          verifiedBy: verifiedByRaw,
          verifiedAt: verifiedByRaw ? new Date() : null,
          evidenceUrl: batch.blobUrl,
          fiscalYear: year,
        },
      });
    }

    if (planned.length === 0) {
      return fail(
        "반영된 행이 없습니다.",
        summarizeSkips(skipped) || "모든 행이 이미 반영되었거나 건너뛰어졌습니다.",
      );
    }

    /* ── 쓰기 — 회계연도별로 나눠 트랜잭션을 짧게 유지한다 ──
       한 트랜잭션에 700행을 몰면 원격 DB(Neon 풀러) 커넥션을 수십 초 잡고 있게 되고,
       중간에 끊기면 전부 롤백된다. 연도별로 끊으면 실패해도 그 해만 되돌아가고,
       externalRef 멱등 덕분에 다시 눌러 이어서 반영할 수 있다. */
    const byYear = new Map<number, Planned[]>();
    for (const p of planned) {
      const arr = byYear.get(p.year);
      if (arr) arr.push(p);
      else byYear.set(p.year, [p]);
    }

    let postedCount = 0;
    let draftCount = 0;
    const draftReasons = new Map<string, number>();
    const yearNotes: string[] = [];

    for (const [year, list] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
      await prisma.$transaction(
        async (tx) => {
          await assertFyOpen(tx, `${year}-01-01`); // I5 — 트랜잭션 안에서 한 번 더

          // I2 — 필요한 개수만큼 카운터를 한 번에 올리고 그 구간을 그대로 쓴다.
          //      롤백되면 카운터도 함께 되돌아가므로 결번이 생기지 않는다.
          const seqRow = await tx.receiptSequence.upsert({
            where: { fiscalYear: year },
            create: { fiscalYear: year, lastSeq: list.length },
            update: { lastSeq: { increment: list.length } },
            select: { lastSeq: true },
          });
          const firstSeq = seqRow.lastSeq - list.length + 1;

          const txData: Prisma.TransactionCreateManyInput[] = list.map((p, i) => {
            const seq = firstSeq + i;
            return { ...p.data, receiptNo: formatReceiptNo(receiptPrefix, year, seq), seq };
          });
          await tx.transaction.createMany({ data: txData });

          for (let i = 0; i < list.length; i++) {
            await tx.importRow.update({
              where: { id: list[i].rowId },
              data: { status: "반영됨", receiptNo: formatReceiptNo(receiptPrefix, year, firstSeq + i) },
            });
          }

          const posted = list.filter((p) => !p.draftReason).length;
          await appendAuditLog(tx, {
            actor: me.email,
            tableName: "Transaction",
            recordKey: `${receiptPrefix}-${year}-${String(firstSeq).padStart(6, "0")}…${String(firstSeq + list.length - 1).padStart(6, "0")}`,
            changeType: "INSERT",
            severity: "CRITICAL",
            afterValue: `${year}년 ${list.length}건 (POSTED ${posted} / DRAFT ${list.length - posted})`,
            relatedKey: batchId,
            note: `장부 엑셀 임포트 반영 (${me.officerId} ${me.role}) — 배치 ${batchId}, 확인자 ${verifiedByRaw || "없음"}`.slice(
              0,
              MAX_NOTE,
            ),
          });
        },
        { timeout: 180_000 },
      );

      yearNotes.push(`${year}년 ${list.length}건`);
      for (const p of list) {
        if (p.draftReason) {
          draftCount += 1;
          draftReasons.set(p.draftReason, (draftReasons.get(p.draftReason) ?? 0) + 1);
        } else {
          postedCount += 1;
        }
      }
    }

    /* ── 배치 상태 — 남은 정상 행이 없으면 '반영됨' ── */
    const remaining = await prisma.importRow.count({
      where: { batchId, status: "정상", receiptNo: null },
    });
    if (remaining === 0) {
      await prisma.importBatch.update({ where: { batchId }, data: { status: "반영됨" } });
    }

    revalidateImport(batchId);
    revalidatePath(ROUTES.ledger);
    revalidatePath(`${ROUTES.officer}/audit`);

    const parts = [
      `${planned.length}건을 장부에 반영했습니다 (${yearNotes.join(" · ")}).`,
      `확정(POSTED) ${postedCount}건`,
      draftCount > 0
        ? `미확정(DRAFT) ${draftCount}건 — ${[...draftReasons.entries()].map(([k, v]) => `${k} ×${v}`).join(", ")}`
        : "",
      pendingReview > 0 ? `확인필요 ${pendingReview}건은 건너뛰었습니다.` : "",
      skipped.length > 0 ? summarizeSkips(skipped) : "",
      diffs.length > 0
        ? `★ 차이 있음 ${diffs.length}건 (덮어쓰지 않았습니다): ${diffs.slice(0, 5).join(" / ")}${diffs.length > 5 ? " …" : ""}`
        : "",
    ].filter(Boolean);

    return ok(parts.join(" "));
  } catch (e) {
    return toActionError(e);
  }
}

/** 건너뛴 사유를 개수로 묶어 한 줄로. 행 목록을 그대로 늘어놓지 않는다(실명·건수 과다). */
function summarizeSkips(skipped: { reason: string }[]): string {
  if (skipped.length === 0) return "";
  const byReason = new Map<string, number>();
  for (const s of skipped) {
    // "이미 반영됨(IKA-2021-000001)" 처럼 번호가 붙은 사유는 묶어서 센다
    const key = s.reason.replace(/\([^)]*\)/g, "()");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  return `건너뜀 ${skipped.length}건 — ${[...byReason.entries()].map(([k, v]) => `${k} ×${v}`).join(", ")}.`;
}

