-- AlterTable: capture request network/geo context on audit entries
ALTER TABLE "audit_logs" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "userAgent" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "city" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
