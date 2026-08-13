-- CreateTable
CREATE TABLE "OrderQuotaAdjustment" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "extraQuota" INTEGER NOT NULL,
    "newTotalQuota" INTEGER NOT NULL,
    "adjustedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderQuotaAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderQuotaAdjustment_shop_orderId_idx" ON "OrderQuotaAdjustment"("shop", "orderId");

-- CreateIndex
CREATE INDEX "OrderQuotaAdjustment_createdAt_idx" ON "OrderQuotaAdjustment"("createdAt");
