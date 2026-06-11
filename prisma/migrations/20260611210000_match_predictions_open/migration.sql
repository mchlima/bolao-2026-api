-- Manual override for the prediction window.
-- NULL = follow the automatic rule (open while SCHEDULED and before kickoff);
-- TRUE/FALSE force the predictions open/closed regardless of status/kickoff.
ALTER TABLE "matches" ADD COLUMN "predictionsOpen" BOOLEAN;
