-- AlterTable
ALTER TABLE "TikTokUrl" ADD COLUMN     "videoId" TEXT;

-- CreateIndex
CREATE INDEX "TikTokUrl_videoId_idx" ON "TikTokUrl"("videoId");
