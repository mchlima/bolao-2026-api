-- Optional profile photo (public R2 URL); null falls back to name initials
ALTER TABLE "users" ADD COLUMN "avatarUrl" TEXT;
