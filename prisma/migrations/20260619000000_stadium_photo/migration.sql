-- Stadium photo (Wikidata P18 / Wikimedia Commons), mirrored to R2, with CC attribution.
ALTER TABLE "stadiums" ADD COLUMN "photoUrl" TEXT;
ALTER TABLE "stadiums" ADD COLUMN "photoCredit" TEXT;
ALTER TABLE "stadiums" ADD COLUMN "photoSourceUrl" TEXT;
