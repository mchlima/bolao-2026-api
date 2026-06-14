-- Postponed matches (no rescheduled date yet) get their own status, distinct from
-- SCHEDULED, so the UI shows "a definir" and the live robot leaves them alone
-- until the auto-refresh assigns a real date.
ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'POSTPONED';
