-- CreateTable
CREATE TABLE "EmergencyContact" (
    "contactId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupTitle" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "numbers" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "hours" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "emphasis" BOOLEAN NOT NULL DEFAULT false,
    "grade" TEXT NOT NULL DEFAULT 'pending',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "verifiedOn" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("contactId")
);

-- CreateIndex
CREATE INDEX "EmergencyContact_groupId_sortOrder_idx" ON "EmergencyContact"("groupId", "sortOrder");

-- CreateIndex
CREATE INDEX "EmergencyContact_isActive_idx" ON "EmergencyContact"("isActive");

-- CreateIndex
CREATE INDEX "EmergencyContact_grade_idx" ON "EmergencyContact"("grade");
