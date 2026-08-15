/**
 * 협력 법률사무소 요금표 → 서비스(Service) 등록.
 *
 * 원본: "Schedule of Fees, TANATE & AM LAW OFFICE.docx"
 *       (SCHEDULE OF PROFESSIONAL FEES AND LEGAL SERVICES · Atty. Marianie C. Tanate)
 *
 * ★ 왜 요금표 22행을 8건으로 묶었나
 *   Service.fee 는 **정수 한 개**다. 요금표는 대부분 범위(₱1,500–₱2,500)이거나
 *   계산식(계약가의 3%)이라 숫자 하나로 표현되지 않는다.
 *   그래서 fee 에는 **최소 금액**만 넣고, 원문 요금 문구는 설명(description)에 그대로 적는다.
 *   fee=0 은 공개 화면에서 "무료" 배지가 되므로 어떤 항목에도 0 을 쓰지 않는다.
 *
 * ★ 지어내지 않은 것만 적는다
 *   연락처·주소·이메일은 원본 문서에 적힌 값 그대로다. 서비스 범위는 원문 항목명 이상으로 부풀리지 않았다.
 *   전화번호는 두 개(0998-866-6079 / 0947-990-4868)지만 contactPhone 에는 **한 개만** 넣는다 —
 *   공개 페이지가 tel: 링크를 만들 때 숫자만 남기므로 두 개를 넣으면 이어붙어 못 쓰는 번호가 된다.
 *
 * ★ 삭제하지 않는다. 같은 제목이면 갱신(upsert)한다 — 여러 번 돌려도 안전하다.
 *
 * 실행: npx tsx prisma/register-law-services.ts
 *       npx tsx prisma/register-law-services.ts --dry   (쓰지 않고 검증·미리보기만)
 */
import { PrismaClient } from "@prisma/client";

import { firstIssue, serviceInputSchema } from "../src/lib/validators";

const prisma = new PrismaClient();

const DRY = process.argv.includes("--dry");

/** 원본 문서에 적힌 값. 지어낸 것이 하나도 없어야 한다. */
const FIRM = "TANATE & AM LAW OFFICE";
const FIRM_PHONE = "0998-866-6079"; // 두 번째 번호 0947-990-4868 은 신청 방법 안내에 적는다
const PROVIDER = `협력 법률사무소 ${FIRM} 제공.`;

/** 모든 항목 공통 신청 안내. 사무실 주소·이메일·두 번째 번호가 여기 들어간다. */
const HOW_TO_APPLY =
  "법률사무소로 직접 연락하시거나(0998-866-6079 · 0947-990-4868 · mmtanate12@gmail.com), " +
  "한인회 문의 페이지(/help)로 알려 주시면 연결해 드립니다. " +
  "사무실 — 일로일로시: 2/F Bienvinida Building, Brgy. Sambag, Jaro / 레온: 2/F Tanate Building, Calumay St., Brgy. Poblacion, Leon.";

const SOURCE_NOTE =
  `${FIRM} 요금표(Schedule of Professional Fees and Legal Services) 기준 등록. ` +
  "표시 금액은 최소 금액이며 정확한 요금 문구는 설명란에 있다.";

type Row = {
  title: string;
  category: string;
  fee: number;
  description: string;
  note?: string;
};

