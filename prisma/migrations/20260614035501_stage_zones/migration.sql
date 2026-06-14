-- Classification colour bands for a LEAGUE stage (e.g. Brasileirão Libertadores/
-- Pré-Libertadores/Sul-Americana/Rebaixamento), sourced from ge.globo and stored
-- as [{ from, to, label, tone }]. Rendered by the standings table.
ALTER TABLE "stages" ADD COLUMN "zones" JSONB;
