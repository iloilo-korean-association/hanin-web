/* eslint-disable no-console */
/**
 * 실데이터 전환 — 시드 데모 정리 + 실장부(2021~2026) 기초데이터 적재.
 *
 *   드라이런(기본):  npx tsx prisma/realdata-cutover.ts
 *   실제 적용     :  npx tsx prisma/realdata-cutover.ts --apply
 *
 * ── 이중 안전장치 ────────────────────────────────────────────────────────
 *  ① db-guard: 원격 DB 는 .env 의 ALLOW_DESTRUCTIVE_DB 가 대상 호스트와 정확히
 *     일치할 때만 진행한다. 드라이런조차 가드를 먼저 통과해야 한다.
 *  ② 드라이런 기본: --apply 인자가 없으면 삭제·생성 대상 개수만 세고 아무것도
 *     쓰지 않는다.
 *
 * ── 무엇을 지우나 (시드 데모 유래) ──────────────────────────────────────
 *  발송함·매직링크·알림로그 / 대사·인수인계·현금실사 / 행사신청·행사 /
 *  기부사용·회비고지·기부 / 거래 / 승인 / 회원카드·회원비밀번호 /
 *  회원(임원 명부에 있는 회원과 M9xxx 시스템 계정 제외) /
 *  영수증채번·회계연도 / 과목·기금·계좌 (전부 기초데이터로 재생성)
 *
 * ── 무엇을 남기나 ───────────────────────────────────────────────────────
 *  Officer(+OfficerCredential) — 임원 계정. 임원은 회원이어야 하므로(FK)
 *    임원 명부에 오른 회원 행도 함께 남는다.
 *  Service · EmergencyContact · Vendor(업소) · Setting(값 갱신만) ·
 *  AuditLog(append-only — 손대지 않는다) ·
 *  ConflictOfInterest(신고자가 남는 회원이면 유지 — 업소 이해관계 공시의 근거) ·
 *  ImportBatch/ImportRow/PayerAlias(실데이터 인프라 — 전환 시점에는 비어 있다)
 *
 * ── 무엇을 만드나 ───────────────────────────────────────────────────────
 *  회계연도 2021~2026 (전부 OPEN — 2021~2025 마감은 임포트 검수 후 별도 실행) ·
 *  연도별 영수증 채번 · 계좌 3(한화계좌 KRW / 페소현금 / BDO, 개시잔액 0) ·
 *  기금 2(일반회계 + 금부원 지정기금) · 과목 6(회비/후원금/기부 수입 ·
 *  운영/행사/지원 지출) · 00_설정 환율.2021~2026 초안([확인 필요 — 총무 확정])
 */
import { PrismaClient } from "@prisma/client";

import { assertDestructiveAllowed } from "./db-guard";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const ACTOR = "realdata-cutover";

/* ════════════════════════════════════════════════════════════════════════
 * 기초데이터 정의
 * ════════════════════════════════════════════════════════════════════════ */

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026] as const;
const OPEN_FROM = "2021-01-01";

/**
 * 실장부 계좌 3개. 개시잔액 0 — 엑셀 2021년이 개시 시점이고 이월금이 0 이라는
 * 근거는 없으나, 2021 시트에 이월 행이 없으므로 0 에서 시작해 검수에서 확정한다.
 */
const ACCOUNTS = [
  {
    accountId: "AC01",
    name: "한화계좌",
    kind: "BANK",
    currency: "KRW",
    bankName: "", // [확인 필요] 한화 수납 계좌의 은행·명의 미확인
    accountNoMasked: "",
    holder: "",
    openingBalance: 0,
    openedOn: OPEN_FROM,
    manager: "",
    isPublic: true,
    note: "[확인 필요] 한화 이체 수납 계좌 — 은행·명의는 총무 확인 후 기재",
  },
  {
    accountId: "AC02",
    name: "페소현금",
    kind: "CASH",
    currency: "PHP",
    bankName: "",
    accountNoMasked: "",
    holder: "총무",
    openingBalance: 0,
    openedOn: OPEN_FROM,
    manager: "",
    isPublic: true,
    note: "현장 납부·현금 지출 계좌",
  },
  {
    accountId: "AC03",
    name: "BDO",
    kind: "BANK",
    currency: "PHP",
    bankName: "BDO",
    accountNoMasked: "",
    holder: "일로일로 한인회",
    openingBalance: 0,
    openedOn: OPEN_FROM,
    manager: "",
    isPublic: true,
    note: "BDO 이체 수납 계좌",
  },
] as const;

