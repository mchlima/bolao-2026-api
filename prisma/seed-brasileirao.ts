/**
 * Seeds the Campeonato Brasileiro Série A 2026 from the ge.globo public API:
 * Competition (bra.1) → Season → Stage (Pontos Corridos, LEAGUE) → Group →
 * 20 GroupTeams → 38 Rounds → 380 Matches. Idempotent (re-runs upsert).
 *
 *   ts-node --project prisma/tsconfig.seed.json prisma/seed-brasileirao.ts
 *
 * Source split: ge.globo builds the STRUCTURE (round numbers, dates, home/away,
 * venues, official scores of played games — things ESPN doesn't expose, notably
 * the round number). The ESPN live robot owns scores AO VIVO going forward
 * (espn.code on each Team is its match key). Clubs must already be seeded from
 * ESPN (prisma/seed-clubs.ts south-america) — this script only ENRICHES them
 * with their ge ref and never creates a club (a missing one would lack ESPN keys
 * and break live ingestion, so it's reported instead).
 *
 * Times: ge.globo returns naive local time (America/São_Paulo). Brazil has no DST
 * since 2019, so the offset is a fixed -03:00 → converted to UTC on write.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

// ts-node doesn't auto-load .env — load it ourselves (same as the other seeds).
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const prisma = new PrismaClient();

// ── ge.globo references (see memory geglobo-api) ──
const GE_CHAMPIONSHIP = 'd1a37fa4-e948-43a6-ba53-ab24ab3a45b1';
const GE_PHASE = 'fase-unica-campeonato-brasileiro-2026';
const GE_BASE = `https://api.globoesporte.globo.com/tabela/${GE_CHAMPIONSHIP}/fase/${GE_PHASE}`;
const ESPN_SLUG = 'bra.1';

// De-para: ge.globo equipe_id → ESPN team id (our Team.externalIds.espn.id).
// Names and siglas diverge across the two providers, so we map by id. The 20
// Série A 2026 clubs; verified against the staging DB.
const GE_TO_ESPN: Record<string, string> = {
  '275': '2029', // Palmeiras
  '262': '819', // Flamengo
  '266': '3445', // Fluminense
  '293': '3458', // Athletico-PR
  '280': '6079', // Bragantino (RBB)
  '265': '9967', // Bahia
  '294': '3456', // Coritiba
  '276': '2026', // São Paulo
  '282': '7632', // Atlético-MG
  '264': '874', // Corinthians
  '283': '2022', // Cruzeiro
  '263': '6086', // Botafogo
  '287': '3457', // Vitória
  '285': '1936', // Internacional
  '277': '2674', // Santos
  '284': '6273', // Grêmio
  '267': '3454', // Vasco da Gama
  '364': '4936', // Remo
  '2305': '9169', // Mirassol
  '315': '9318', // Chapecoense
};

// Stadiums (researched on the web). ge.globo gives only the venue's popular name
// for already-scheduled games; city/state/country added here. Keyed by the ge
// name so we can resolve a game's `sede.nome_popular` → Stadium.
type StadiumSeed = { name: string; city: string; state: string; country: string };
const STADIUMS: StadiumSeed[] = [
  { name: 'Maracanã', city: 'Rio de Janeiro', state: 'RJ', country: 'Brasil' },
  { name: 'São Januário', city: 'Rio de Janeiro', state: 'RJ', country: 'Brasil' },
  { name: 'Nilton Santos (Engenhão)', city: 'Rio de Janeiro', state: 'RJ', country: 'Brasil' },
  { name: 'Nubank Parque', city: 'São Paulo', state: 'SP', country: 'Brasil' },
  { name: 'Neo Química Arena', city: 'São Paulo', state: 'SP', country: 'Brasil' },
  { name: 'Morumbis', city: 'São Paulo', state: 'SP', country: 'Brasil' },
  { name: 'Canindé', city: 'São Paulo', state: 'SP', country: 'Brasil' },
  { name: 'Arena Barueri', city: 'Barueri', state: 'SP', country: 'Brasil' },
  { name: 'Vila Belmiro', city: 'Santos', state: 'SP', country: 'Brasil' },
  { name: 'Cícero de Souza Marques', city: 'Bragança Paulista', state: 'SP', country: 'Brasil' },
  { name: 'Maião', city: 'Mirassol', state: 'SP', country: 'Brasil' },
  { name: 'Brinco de Ouro', city: 'Campinas', state: 'SP', country: 'Brasil' },
  { name: 'Arena da Baixada', city: 'Curitiba', state: 'PR', country: 'Brasil' },
  { name: 'Couto Pereira', city: 'Curitiba', state: 'PR', country: 'Brasil' },
  { name: 'Mineirão', city: 'Belo Horizonte', state: 'MG', country: 'Brasil' },
  { name: 'Arena MRV', city: 'Belo Horizonte', state: 'MG', country: 'Brasil' },
  { name: 'Beira-Rio', city: 'Porto Alegre', state: 'RS', country: 'Brasil' },
  { name: 'Arena do Grêmio', city: 'Porto Alegre', state: 'RS', country: 'Brasil' },
  { name: 'Casa de Apostas Arena Fonte Nova', city: 'Salvador', state: 'BA', country: 'Brasil' },
  { name: 'Barradão', city: 'Salvador', state: 'BA', country: 'Brasil' },
  { name: 'Arena Condá', city: 'Chapecó', state: 'SC', country: 'Brasil' },
  { name: 'Mangueirão', city: 'Belém', state: 'PA', country: 'Brasil' },
  { name: 'Baenão', city: 'Belém', state: 'PA', country: 'Brasil' },
  { name: 'Mané Garrincha', city: 'Brasília', state: 'DF', country: 'Brasil' },
];

// Each club's primary home stadium (ge name) — fallback venue for future rounds
// where ge.globo hasn't set `sede` yet, so every match still has a stadium.
const CLUB_HOME_STADIUM: Record<string, string> = {
  FLA: 'Maracanã',
  FLU: 'Maracanã',
  VAS: 'São Januário',
  BOT: 'Nilton Santos (Engenhão)',
  PAL: 'Nubank Parque',
  COR: 'Neo Química Arena',
  SAO: 'Morumbis',
  SAN: 'Vila Belmiro',
  RBB: 'Cícero de Souza Marques',
  MIR: 'Maião',
  CAP: 'Arena da Baixada',
  CFC: 'Couto Pereira',
  CRU: 'Mineirão',
  CAM: 'Arena MRV',
  BAH: 'Casa de Apostas Arena Fonte Nova',
  VIT: 'Barradão',
  INT: 'Beira-Rio',
  GRE: 'Arena do Grêmio',
  CHA: 'Arena Condá',
  REM: 'Mangueirão',
};

// ── ge.globo response shapes (only the bits we read) ──
interface GeClassRow {
  ordem: number;
  nome_popular: string;
  sigla: string;
  escudo: string;
  equipe_id: number;
  faixa_classificacao_cor?: string | null;
}
interface GeClass {
  edicao: { data_inicio: string; data_fim: string; nome: string };
  faixas_classificacao: { cor: string; nome: string }[];
  classificacao: GeClassRow[];
}

// ge.globo faixa colour → our StandingsTable tone. ge: Libertadores blue,
// Pré-Libertadores cyan, Sul-Americana green, Rebaixados red.
const TONE_BY_COLOR: Record<string, 'green' | 'blue' | 'teal' | 'red'> = {
  '#0000ff': 'green', // Libertadores → green (top/qualify)
  '#00ffff': 'blue', // Pré-Libertadores
  '#008040': 'teal', // Sul-Americana
  '#ff0000': 'red', // Rebaixamento
};

/** Derive contiguous classification bands [{from,to,label,tone}] from ge.globo's
 *  per-position faixa colours (handles the cup-winner shifts ge applies). */
