-- SEO/GEO metadata for taxonomy term pages (category & tag), edited manually by the admin.
ALTER TABLE "tags" ADD COLUMN "seo" JSONB;
ALTER TABLE "categories" ADD COLUMN "seo" JSONB;
