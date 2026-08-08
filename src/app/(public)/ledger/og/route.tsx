import { ImageResponse } from "next/og";

import { prisma } from "@/lib/db";
import {
  buildPublicLedger,
  buildRealNameList,
  fiscalYearOf,
  formatMoney,
  loadSettings,
  publicPolicyFrom,
  todayManila,
  type AccountRow,
  type CategoryRow,
  type FundRow,
  type TxRow,
} from "@/lib/domain";
import { ORG_NAME, ORG_NAME_EN } from "@/lib/site";

import { OG, OG_SIZE, loadKoreanFonts, ogFontOption } from "../../_components/og-font";

/**
 * GET /ledger/og — 공개 회계 화면의 카톡 썸네일 카드 (1200×630 PNG).
 *
 * 카드에 실제 숫자를 찍는다. 카톡에 링크를 붙이면 열어 보지 않아도
 * "얼마 걷어서 얼마 썼고 얼마 남았나" 가 썸네일에 보인다.
 * Apps Script 로는 og: 태그 자체가 불가능했던 부분이다.
 *
 * ★ 여기에는 회원 실명이 들어갈 수 없다 — 집계 숫자만 쓴다.
 * ★ 숫자를 못 읽어도 카드는 나와야 한다. DB 조회가 실패하면 숫자 없이 제목만 그린다.
 * ★ 파일 규약(opengraph-image.tsx) 대신 라우트 핸들러인 이유는 sos/og/route.tsx 주석 참조.
 */
export const alt = `${ORG_NAME} 공개 회계 — 지출 건별 전액 공개`;
export const size = OG_SIZE;

/** 숫자가 항상 최신이어야 한다. 카드가 어제 숫자를 들고 돌아다니면 안 된다. */
export const dynamic = "force-dynamic";

type Totals = { fy: number; income: number; expense: number; balance: number; posted: number };

async function loadTotals(): Promise<Totals | null> {
  try {
    const today = todayManila();
    const settings = await loadSettings(prisma);
    const policy = publicPolicyFrom(settings);
    const years = await prisma.fiscalYear.findMany({ orderBy: { year: "desc" } });
    const fy = years.find((y) => y.status === "OPEN")?.year ?? years[0]?.year ?? fiscalYearOf(today);

    const [txs, accounts, funds, categories, members] = await Promise.all([
      prisma.transaction.findMany({ where: { fiscalYear: fy }, orderBy: { seq: "asc" } }),
      prisma.account.findMany(),
      prisma.fund.findMany(),
      prisma.category.findMany(),
      prisma.member.findMany({ select: { name: true } }),
    ]);

    const ledger = buildPublicLedger(
      txs as unknown as TxRow[],
      accounts as unknown as AccountRow[],
      funds as unknown as FundRow[],
      categories as unknown as CategoryRow[],
      { fiscalYear: fy, today, realNames: buildRealNameList(members.map((m) => m.name)), ...policy },
    );

    return {
      fy,
      income: ledger.totalIncome,
      expense: ledger.totalExpense,
      balance: ledger.accountTotals.balance,
      posted: ledger.metrics.postedCount,
    };
  } catch {
    // 카드가 안 나오는 것보다 숫자 없는 카드가 낫다.
    return null;
  }
}

export async function GET() {
  const fonts = loadKoreanFonts();
  const ko = fonts.length > 0;
  const t = await loadTotals();

  const heading = ko ? "공개 회계" : "Open Ledger";
  const org = ko ? ORG_NAME : ORG_NAME_EN;
  const tagline = ko
    ? "지출은 건별 전액 공개 · 수입은 집계 · 영수증번호 결번 없음"
    : "Every expense disclosed · Income aggregated · Gapless receipts";

  const cells: { label: string; value: string; color: string }[] = t
    ? [
        // ₱(U+20B1) 는 시스템 한글 폰트에 없는 경우가 많아 카드에서 두부(□)가 된다.
        // 카드에서만 'PHP' 로 적는다. 화면·인쇄는 formatPeso 가 그대로 ₱ 를 쓴다.
        { label: ko ? "총수입" : "Income", value: `PHP ${formatMoney(t.income)}`, color: OG.success },
        { label: ko ? "총지출" : "Expense", value: `PHP ${formatMoney(t.expense)}`, color: OG.gold },
        { label: ko ? "잔액" : "Balance", value: `PHP ${formatMoney(t.balance)}`, color: OG.white },
      ]
    : [];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundColor: OG.navy,
          backgroundImage: `linear-gradient(135deg, ${OG.navy} 0%, ${OG.navyDeep} 100%)`,
          fontFamily: ko ? "KO" : "sans-serif",
          color: OG.white,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 2, color: OG.pale }}>
            {org} · {t ? `${t.fy}` : ""} ILOILO
          </div>
          <div style={{ display: "flex", marginTop: 8, fontSize: 76, fontWeight: 700 }}>
            {heading}
          </div>
          <div
            style={{ display: "flex", marginTop: 20, width: 130, height: 8, borderRadius: 4, backgroundColor: OG.gold }}
          />
        </div>

        {cells.length > 0 ? (
          <div style={{ display: "flex", gap: 20 }}>
            {cells.map((c) => (
              <div
                key={c.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  padding: "22px 26px",
                  borderRadius: 20,
                  border: "2px solid rgba(182,207,234,0.45)",
                  backgroundColor: "rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ display: "flex", fontSize: 26, color: OG.pale }}>{c.label}</div>
                <div style={{ display: "flex", marginTop: 8, fontSize: 46, fontWeight: 700, color: c.color }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 34, color: OG.pale }}>{tagline}</div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 26, color: OG.pale, maxWidth: 820 }}>
            {tagline}
          </div>
          {t ? (
            <div style={{ display: "flex", fontSize: 24, color: OG.pale }}>
              {ko ? `확정 거래 ${t.posted}건` : `${t.posted} posted`}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { ...size, fonts: ogFontOption(fonts) },
  );
}