function deriveZones(cls: GeClass): Array<{ from: number; to: number; label: string; tone: string }> {
  const nameByColor = new Map(cls.faixas_classificacao.map((f) => [f.cor.toLowerCase(), f.nome]));
  const zones: Array<{ from: number; to: number; label: string; tone: string; color: string }> = [];
  for (const r of [...cls.classificacao].sort((a, b) => a.ordem - b.ordem)) {
    const color = (r.faixa_classificacao_cor ?? '').toLowerCase();
    const tone = TONE_BY_COLOR[color];
    if (!tone) continue; // positions with no faixa (mid-table) break the run
    const last = zones[zones.length - 1];
    if (last && last.color === color && last.to === r.ordem - 1) last.to = r.ordem;
    else zones.push({ from: r.ordem, to: r.ordem, label: nameByColor.get(color) ?? '', tone, color });
  }
  return zones.map(({ color: _c, ...z }) => z);
}
interface GeGame {
  id: number;
  data_realizacao: string | null; // "2026-03-10T21:30" (naive BRT)
  placar_oficial_mandante: number | null;
  placar_oficial_visitante: number | null;
  equipes: {
    mandante: { id: number; sigla: string };
    visitante: { id: number; sigla: string };
  };
  sede: { nome_popular: string } | null;
  transmissao: { broadcast?: { id?: string } } | null;
}

