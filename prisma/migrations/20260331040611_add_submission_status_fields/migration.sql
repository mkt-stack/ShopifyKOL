-- AlterTable
ALTER TABLE "TikTokUrl" ADD COLUMN     "metafieldError" TEXT,
ADD COLUMN     "metafieldUpdated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "noteError" TEXT,
ADD COLUMN     "noteUpdated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "TikTokUrl_createdAt_idx" ON "TikTokUrl"("createdAt");
