import "server-only";

import { prisma } from "@/lib/db";

import type { Contact, ContactGroup, Grade } from "./emergency";

/**
 * 긴급 연락처를 DB에서 읽어 화면이 쓰는 모양(ContactGroup[])으로 돌려준다.
 *
 * 원래는 `emergency.ts` 안에 상수로 박혀 있었다. 전화번호 하나 고치려고
 * 개발자를 불러 재배포해야 했기 때문에 DB로 옮겼고(관리 화면: /officer/contacts),
 * **화면 컴포넌트는 그대로 재사용**한다 — 타입을 맞춰서 돌려주기 때문이다.
 *
 * 영문 제목과 설명은 화면 문구라 코드에 남겨 둔다(자주 바뀌지 않고, 번역 품질이 중요하다).
 */

const GROUP_META: Record<string, { titleEn: string; description?: string; order: number }> = {
  national: { titleEn: "National Emergency", order: 0 },
  consular: {
    titleEn: "Korean Missions",
    description:
      "체포·사망·실종·여권 분실은 반드시 공관에 알립니다. 야간·주말은 긴급 번호로만 연결됩니다.",
    order: 1,
  },
  police: { titleEn: "Police & Fire", order: 2 },
  rescue: { titleEn: "Rescue & Disaster", order: 3 },
  hospital: {
    titleEn: "Hospitals",
    description: "중증은 이송 시간이 결과를 가릅니다. 가까운 곳보다 감당 가능한 곳으로 갑니다.",
    order: 4,
  },
  civil: { titleEn: "Civil & Utilities", order: 5 },
};

function toContact(r: {
  name: string;
  nameEn: string;
  numbers: string;
  note: string;
  hours: string;
  email: string;
  address: string;
  grade: string;
  emphasis: boolean;
}): Contact {
  const numbers = r.numbers ? r.numbers.split("|").filter(Boolean) : [];
  return {
    name: r.name,
    nameEn: r.nameEn || undefined,
    numbers,
    note: r.note || undefined,
    hours: r.hours || undefined,
    email: r.email || undefined,
    address: r.address || undefined,
    // 번호가 없으면 무조건 '확인 중'. 화면이 번호 자리를 비우고 그렇게 표시한다.
    grade: (numbers.length === 0 ? "pending" : (r.grade as Grade)) satisfies Grade,
    emphasis: r.emphasis || undefined,
  };
}

export type LoadedContacts = {
  /** 맨 위에 크게 뜨는 전국 긴급번호(911). 없으면 null */
  national: Contact | null;
  groups: ContactGroup[];
  /** 가장 최근에 사람이 확인한 날짜 (yyyy-MM-dd). 화면에 그대로 표시한다 */
  verifiedOn: string;
};

export async function loadEmergencyContacts(): Promise<LoadedContacts> {
  const rows = await prisma.emergencyContact.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  let national: Contact | null = null;
  const byGroup = new Map<string, { title: string; items: Contact[] }>();

  for (const r of rows) {
    if (r.groupId === "national" && !national) {
      national = toContact(r);
      continue;
    }
    const g = byGroup.get(r.groupId) ?? { title: r.groupTitle, items: [] };
    g.items.push(toContact(r));
    byGroup.set(r.groupId, g);
  }

  const groups: ContactGroup[] = [...byGroup.entries()]
    .map(([id, g]) => ({
      id,
      title: g.title,
      titleEn: GROUP_META[id]?.titleEn ?? "",
      description: GROUP_META[id]?.description,
      items: g.items,
    }))
    .sort((a, b) => (GROUP_META[a.id]?.order ?? 9) - (GROUP_META[b.id]?.order ?? 9));

  // 확인된 항목 중 가장 최근 날짜. 하나도 없으면 빈 문자열 → 화면이 "확인 중" 을 안내한다.
  const verifiedOn = rows
    .map((r) => r.verifiedOn)
    .filter(Boolean)
    .sort()
    .pop();

  return { national, groups, verifiedOn: verifiedOn ?? "" };
}
