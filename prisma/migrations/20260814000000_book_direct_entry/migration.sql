-- 직접 입력 장부(/officer/book) 전환 — Transaction 에 3개 컬럼.
--
-- updatedAt 을 그냥 NOT NULL 로 붙이면 기존 행에서 실패한다(기본값 없음).
-- 그렇다고 CURRENT_TIMESTAMP 로 채우면 과거 거래가 전부 '방금 수정됨' 이 되어
-- 공개 장부에 "119건이 수정되었습니다" 라고 뜬다. 사실이 아니다.
-- → enteredAt 으로 채운다. updatedAt == enteredAt 이면 "한 번도 안 고쳤다" 는 뜻이 된다.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "reviewedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Transaction" ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "Transaction" SET "updatedAt" = "enteredAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "Transaction" ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Transaction_reviewedAt_idx" ON "Transaction"("reviewedAt");
