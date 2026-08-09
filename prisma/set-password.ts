/**
 * 임원 비밀번호 설정 · 재설정 (CLI).
 *
 *   npx tsx prisma/set-password.ts <이메일> <새비밀번호>
 *   npx tsx prisma/set-password.ts --list          ← 계정과 비밀번호 설정 여부만 확인
 *
 * 왜 CLI 로 두는가:
 *   화면에서 남의 비밀번호를 바꿀 수 있게 만들면, 임원관리 권한자가 다른 임원으로
 *   위장해 거래를 입력할 수 있다. 그러면 감사로그의 actor 가 거짓이 되고,
 *   불변식 I4(현금 2인 확인)가 무력화된다 — 한 사람이 두 사람 노릇을 하게 된다.
 *   그래서 비밀번호 재설정은 DB 접근 권한을 가진 사람만, 흔적을 남기며 한다.
 *
 * ★ 실행하면 감사로그에 CRITICAL 로 남는다. 비밀번호 자체는 로그에 남기지 않는다.
 */
import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** auth.ts 의 BCRYPT_ROUNDS 와 같아야 한다. 다르면 로그인 타이밍이 어긋난다. */
const BCRYPT_ROUNDS = 10;
const MIN_LENGTH = 12;

async function nextLogId(): Promise<string> {
  const last = await prisma.auditLog.findFirst({
    orderBy: { logId: "desc" },
    select: { logId: true },
  });
  const n = last ? Number(last.logId.replace(/\D/g, "")) + 1 : 1;
  return `AU-${String(n).padStart(6, "0")}`;
}

async function list(): Promise<void> {
  const officers = await prisma.officer.findMany({
    orderBy: { officerId: "asc" },
    include: { credential: { select: { updatedAt: true } } },
  });
  console.log("\n임원 계정\n");
  for (const o of officers) {
    console.log(
      `  ${o.officerId}  ${o.email.padEnd(30)} ${o.name}(${o.role})  ` +
        `${o.status}  ` +
        (o.credential
          ? `비밀번호 설정됨 (${o.credential.updatedAt.toISOString().slice(0, 10)})`
          : "★ 비밀번호 없음 — 로그인 불가"),
    );
  }
  console.log("");
}

async function main(): Promise<void> {
  const [emailRaw, password] = process.argv.slice(2);

  if (emailRaw === "--list" || !emailRaw) {
    await list();
    if (!emailRaw) {
      console.log("사용법: npx tsx prisma/set-password.ts <이메일> <새비밀번호>\n");
      process.exitCode = 1;
    }
    return;
  }

  // 소문자로 저장한다 — signInOfficer 가 소문자로 조회한다(SQLite 호환 흔적).
  const email = emailRaw.trim().toLowerCase();
  const officer = await prisma.officer.findFirst({
    where: { email },
    select: { officerId: true, name: true, role: true, status: true },
  });
  if (!officer) {
    console.error(`[중단] ${email} 은 임원 계정이 아닙니다. --list 로 확인하십시오.`);
    process.exitCode = 1;
    return;
  }

  const plain = password?.trim() || randomBytes(12).toString("base64url");
  const generated = !password?.trim();
  if (plain.length < MIN_LENGTH) {
    console.error(`[중단] 비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(plain, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.officerCredential.upsert({
      where: { officerId: officer.officerId },
      create: { officerId: officer.officerId, passwordHash },
      update: { passwordHash },
    });
    await tx.auditLog.create({
      data: {
        logId: await nextLogId(),
        actor: "cli:set-password",
        tableName: "OfficerCredential",
        recordKey: officer.officerId,
        fieldName: "passwordHash",
        // 비밀번호는 남기지 않는다. 남았다는 사실만 남긴다.
        beforeValue: "(생략)",
        afterValue: "(재설정됨)",
        changeType: "SCRIPT",
        severity: "CRITICAL",
        relatedKey: email,
        note: `비밀번호 재설정 — ${officer.name}(${officer.role})`,
      },
    });
  });

  // 되돌려 확인한다. "바꿨다" 는 말만 하고 실제로 로그인이 안 되면 아무 소용이 없다.
  const check = await prisma.officerCredential.findUnique({
    where: { officerId: officer.officerId },
    select: { passwordHash: true },
  });
  const verified = check ? await bcrypt.compare(plain, check.passwordHash) : false;

  console.log(
    `\n  ${verified ? "완료" : "★ 실패 — 저장은 됐으나 검증에 실패"}` +
      `\n  계정   ${email}  (${officer.name} · ${officer.role} · ${officer.status})` +
      (generated ? `\n  비밀번호  ${plain}   ← 임의 생성. 지금 옮겨 적으십시오.` : "") +
      `\n  검증   bcrypt.compare = ${verified}` +
      (officer.status !== "ACTIVE"
        ? "\n  ★ 계정이 ACTIVE 가 아닙니다. 비밀번호가 맞아도 로그인은 막힙니다."
        : "") +
      "\n",
  );
  if (!verified) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