const FUNDS = [
  {
    fundId: "FD01",
    name: "일반회계",
    kind: "일반",
    purpose: "한인회 일반 운영",
    startOn: OPEN_FROM,
    targetAmount: 0,
    openingBalance: 0,
    isPublic: true,
    note: "회비·후원금이 들어오는 기본 기금",
  },
  {
    fundId: "FD02",
    name: "금부원 교민지원기금",
    kind: "지정",
    purpose: "금부원 후원 교민 지원 (생필품·항공권·행정비 등)",
    startOn: OPEN_FROM,
    targetAmount: 0,
    openingBalance: 0,
    isPublic: true,
    note: "지정기금 — 목적외 사용 금지. 엑셀 '금부원 교민지원' 시트가 원본",
  },
] as const;

/** 과목 6개 — 기존 midType 체계(회비/기부/행사/운영/구호)를 그대로 쓴다. */
const CATEGORIES = [
  { code: "R100", name: "회비수입", majorType: "수입", midType: "회비", publicName: "회비", sortOrder: 10, note: "" },
  { code: "R200", name: "후원금수입", majorType: "수입", midType: "기부", publicName: "후원금", sortOrder: 20, note: "족구·체육대회 후원금, 사무실 오픈 기부 등" },
  { code: "R210", name: "기부수입", majorType: "수입", midType: "기부", publicName: "기부금", sortOrder: 21, note: "금부원 지원 등 지정 기부 포함" },
  { code: "E100", name: "운영지출", majorType: "지출", midType: "운영", publicName: "운영비", sortOrder: 110, note: "사무실·급여·공과금·비품" },
  { code: "E200", name: "행사지출", majorType: "지출", midType: "행사", publicName: "행사 비용", sortOrder: 120, note: "페스티벌·체육대회·명절 행사" },
  { code: "E300", name: "지원지출", majorType: "지출", midType: "구호", publicName: "교민 지원", sortOrder: 130, note: "구호·경조·장학 등 교민 직접 지원" },
] as const;

/**
 * 연도별 원화 환율 초안 (KRW 1원당 페소).
 * USD 교차환율(연평균 USD/PHP ÷ USD/KRW) 추정 초안이다 — 총무가 00_설정에서 확정한다.
 * 참고: 엑셀 작성자는 2024 족구 블록에서 1페소=24원(≈0.04167)을 썼다.
 */
const FX_DRAFTS: Record<number, number> = {
  2021: 0.0431,
  2022: 0.0422,
  2023: 0.0426,
  2024: 0.042,
  2025: 0.0411,
  2026: 0.0417, // 기존 설정 '환율.KRW_PHP'(0.0417)와 동일
};

/** 값 갱신할 기존 설정 (키는 그대로 — 코드가 찾는 식별자다) */
const SETTING_UPDATES: { key: string; value: string; description?: string }[] = [
  {
    key: "마감회계연도목록",
    value: "",
    description: "여기 적힌 연도의 거래는 입력·수정 불가 (I5). 실데이터 검수 후 2021~2025 를 순서대로 마감한다",
  },
  { key: "기본.기금ID", value: "FD01" },
  { key: "기본.계좌ID.CASH", value: "AC02" },
  { key: "기본.계좌ID.BANK", value: "AC03" },
  { key: "기본.계좌ID.GCASH", value: "", description: "[확인 필요] GCash 계좌 없음 — 개설 시 계좌 등록 후 기재" },
  { key: "기본.계좌ID.MAYA", value: "", description: "[확인 필요] Maya 계좌 없음 — 개설 시 계좌 등록 후 기재" },
  { key: "기본.과목코드.회비", value: "R100" },
  { key: "기본.과목코드.기부", value: "R210" },
  { key: "기본.과목코드.행사수입", value: "", description: "[확인 필요] 실장부 과목 체계에 행사수입 과목 없음 — 필요 시 총무가 과목 추가 후 기재" },
  { key: "기본.과목코드.기타", value: "", description: "[확인 필요] 실장부 과목 체계에 기타 과목 없음 — 필요 시 총무가 과목 추가 후 기재" },
];

/* ════════════════════════════════════════════════════════════════════════ */

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** 시스템 계정 판정 — M9xxx (M9999 관리자 등). 발번 제외 규칙과 같은 기준이다. */
function isSystemMemberNo(memberNo: string): boolean {
  return /^M9\d{3}$/.test(memberNo);
}

