/**
 * 관리자 계정(OF99) 복구 · 보장.
 *
 *   npx tsx prisma/ensure-admin.ts [비밀번호]
 *
 * 왜 별도 스크립트인가:
 *   prisma/seed.ts 는 officer / officerCredential 을 deleteMany 로 지우고 다시 만든다.
 *   시드가 만드는 임원은 OF01~OF05 뿐이라, 시드를 한 번 돌리면
 *   ① 관리자 계정이 사라지고 ② 나머지 임원 비밀번호가 새 난수로 바뀌고
 *   ③ 위임해 둔 권한이 시드 기본값으로 되돌아간다.
 *   그때 이 스크립트 하나로 관리자 접근을 되살린다.
 *
 * ★ 관리자에게는 PERMISSIONS 전체를 준다 — '임원관리' 를 가진 사람이 최소 한 명은
 *   있어야 하고, 없으면 아무도 권한을 되돌릴 수 없다(복구 불가 상태).
 */
import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

import { PERMISSIONS, SYSTEM_ADMIN_ROLE } from "../src/lib/validators/enums";

const prisma = new PrismaClient();

const OFFICER_ID = "OF99";
const MEMBER_NO = "M9999";
const EMAIL = "admin@ika-iloilo.org";
const LINK_TOKEN = "adminsys"; // 8자 — Member.linkToken 규약
const BCRYPT_ROUNDS = 10; // auth.ts 와 같아야 한다

async function main(): Promise<void> {
  const plain = process.argv[2]?.trim() || randomBytes(9).toString("base64url");
  const generated = !process.argv[2]?.trim();

  // duesGrade 는 Setting '회비단가.*' 키와 맞아야 한다 → 기존 회원 값을 그대로 빌려 쓴다.
  const sample = await prisma.member.findFirst({ select: { duesGrade: true } });
  const duesGrade = sample?.duesGrade ?? "준회원";
  const today = new Date().toISOString().slice(0, 10);

  // 임원은 회원이어야 한다(FK). 관리자는 사람이 아니므로 명부에서 빠지도록
  // status=INACTIVE · 명부공개 미동의 · 알림 미수신으로 둔다.
  await prisma.member.upsert({
    where: { memberNo: MEMBER_NO },
    create: {
      memberNo: MEMBER_NO,
      name: "시스템 관리자",
      joinedOn: today,
      memberType: "명예",
      status: "INACTIVE",
      duesGrade,
      rosterConsent: false,
      notifyConsent: false,
      linkToken: LINK_TOKEN,
      note: "시스템 관리자 계정용. 실제 사람이 아니다 — 명부·회비 집계에서 제외한다.",
      createdBy: "ensure-admin",
    },
    update: { name: "시스템 관리자", status: "INACTIVE" },
  });

  const permissions = PERMISSIONS.join(",");
  await prisma.officer.upsert({
    where: { officerId: OFFICER_ID },
    create: {
      officerId: OFFICER_ID,
      memberNo: MEMBER_NO,
      name: "시스템 관리자",
      role: SYSTEM_ADMIN_ROLE, // '관리자' — /about 공개 임원 명단에서 제외되는 역할명
      termStart: today,
      termEnd: "2099-12-31",
      email: EMAIL,
      permissions,
      approvalLimit: 0, // 승인은 사람이 한다. 관리자는 화면을 열 뿐이다.
      status: "ACTIVE",
      note: "시스템 관리자. 실제 승인·집행은 임원 본인 계정으로 한다.",
    },
    update: { permissions, status: "ACTIVE", role: SYSTEM_ADMIN_ROLE },
  });

  const passwordHash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
  await prisma.officerCredential.upsert({
    where: { officerId: OFFICER_ID },
    create: { officerId: OFFICER_ID, passwordHash },
    update: { passwordHash },
  });

  // 되돌려 확인한다. "만들었다" 는 말만 하고 로그인이 안 되면 아무 소용이 없다.
  const saved = await prisma.officerCredential.findUnique({
    where: { officerId: OFFICER_ID },
    select: { passwordHash: true },
  });
  const verified = saved ? await bcrypt.compare(plain, saved.passwordHash) : false;

  console.log(
    `\n  ${verified ? "관리자 계정 준비 완료" : "★ 실패 — 저장은 됐으나 검증에 실패"}` +
      `\n  주소     ${EMAIL}` +
      `\n  비밀번호  ${plain}${generated ? "   ← 임의 생성. 지금 옮겨 적으십시오." : ""}` +
      `\n  권한     ${permissions}` +
      `\n  검증     bcrypt.compare = ${verified}\n`,
  );
  if (!verified) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