async function ge<T>(path: string): Promise<T> {
  const res = await fetch(`${GE_BASE}${path}`, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ge.globo ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Naive BRT → UTC Date (Brazil is a fixed -03:00 since DST was abolished). */
function brtToUtc(naive: string): Date {
  return new Date(`${naive}:00-03:00`);
}

async function run(): Promise<void> {
  console.log('Seeding Brasileirão Série A 2026 (ge.globo)…');

  // 1. Pull the structure from ge.globo: classification (20 clubs) + 38 rounds.
  const cls = await ge<GeClass>('/classificacao/');
  const rounds: GeGame[][] = [];
  for (let n = 1; n <= 38; n++) rounds.push(await ge<GeGame[]>(`/rodada/${n}/jogos/`));
  console.log(`  ge: ${cls.classificacao.length} clubes, ${rounds.flat().length} jogos`);

  // 2. Competition (idempotent by slug). espn.slug → live robot; ge → structure refresh.
  const competition = await prisma.competition.upsert({
    where: { slug: ESPN_SLUG },
    update: {
      externalIds: {
        espn: { slug: ESPN_SLUG },
        ge: { championshipId: GE_CHAMPIONSHIP, phase: GE_PHASE },
      },
    },
    create: {
      name: 'Campeonato Brasileiro Série A',
      slug: ESPN_SLUG,
      type: 'LEAGUE',
      country: 'Brasil',
      confederation: 'CBF',
      externalIds: {
        espn: { slug: ESPN_SLUG },
        ge: { championshipId: GE_CHAMPIONSHIP, phase: GE_PHASE },
      },
    },
  });

  // 3. Season 2026 (idempotent by name; Season.name isn't unique).
  const seasonData = {
    competitionId: competition.id,
    name: 'Campeonato Brasileiro Série A 2026',
    seasonLabel: '2026',
    format: 'LEAGUE' as const,
    startDate: new Date(`${cls.edicao.data_inicio}T00:00:00-03:00`),
    endDate: new Date(`${cls.edicao.data_fim}T23:59:59-03:00`),
    status: 'ONGOING' as const,
  };
  const existingSeason = await prisma.season.findFirst({ where: { name: seasonData.name } });
  const season = existingSeason
    ? await prisma.season.update({ where: { id: existingSeason.id }, data: seasonData })
    : await prisma.season.create({ data: seasonData });

  // 4. Enrich the 20 clubs with their ge ref (espn refs already there). Build the
  //    geId → our Team id map used to resolve match participants.
  const teamByGeId = new Map<number, string>();
  const missing: string[] = [];
  for (const row of cls.classificacao) {
    const espnId = GE_TO_ESPN[String(row.equipe_id)];
    const team = espnId
      ? await prisma.team.findFirst({
          where: { externalIds: { path: ['espn', 'id'], equals: espnId } },
        })
      : null;
    if (!team) {
      missing.push(`${row.nome_popular} (ge ${row.equipe_id})`);
      continue;
    }
    teamByGeId.set(row.equipe_id, team.id);
    const prev = (team.externalIds as Record<string, unknown>) ?? {};
    await prisma.team.update({
      where: { id: team.id },
      data: { externalIds: { ...prev, ge: { id: String(row.equipe_id), code: row.sigla } } },
    });
  }
  if (missing.length) {
    throw new Error(
      `Clubes não encontrados (rode seed-clubs.ts south-america antes): ${missing.join(', ')}`,
    );
  }

  // 5. Stage (Pontos Corridos) + single Group (the league table).
  const stage =
    (await prisma.stage.findFirst({ where: { seasonId: season.id, order: 1 } })) ??
    (await prisma.stage.create({
      data: {
        seasonId: season.id,
        name: 'Pontos Corridos',
        format: 'LEAGUE',
        order: 1,
        tiebreakPreset: 'BRASILEIRAO',
      },
    }));
  const group =
    (await prisma.group.findFirst({ where: { stageId: stage.id, order: 1 } })) ??
    (await prisma.group.create({
      data: { stageId: stage.id, name: 'Série A', order: 1 },
    }));

  // Classification bands (Libertadores/Pré-Libertadores/Sul-Americana/Rebaixamento)
  // straight from ge.globo's current faixas — re-running the seed refreshes them.
  const zones = deriveZones(cls);
  await prisma.stage.update({ where: { id: stage.id }, data: { zones } });
  for (const teamId of teamByGeId.values()) {
    await prisma.groupTeam.upsert({
      where: { groupId_teamId: { groupId: group.id, teamId } },
      update: {},
      create: { groupId: group.id, teamId },
    });
  }

  // 6. Stadiums (upsert by name+city).
  const stadiumByName = new Map<string, string>();
  for (const s of STADIUMS) {
    const row = await prisma.stadium.upsert({
      where: { name_city: { name: s.name, city: s.city } },
      update: { state: s.state, country: s.country },
      create: s,
    });
    stadiumByName.set(s.name, row.id);
  }

  // Existing match externalIds (by matchNumber) so a re-seed preserves refs set
  // by other processes — notably espn.id from the live robot / cards backfill.
  const existingExt = new Map<number, Record<string, unknown>>();
  for (const m of await prisma.match.findMany({
    where: { seasonId: season.id },
    select: { matchNumber: true, externalIds: true },
  })) {
    if (m.matchNumber != null)
      existingExt.set(m.matchNumber, (m.externalIds as Record<string, unknown>) ?? {});
  }

  // 7. Rounds + Matches.
  let matchNumber = 0;
  let played = 0;
  for (let i = 0; i < rounds.length; i++) {
    const number = i + 1;
    const round =
      (await prisma.round.findFirst({ where: { stageId: stage.id, number } })) ??
      (await prisma.round.create({
        data: { stageId: stage.id, number, legs: 1, order: number },
      }));

    // Fallback kickoff for games ge.globo hasn't dated yet (postponed/TBD): the
    // round's own date, not the season start — avoids a bogus "1 Jan 00:00".
    const roundTimes = rounds[i]
      .map((g) => g.data_realizacao)
      .filter((d): d is string => !!d)
      .map((d) => brtToUtc(d).getTime());
    const roundFallback = roundTimes.length
      ? new Date(Math.min(...roundTimes))
      : new Date(seasonData.startDate);

    for (const g of rounds[i]) {
      matchNumber++;
      const homeTeamId = teamByGeId.get(g.equipes.mandante.id) ?? null;
      const awayTeamId = teamByGeId.get(g.equipes.visitante.id) ?? null;

      // Venue: ge's sede if set (played games), else the home club's primary.
      const venueName = g.sede?.nome_popular ?? CLUB_HOME_STADIUM[g.equipes.mandante.sigla];
      const stadiumId = (venueName && stadiumByName.get(venueName)) || null;

      const finished = g.transmissao?.broadcast?.id === 'ENCERRADA';
      const hs = g.placar_oficial_mandante ?? 0;
      const as = g.placar_oficial_visitante ?? 0;
      const winner = finished ? (hs > as ? 'HOME' : hs < as ? 'AWAY' : 'DRAW') : null;
      if (finished) played++;

      const matchData = {
        seasonId: season.id,
        stageId: stage.id,
        groupId: group.id,
        roundId: round.id,
        groupName: group.name, // drives the match page's classification + round card
        matchNumber,
        kickoffAt: g.data_realizacao ? brtToUtc(g.data_realizacao) : roundFallback,
        stadiumId,
        homeTeamId,
        awayTeamId,
        status: finished ? ('FINISHED' as const) : ('SCHEDULED' as const),
        homeScore: finished ? hs : 0,
        awayScore: finished ? as : 0,
        winner: winner as 'HOME' | 'AWAY' | 'DRAW' | null,
        // Merge so a re-seed keeps espn.id (live robot / backfill) and any other ref.
        externalIds: { ...(existingExt.get(matchNumber) ?? {}), ge: { id: String(g.id) } },
      };

      await prisma.match.upsert({
        where: { seasonId_matchNumber: { seasonId: season.id, matchNumber } },
        update: matchData,
        create: matchData,
      });
    }
  }

  console.log(
    `✓ ${competition.name} 2026 — ${teamByGeId.size} clubes, ${rounds.length} rodadas, ${matchNumber} jogos (${played} já realizados), ${STADIUMS.length} estádios.`,
  );
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