const ROWS: Row[] = [
  {
    title: "법률 상담",
    category: "생활정착",
    fee: 1_000,
    description:
      `${PROVIDER}\n` +
      "- 초기 상담(1시간까지) ₱1,000/시간\n" +
      "- 상담 + 서면 법률의견 ₱1,500~2,500\n" +
      "- 법률 검토·예비 의견서 ₱1,500~2,500/시간\n" +
      "※ 한국어 통번역이 필요하면 통번역비가 별도로 붙습니다.",
  },
  {
    title: "이민(비자) 법률 상담",
    category: "생활정착",
    fee: 2_000,
    description:
      `${PROVIDER}\n` +
      "- 이민 관련 법률 상담 ₱2,000~5,000\n" +
      "※ 비자 신청·연장 대행 자체는 '이민국 비자업무' 항목을 보십시오.",
    note: "요금표의 Immigration consultation. 기존 SV07(이민국 비자업무, ₱500)은 신청 대행이라 별개 항목으로 둔다.",
  },
  {
    title: "공증·진술서(Affidavit)·인증",
    category: "행정지원",
    fee: 300,
    description:
      `${PROVIDER}\n` +
      "- 단순 진술서(Affidavit) 작성 ₱300~\n" +
      "- 공증 지원(Notarial) ₱300~\n" +
      "- 진술서 작성 + 공증 ₱500~\n" +
      "- 인증(Authentication) ₱500 또는 ₱100/장\n" +
      "※ 관공서 수수료·교통·등기 등 실비는 별도 청구됩니다.",
  },
  {
    title: "서류 검토·변호사 명의 통지서",
    category: "행정지원",
    fee: 1_000,
    description:
      `${PROVIDER}\n` +
      "- 청구·변호사 명의 통지서(Demand Letter) ₱1,000~2,500\n" +
      "- 서류 검토 ₱1,500~3,000/시간",
  },
  {
    title: "계약서 검토·작성",
    category: "행정지원",
    fee: 2_000,
    description:
      `${PROVIDER}\n` +
      "- 계약서 검토·작성 ₱5,000~15,000+ (복잡도에 따라)\n" +
      "- 동산 매매계약서 계약금액의 3% 또는 최소 ₱2,000\n" +
      "- 부동산 매매계약서 계약금액의 3% 또는 최소 ₱5,000",
  },
  {
    title: "부동산·콘도 소유권 이전 대행",
    category: "행정지원",
    fee: 25_000,
    description:
      `${PROVIDER} 토지·콘도미니엄 소유권 이전 처리.\n` +
      "- 권리관계가 깨끗한 경우(Clean Title) ₱25,000\n" +
      "- 상속재산 정리(Settlement of Estate)를 포함하는 경우 ₱50,000\n" +
      "※ 관공서 수수료·교통·등기 등 실비는 별도 청구됩니다.",
    note:
      "요금표의 '차량 등록 명의이전 ₱5,000' 은 기존 SV10(차량 서비스, ₱5,000)과 같은 항목이라 " +
      "공개 화면에 두 번 뜨지 않도록 새로 등록하지 않았다.",
  },
  {
    title: "법인·사업 법률 상담 및 TIN 신청",
    category: "행정지원",
    fee: 2_000,
    description:
      `${PROVIDER}\n` +
      "- 법인·사업 법률 상담 ₱2,000~5,000/시간\n" +
      "- 납세자번호(TIN) 신청 ₱3,000\n" +
      "※ 법인 설립 대행 자체는 '법인설립' 항목을 보십시오.",
    note: "기존 SV09(법인설립, ₱20,000)는 설립 대행이라 별개 항목으로 둔다.",
  },
  {
    title: "단체 고문 계약·소송 대리",
    category: "기타",
    fee: 10_000,
    description:
      `${PROVIDER}\n` +
      "- 단체 월 고문 계약(Retainer) ₱10,000~25,000+\n" +
      "- 소송 대리: 사안별 별도 견적 (IBP 일로일로 기준을 최소 참고선으로 함)",
    note: "소송은 원본에 금액이 없다(별도 견적). 표시 금액 ₱10,000 은 월 고문 계약의 최소액이다.",
  },
];

/** 같은 분류 안에서 한인회 자체 서비스(0·10·20) 뒤에 오도록. */
const SORT_ORDER = 30;

async function nextServiceId(): Promise<string> {
  const last = await prisma.service.findFirst({
    orderBy: { serviceId: "desc" },
    select: { serviceId: true },
  });
  const n = last ? Number(last.serviceId.replace(/\D/g, "")) + 1 : 1;
  return "SV" + String(n).padStart(2, "0");
}

