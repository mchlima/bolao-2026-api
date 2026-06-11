-- ESPN auto-score robot: external fixture id + per-match auto/manual flag.
ALTER TABLE "matches" ADD COLUMN "externalId" TEXT;
ALTER TABLE "matches" ADD COLUMN "autoManaged" BOOLEAN NOT NULL DEFAULT true;
