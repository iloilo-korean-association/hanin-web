import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient 싱글턴.
 *
 * Next.js dev 서버는 파일이 바뀔 때마다 모듈을 다시 평가한다.
 * 그때마다 new PrismaClient() 를 하면 커넥션이 계속 쌓여 SQLite 가 잠긴다.
 * globalThis 에 물려 두면 HMR 을 건너 살아남는다. (pialms src/lib/db.ts 와 같은 패턴)
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function buildClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * 대화형 트랜잭션 안에서 쓰는 클라이언트 타입.
 *
 * 채번(I2)·상태전이(I3/I4)처럼 "읽고 → 판정하고 → 쓰는" 경로는 반드시
 * prisma.$transaction(async (tx) => { ... }) 안에서 이 타입을 받아 처리한다.
 *
 *   await prisma.$transaction(async (tx: Tx) => {
 *     const no = await nextReceiptNo(tx, 2026);
 *     await tx.transaction.create({ data: { receiptNo: no.receiptNo, ... } });
 *   });
 */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** prisma 와 Tx 어느 쪽이든 받는 자리에 쓴다. */
export type Db = PrismaClient | Tx;