async function main(): Promise<void> {
  // ★ 첫 줄 — 대상 DB 확인. 허용되지 않은 원격 DB 면 여기서 던지고 끝난다.
  //   드라이런이라도 가드를 먼저 통과해야 한다 (지우기 전에 묻는 것이 순서다).
  const target = assertDestructiveAllowed("실데이터 전환(데모 정리+기초데이터)");

  console.log("─".repeat(72));
  console.log(`실데이터 전환 — ${APPLY ? "★ 적용 모드 (--apply)" : "드라이런 (변경 없음)"}`);
  console.log(`대상 DB: ${target.host} / ${target.database}${target.isLocal ? " (로컬)" : ""}`);
  console.log("─".repeat(72));

  /* ── 1. 유지 대상 확정 ─────────────────────────────────────────────── */
  const officers = await prisma.officer.findMany({
    select: { officerId: true, memberNo: true, role: true, status: true },
  });
  const systemMembers = await prisma.member.findMany({
    where: { memberNo: { startsWith: "M9" } },
    select: { memberNo: true },
  });
  const keepMemberNos = new Set<string>();
  for (const o of officers) keepMemberNos.add(o.memberNo);
  for (const m of systemMembers) if (isSystemMemberNo(m.memberNo)) keepMemberNos.add(m.memberNo);

  const keepList = [...keepMemberNos].sort();
  console.log(`\n[유지] 임원 ${officers.length}명 (${officers.map((o) => `${o.officerId}:${o.role}`).join(", ")})`);
  console.log(`[유지] 회원 행 ${keepList.length}건 — 임원 명부의 회원 + M9xxx 시스템 계정: ${keepList.join(", ")}`);
  console.log("       (임원은 회원이어야 하므로(FK) 임원의 회원 행은 지울 수 없다)");

  const deleteMembersWhere = { memberNo: { notIn: keepList } } as const;

  /* ── 2. 삭제 대상 집계 ─────────────────────────────────────────────── */
  const [
    cntOutbox, cntMagic, cntNotify,
    cntRecon, cntHandover, cntCash,
    cntSignup, cntEvent,
    cntDonUse, cntDues, cntDon,
    cntTx, cntApproval,
    cntCard, cntCred,
    cntMemberDel, cntMemberAll,
    cntSeq, cntFy,
    cntCat, cntFund, cntAcc,
  ] = await Promise.all([
    prisma.outboxMail.count(), prisma.magicLink.count(), prisma.notifyLog.count(),
    prisma.reconciliation.count(), prisma.handover.count(), prisma.cashCount.count(),
    prisma.eventSignup.count(), prisma.event.count(),
    prisma.donationUse.count(), prisma.duesInvoice.count(), prisma.donation.count(),
    prisma.transaction.count(), prisma.approval.count(),
    prisma.memberCard.count(), prisma.memberCredential.count(),
    prisma.member.count({ where: deleteMembersWhere }), prisma.member.count(),
    prisma.receiptSequence.count(), prisma.fiscalYear.count(),
    prisma.category.count(), prisma.fund.count(), prisma.account.count(),
  ]);

  // FK 정리 대상: 지워질 회원을 가리키는 업소·이해상충·납부자연결
  const vendorsToDetach = await prisma.vendor.findMany({
    where: { relatedMemberNo: { notIn: keepList, not: null } },
    select: { vendorId: true, relatedMemberNo: true },
  });
  const conflictsToDelete = await prisma.conflictOfInterest.count({
    where: { declarerMemberNo: { notIn: keepList } },
  });
  const aliasesToDelete = await prisma.payerAlias.count({
    where: { memberNo: { notIn: keepList } },
  });
  const importRowsLinked = await prisma.importRow.count({ where: { receiptNo: { not: null } } });

  console.log(`\n[삭제 대상]`);
  console.log(`  발송함 ${fmt(cntOutbox)} · 매직링크 ${fmt(cntMagic)} · 알림로그 ${fmt(cntNotify)}`);
  console.log(`  대사 ${fmt(cntRecon)} · 인수인계 ${fmt(cntHandover)} · 현금실사 ${fmt(cntCash)}`);
  console.log(`  행사신청 ${fmt(cntSignup)} · 행사 ${fmt(cntEvent)}`);
  console.log(`  기부사용 ${fmt(cntDonUse)} · 회비고지 ${fmt(cntDues)} · 기부 ${fmt(cntDon)}`);
  console.log(`  거래 ${fmt(cntTx)} · 승인 ${fmt(cntApproval)}`);
  console.log(`  회원카드 ${fmt(cntCard)} · 회원비밀번호 ${fmt(cntCred)} (전량 — 총무가 P1 재설정으로 재발급)`);
  console.log(`  회원 ${fmt(cntMemberDel)} / 전체 ${fmt(cntMemberAll)} (유지 ${keepList.length})`);
  console.log(`  영수증채번 ${fmt(cntSeq)} · 회계연도 ${fmt(cntFy)} · 과목 ${fmt(cntCat)} · 기금 ${fmt(cntFund)} · 계좌 ${fmt(cntAcc)} (전부 재생성)`);
  console.log(`  이해상충 ${fmt(conflictsToDelete)} (신고자가 지워지는 회원인 것만 — 임원 신고분은 유지)`);
  console.log(`  납부자연결 ${fmt(aliasesToDelete)} (지워지는 회원을 가리키는 것만)`);
  console.log(`  업소 관련회원 해제 ${vendorsToDetach.length}건: ${vendorsToDetach.map((v) => v.vendorId).join(", ") || "없음"}`);
  if (importRowsLinked > 0) {
    console.log(`  ⚠ 임포트 행 중 거래 연결 ${fmt(importRowsLinked)}건 — receiptNo 를 해제한다 (행 자체는 남긴다)`);
  }
  console.log(`  ※ 감사로그는 append-only — 지우지 않는다. Officer·Service·긴급연락처·업소·설정 유지.`);

  /* ── 3. 생성 계획 ──────────────────────────────────────────────────── */
  console.log(`\n[생성 계획]`);
  console.log(`  회계연도 ${YEARS.join(", ")} — 전부 OPEN (2021~2025 마감은 검수 후 별도) + 연도별 영수증채번`);
  console.log(`  계좌 3: ${ACCOUNTS.map((a) => `${a.accountId} ${a.name}(${a.currency})`).join(" · ")} — 개시잔액 0, 개시일 ${OPEN_FROM}`);
  console.log(`  기금 2: ${FUNDS.map((f) => `${f.fundId} ${f.name}(${f.kind})`).join(" · ")}`);
  console.log(`  과목 6: ${CATEGORIES.map((c) => `${c.code} ${c.name}`).join(" · ")}`);
  console.log(`  설정: 환율.2021~2026 초안(${YEARS.map((y) => `${y}=${FX_DRAFTS[y]}`).join(", ")}) — [확인 필요 — 총무 확정]`);
  console.log(`  설정 갱신: ${SETTING_UPDATES.map((s) => s.key).join(", ")}`);

  if (!APPLY) {
    console.log(`\n드라이런 종료 — 아무것도 바꾸지 않았습니다. 적용하려면 --apply 를 붙이십시오.`);
    return;
  }

  /* ── 4. 적용 ───────────────────────────────────────────────────────── */
  console.log(`\n적용 시작…`);
  const now = new Date();

  await prisma.$transaction(
    async (tx) => {
      /* 4-1. 삭제 (FK 역순) */
      await tx.outboxMail.deleteMany();
      await tx.magicLink.deleteMany();
      await tx.notifyLog.deleteMany();
      await tx.reconciliation.deleteMany();
      await tx.handover.deleteMany();
      await tx.cashCount.deleteMany();
      await tx.eventSignup.deleteMany();
      await tx.event.deleteMany();
      await tx.donationUse.deleteMany();
      await tx.duesInvoice.deleteMany();
      await tx.donation.deleteMany();
      await tx.importRow.updateMany({ where: { receiptNo: { not: null } }, data: { receiptNo: null } });
      await tx.transaction.deleteMany();
      await tx.approval.deleteMany();
      await tx.conflictOfInterest.deleteMany({ where: { declarerMemberNo: { notIn: keepList } } });
      await tx.payerAlias.deleteMany({ where: { memberNo: { notIn: keepList } } });
      await tx.vendor.updateMany({
        where: { relatedMemberNo: { notIn: keepList, not: null } },
        data: { relatedMemberNo: null },
      });
      await tx.memberCard.deleteMany();
      await tx.memberCredential.deleteMany();
      await tx.member.deleteMany({ where: deleteMembersWhere });
      await tx.receiptSequence.deleteMany();
      await tx.fiscalYear.deleteMany();
      await tx.category.deleteMany();
      await tx.fund.deleteMany();
      await tx.account.deleteMany();

      /* 4-2. 기초데이터 */
      await tx.fiscalYear.createMany({
        data: YEARS.map((year) => ({
          year,
          startDate: `${year}-01-01`,
          endDate: `${year}-12-31`,
          status: "OPEN",
          note:
            year === 2026
              ? "진행 연도"
              : "실장부(엑셀) 임포트 대상 — 검수 후 마감 예정",
        })),
      });
      await tx.receiptSequence.createMany({
        data: YEARS.map((year) => ({ fiscalYear: year, lastSeq: 0 })),
      });
      await tx.account.createMany({
        data: ACCOUNTS.map((a) => ({ ...a, status: "ACTIVE" })),
      });
      await tx.fund.createMany({
        data: FUNDS.map((f) => ({ ...f, endOn: null, status: "ACTIVE" })),
      });
      await tx.category.createMany({
        data: CATEGORIES.map((c) => ({ ...c, isPublic: true, isActive: true })),
      });

      /* 4-3. 설정 — 환율 초안(신규) + 기본값 갱신 */
      for (const year of YEARS) {
        await tx.setting.upsert({
          where: { key: `환율.${year}` },
          create: {
            key: `환율.${year}`,
            value: String(FX_DRAFTS[year]),
            description: `[확인 필요 — 총무 확정] ${year}년 원화→페소 고정 환율 초안 (USD 교차환율 연평균 추정)`,
            group: "환율",
            updatedBy: ACTOR,
          },
          update: {
            value: String(FX_DRAFTS[year]),
            updatedBy: ACTOR,
          },
        });
      }
      for (const s of SETTING_UPDATES) {
        await tx.setting.upsert({
          where: { key: s.key },
          create: {
            key: s.key,
            value: s.value,
            description: s.description ?? "",
            group: s.key.startsWith("기본.") ? "기본값" : "회계연도",
            updatedBy: ACTOR,
          },
          update: {
            value: s.value,
            ...(s.description ? { description: s.description } : {}),
            updatedBy: ACTOR,
          },
        });
      }

      /* 4-4. 감사로그 append (audit.ts 와 같은 채번 관례 — server-only 라 직접 못 쓴다) */
      const last = await tx.auditLog.findFirst({ orderBy: { logId: "desc" }, select: { logId: true } });
      const n = last ? Number(last.logId.replace(/\D/g, "")) + 1 : 1;
      await tx.auditLog.create({
        data: {
          logId: "AU-" + String(n).padStart(6, "0"),
          occurredAt: now,
          actor: ACTOR,
          tableName: "(전체)",
          recordKey: "",
          fieldName: "",
          beforeValue: `데모: 회원 ${cntMemberAll}·거래 ${cntTx}·고지 ${cntDues}·기부 ${cntDon}·행사 ${cntEvent}`,
          afterValue: `유지 회원 ${keepList.length} · 회계연도 ${YEARS[0]}~${YEARS[YEARS.length - 1]} OPEN · 계좌 3 · 기금 2 · 과목 6`,
          changeType: "SCRIPT",
          severity: "CRITICAL",
          relatedKey: "",
          note: "실데이터 전환 — 시드 데모 정리 + 실장부 기초데이터 적재 (대표 결정 2026-08-13)",
        },
      });
    },
    { timeout: 180_000 },
  );

  /* ── 5. 적용 후 자체 검증 ──────────────────────────────────────────── */
  const [pMember, pTx, pFy, pAcc, pFund, pCat, pSeq, pOfficer, pVendor, pService, pContact] =
    await Promise.all([
      prisma.member.count(), prisma.transaction.count(), prisma.fiscalYear.count(),
      prisma.account.count(), prisma.fund.count(), prisma.category.count(),
      prisma.receiptSequence.count(), prisma.officer.count(), prisma.vendor.count(),
      prisma.service.count(), prisma.emergencyContact.count(),
    ]);
  const fxKeys = await prisma.setting.count({ where: { key: { startsWith: "환율.20" } } });

  console.log(`\n[적용 후 검증]`);
  console.log(`  회원 ${pMember} (기대 ${keepList.length}) ${pMember === keepList.length ? "✓" : "✗"}`);
  console.log(`  거래 ${pTx} (기대 0) ${pTx === 0 ? "✓" : "✗"}`);
  console.log(`  회계연도 ${pFy} (기대 ${YEARS.length}) · 채번 ${pSeq} ${pFy === YEARS.length && pSeq === YEARS.length ? "✓" : "✗"}`);
  console.log(`  계좌 ${pAcc}/3 · 기금 ${pFund}/2 · 과목 ${pCat}/6 ${pAcc === 3 && pFund === 2 && pCat === 6 ? "✓" : "✗"}`);
  console.log(`  환율.20xx 설정 ${fxKeys} (기대 ${YEARS.length} 이상)`);
  console.log(`  유지 확인 — 임원 ${pOfficer} · 업소 ${pVendor} · 서비스 ${pService} · 긴급연락처 ${pContact}`);
  console.log(`\n완료. 다음 단계: 웹에서 엑셀 업로드(⑤) → 검토·반영 → 회원 연결(⑥) → 검수(⑦) → 마감(⑧).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
