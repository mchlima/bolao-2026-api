-- Narração humana minuto-a-minuto da ESPN (feed `commentary`), retida verbatim —
-- matéria-prima das notícias (facts.narracaoEspn). Acumulada por upsert em espnId.
CREATE TABLE "match_commentary" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT,
    "espnId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT,
    "minute" TEXT,
    "clockValue" INTEGER NOT NULL DEFAULT 0,
    "period" INTEGER NOT NULL DEFAULT 1,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_commentary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_commentary_espnId_key" ON "match_commentary"("espnId");

-- CreateIndex
CREATE INDEX "match_commentary_matchId_idx" ON "match_commentary"("matchId");

-- AddForeignKey
ALTER TABLE "match_commentary" ADD CONSTRAINT "match_commentary_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Geometria do chute (ESPN, em gols/pênaltis): onde a bola cruzou a linha do gol
-- (goalY) e de onde saiu o chute (fieldX/Y). Alimenta o mini-gol na narração.
ALTER TABLE "match_events" ADD COLUMN "goalY" DOUBLE PRECISION;
ALTER TABLE "match_events" ADD COLUMN "fieldX" DOUBLE PRECISION;
ALTER TABLE "match_events" ADD COLUMN "fieldY" DOUBLE PRECISION;

-- Apito real: ancora a janela de ingestão pós-jogo (parar 1h após o fim de fato).
ALTER TABLE "matches" ADD COLUMN "finishedAt" TIMESTAMP(3);
