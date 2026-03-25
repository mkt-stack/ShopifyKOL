/*
  Warnings:

  - You are about to drop the `TikTokLink` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "TikTokLink";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "TikTokUrl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "url" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TikTokUrl_shop_orderId_idx" ON "TikTokUrl"("shop", "orderId");
