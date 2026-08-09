/**
 * 긴급 연락처를 코드 파일(_data/emergency.ts) → DB(EmergencyContact) 로 옮긴다.
 *
 * 한 번만 돌리면 되지만 **멱등**하다 — 같은 contactId 는 upsert 한다.
 * 원본의 검증등급(grade)과 "번호 없으면 pending" 규칙을 그대로 가져온다.
 *
 * 실행: npx tsx prisma/migrate-contacts.ts
 */
import { PrismaClient } from "@prisma/client";

import {
  CONTACT_GROUPS,
  CONTACTS_VERIFIED_ON,
  NATIONAL_EMERGENCY,
  type Contact,
} from "../src/app/(public)/_data/emergency";

const prisma = new PrismaClient();

/** 원본에 출처 URL 필드가 없었다. 주석에 있던 것을 그룹 단위로 옮겨 적는다. */
const GROUP_SOURCE: Record<string, string> = {
  national: "https://en.wikipedia.org/wiki/911_(Philippines)",
  consular: "https://overseas.mofa.go.kr/ph-cebu-ko/index.do",
  police: "https://pnp.gov.ph/",
  rescue: "https://ndrrmc.gov.ph/",
  hospital: "",
  civil: "",
};

async function main() {
  let seq = 0;
  const rows: {
    contactId: string;
    groupId: string;
    groupTitle: string;
    sortOrder: number;
    c: Contact;
  }[] = [];

  // 전국 긴급번호는 그룹 밖에 따로 있다. 맨 앞에 넣는다.
  rows.push({
    contactId: "EC-0001",
    groupId: "national",
    groupTitle: "전국 긴급",
    sortOrder: 0,
    c: NATIONAL_EMERGENCY,
  });
  seq = 1;

  for (const g of CONTACT_GROUPS) {
    let i = 0;
    for (const c of g.items) {
      seq += 1;
      rows.push({
        contactId: `EC-${String(seq).padStart(4, "0")}`,
        groupId: g.id,
        groupTitle: g.title,
        sortOrder: i,
        c,
      });
      i += 1;
    }
  }

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const { c } = r;
    // 원본 규칙: 번호가 없으면 미확인이다.
    const grade = c.numbers.length === 0 ? "pending" : c.grade;
    const data = {
      groupId: r.groupId,
      groupTitle: r.groupTitle,
      sortOrder: r.sortOrder,
      name: c.name,
      nameEn: c.nameEn ?? "",
      numbers: c.numbers.join("|"),
      note: c.note ?? "",
      hours: c.hours ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
      emphasis: c.emphasis ?? false,
      grade,
      sourceUrl: grade === "pending" ? "" : (GROUP_SOURCE[r.groupId] ?? ""),
      verifiedOn: grade === "pending" ? "" : CONTACTS_VERIFIED_ON,
      isActive: true,
      updatedBy: "MIGRATION",
    };
    const existing = await prisma.emergencyContact.findUnique({
      where: { contactId: r.contactId },
    });
    await prisma.emergencyContact.upsert({
      where: { contactId: r.contactId },
      create: { contactId: r.contactId, ...data },
      update: data,
    });
    if (existing) updated += 1;
    else created += 1;
  }

  const byGrade = await prisma.emergencyContact.groupBy({
    by: ["grade"],
    _count: true,
  });

  console.log(`  생성 ${created}건 / 갱신 ${updated}건 · 합계 ${rows.length}건`);
  console.log("  검증등급별:");
  for (const g of byGrade) {
    const label =
      g.grade === "verified" ? "공식 확인" : g.grade === "secondary" ? "2차 출처" : "확인 중";
    console.log(`    ${label.padEnd(10)} ${g._count}건`);
  }

  const pending = await prisma.emergencyContact.findMany({
    where: { grade: "pending" },
    select: { name: true },
  });
  if (pending.length) {
    console.log("  ★ 번호가 비어 화면에 '확인 중' 으로 뜨는 항목:");
    pending.forEach((p) => console.log(`    - ${p.name}`));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
