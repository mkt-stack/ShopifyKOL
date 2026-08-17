-- AlterTable
ALTER TABLE "TikTokUrl" ADD COLUMN     "flowTriggerError" TEXT,
ADD COLUMN     "flowTriggered" BOOLEAN NOT NULL DEFAULT false;
