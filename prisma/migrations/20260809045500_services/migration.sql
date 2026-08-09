-- CreateTable
CREATE TABLE "Service" (
    "serviceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "howToApply" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT NOT NULL DEFAULT '',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "fee" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT '준비',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Service_pkey" PRIMARY KEY ("serviceId")
);

-- CreateIndex
CREATE INDEX "Service_status_idx" ON "Service"("status");

-- CreateIndex
CREATE INDEX "Service_category_sortOrder_idx" ON "Service"("category", "sortOrder");