/** 감사로그 append. src/lib/audit.ts 는 server-only 라 스크립트에서 못 부른다 — 같은 규칙만 옮겨 온다. */
async function appendAuditLog(input: {
  actor: string;
  tableName: string;
  recordKey: string;
  beforeValue: string;
  afterValue: string;
  changeType: string;
  note: string;
}): Promise<void> {
  const last = await prisma.auditLog.findFirst({
    orderBy: { logId: "desc" },
    select: { logId: true },
  });
  const n = last ? Number(last.logId.replace(/\D/g, "")) + 1 : 1;
  await prisma.auditLog.create({
    data: {
      logId: "AU-" + String(n).padStart(6, "0"),
      ...input,
      fieldName: "",
      severity: "INFO",
      relatedKey: "",
    },
  });
}

async function main() {
  console.log(`  대상 DB: ${(process.env.DATABASE_URL ?? "").replace(/\/\/[^@]+@/, "//***@")}`);
  console.log(`  원본   : Schedule of Fees, ${FIRM}${DRY ? "   [DRY RUN — 쓰지 않는다]" : ""}`);
  console.log("");

  let created = 0;
  let updated = 0;

  for (const row of ROWS) {
    // 서버가 하는 것과 **같은** 검증을 먼저 통과시킨다. 화면으로 넣었을 때와 결과가 달라지면 안 된다.
    const parsed = serviceInputSchema.safeParse({
      title: row.title,
      category: row.category,
      description: row.description,
      howToApply: HOW_TO_APPLY,
      contactName: `협력 법률사무소 ${FIRM}`,
      contactPhone: FIRM_PHONE,
      fee: row.fee,
      status: "운영중",
      isPublic: true,
      sortOrder: SORT_ORDER,
      note: row.note ? `${row.note} · ${SOURCE_NOTE}` : SOURCE_NOTE,
    });
    if (!parsed.success) {
      throw new Error(`[검증 실패] ${row.title} — ${firstIssue(parsed.error)}`);
    }
    const data = parsed.data;

    // 멱등성: ID 가 아니라 **제목**으로 찾는다. 그 사이 임원이 다른 서비스를 등록해도 ID 가 밀리지 않는다.
    const existing = await prisma.service.findFirst({ where: { title: data.title } });
    const id = existing?.serviceId ?? (DRY ? "(신규)" : await nextServiceId());

    if (DRY) {
      console.log(`  ${existing ? "갱신" : "신규"} ${id} ${data.title} · ${data.category} · ₱${data.fee.toLocaleString()}`);
      console.log(`      ${data.description.replace(/\n/g, "\n      ")}`);
      console.log("");
      if (existing) updated += 1;
      else created += 1;
      continue;
    }

    if (existing) {
      await prisma.service.update({ where: { serviceId: id }, data });
      updated += 1;
    } else {
      await prisma.service.create({ data: { serviceId: id, ...data } });
      created += 1;
    }

    await appendAuditLog({
      actor: "SCRIPT/register-law-services",
      tableName: "Service",
      recordKey: id,
      beforeValue: existing
        ? `${existing.title} / ${existing.category} / ₱${existing.fee} / ${existing.status} / 공개 ${existing.isPublic ? "Y" : "N"}`
        : "",
      afterValue: `${data.title} / ${data.category} / ₱${data.fee} / ${data.status} / 공개 ${data.isPublic ? "Y" : "N"}`,
      changeType: existing ? "EDIT" : "INSERT",
      note: `${FIRM} 요금표 ${existing ? "갱신" : "등록"} (register-law-services.ts)`,
    });

    console.log(`  ${existing ? "갱신" : "신규"} ${id} ${data.title} · ${data.category} · ₱${data.fee.toLocaleString()}`);
  }

  console.log("");
  console.log(`  신규 ${created}건 / 갱신 ${updated}건 · 합계 ${ROWS.length}건`);

  if (!DRY) {
    const live = await prisma.service.count({ where: { isPublic: true, status: "운영중" } });
    console.log(`  공개 페이지(/services)에 나가는 서비스: 총 ${live}건`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
