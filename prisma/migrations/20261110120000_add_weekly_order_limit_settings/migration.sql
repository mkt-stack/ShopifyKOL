-- CreateTable
CREATE TABLE "WeeklyOrderLimitSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultLimit" INTEGER NOT NULL DEFAULT 3,
    "exemptTags" JSONB NOT NULL DEFAULT '[]',
    "overrides" JSONB NOT NULL DEFAULT '[]',
    "messages" JSONB NOT NULL DEFAULT '{}',
    "validationId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyOrderLimitSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyOrderLimitSettings_shop_key" ON "WeeklyOrderLimitSettings"("shop");
