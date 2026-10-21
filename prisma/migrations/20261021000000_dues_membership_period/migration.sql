-- 회원 자격 기간 — 회비 완납일부터 1년 (대표 결정 2026-10-21)
--
-- DuesInvoice 에 nullable 컬럼 2개만 붙인다. 기존 행은 둘 다 NULL 로 남고 값은 바뀌지 않는다.
--   validFrom  = 회원 기간 시작일 (yyyy-MM-dd) — 완납일, 면제는 고지일, 이어붙이면 직전 만료일 다음 날
--   validUntil = 회원 기간 만료일 (yyyy-MM-dd) — 시작일 + 1년 - 1일
--
-- ★ 기존 완납·면제 고지의 기간은 이 파일이 채우지 않는다.
--   prisma/backfill-membership-period.ts (드라이런 기본, --apply 로 적용) 로 따로 채운다.
--   이 마이그레이션은 컬럼 추가뿐이라 이전 코드(새 컬럼을 모르는 Prisma 클라이언트)와도 함께 돈다 —
--   Prisma 는 SELECT 에 컬럼을 명시하므로 모르는 컬럼은 읽지도 쓰지도 않는다.

-- AlterTable
ALTER TABLE "DuesInvoice" ADD COLUMN "validFrom" TEXT;
ALTER TABLE "DuesInvoice" ADD COLUMN "validUntil" TEXT;
