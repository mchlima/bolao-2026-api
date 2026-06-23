import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StandingsService } from '../structure/standings.service';
import {
  MatchPreview,
  PreviewForm,
  PreviewFormMatch,
  PreviewH2H,
  PreviewScorer,
  PreviewScorers,
  PreviewStandingRow,
  PreviewStandings,
} from './match-preview.types';

// Escudo + nomes; o suficiente pros cartões da prévia (sem puxar o time inteiro).
const TEAM_REF_SELECT = {
  id: true,
  name: true,
  shortName: true,
  logoUrl: true,
} satisfies Prisma.TeamSelect;

const FORM_TAKE = 5; // últimos N jogos por time
const H2H_SHOW = 5; // confrontos diretos exibidos (a contagem usa todos)
const SCORERS_TAKE = 3; // artilheiros por lado
const GOAL_TYPES = ['GOAL', 'PENALTY_GOAL']; // gol contra NÃO credita o autor

/**
 * Prévia de um jogo AGENDADO, montada 100% com o nosso banco — forma recente,
 * retrospecto (H2H), o que está em jogo (tabela do grupo) e artilheiros da
 * competição. Determinística, sem LLM nem API externa; cada bloco é best-effort
 * (uma falha vira bloco nulo, nunca derruba a resposta). Ver match-preview.types.
 */
@Injectable()
export class MatchPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standings: StandingsService,
  ) {}

  async forMatch(idOrSlug: string): Promise<MatchPreview> {
    const match = await this.prisma.match.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      select: {
        id: true,
        seasonId: true,
        stageId: true,
        groupId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: { select: TEAM_REF_SELECT },
        awayTeam: { select: TEAM_REF_SELECT },
        season: { select: { name: true, competition: { select: { name: true } } } },
      },
    });
    if (!match) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Partida não encontrada.' });
    }

    const empty: MatchPreview = {
      available: false,
      home: match.homeTeam,
      away: match.awayTeam,
      form: null,
      h2h: null,
      standings: null,
      scorers: null,
    };

    // Sem os dois times resolvidos (slot de mata-mata "a definir") não há prévia.
    if (!match.homeTeamId || !match.awayTeamId || !match.homeTeam || !match.awayTeam) {
      return empty;
    }
    const homeId = match.homeTeamId;
    const awayId = match.awayTeamId;
    const competition = match.season?.competition?.name ?? match.season?.name ?? null;

    // Blocos independentes em paralelo; cada um se protege e cai pra null em erro.
    const [form, h2h, standings, scorers] = await Promise.all([
      this.buildForm(homeId, awayId, match.id).catch(() => null),
      this.buildH2H(homeId, awayId, match.id).catch(() => null),
      this.buildStandings(match.stageId, match.groupId, homeId, awayId).catch(() => null),
      this.buildScorers(match.seasonId, homeId, awayId, competition).catch(() => null),
    ]);

    const available =
      !!(form && (form.home.matches.length || form.away.matches.length)) ||
      !!(h2h && h2h.total) ||
      !!(standings && (standings.home || standings.away)) ||
      !!(scorers && (scorers.home.length || scorers.away.length));

    return { available, home: match.homeTeam, away: match.awayTeam, form, h2h, standings, scorers };
  }

  // ── Forma recente ──────────────────────────────────────────────────────────
  private async buildForm(
    homeId: string,
    awayId: string,
    matchId: string,
  ): Promise<{ home: PreviewForm; away: PreviewForm }> {
    const [home, away] = await Promise.all([
      this.teamForm(homeId, matchId),
      this.teamForm(awayId, matchId),
    ]);
    return { home, away };
  }

  /** Últimos N jogos ENCERRADOS do time (qualquer competição do nosso banco). */
  private async teamForm(teamId: string, matchId: string): Promise<PreviewForm> {
    const rows = await this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        id: { not: matchId },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      orderBy: { kickoffAt: 'desc' },
      take: FORM_TAKE,
      select: {
        id: true,
        slug: true,
        kickoffAt: true,
        homeTeamId: true,
        homeScore: true,
        awayScore: true,
        homeTeam: { select: TEAM_REF_SELECT },
        awayTeam: { select: TEAM_REF_SELECT },
        season: { select: { name: true, competition: { select: { name: true } } } },
      },
    });

    const matches: PreviewFormMatch[] = rows.map((m) => {
      const isHome = m.homeTeamId === teamId;
      const goalsFor = isHome ? m.homeScore : m.awayScore;
      const goalsAgainst = isHome ? m.awayScore : m.homeScore;
      const opponent = isHome ? m.awayTeam : m.homeTeam;
      const result: 'W' | 'D' | 'L' =
        goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
      return {
        matchId: m.id,
        slug: m.slug,
        kickoffAt: m.kickoffAt.toISOString(),
        competition: m.season?.competition?.name ?? m.season?.name ?? null,
        home: isHome,
        opponent: opponent ?? null,
        goalsFor,
        goalsAgainst,
        result,
      };
    });

    const summary = { w: 0, d: 0, l: 0 };
    for (const m of matches) {
      if (m.result === 'W') summary.w++;
      else if (m.result === 'D') summary.d++;
      else summary.l++;
    }
    return { matches, summary };
  }

  // ── Retrospecto (H2H) ────────────────────────────────────────────────────────
  private async buildH2H(
    homeId: string,
    awayId: string,
    matchId: string,
  ): Promise<PreviewH2H | null> {
    const rows = await this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        id: { not: matchId },
        OR: [
          { homeTeamId: homeId, awayTeamId: awayId },
          { homeTeamId: awayId, awayTeamId: homeId },
        ],
      },
      orderBy: { kickoffAt: 'desc' },
      select: {
        id: true,
        slug: true,
        kickoffAt: true,
        homeTeamId: true,
        homeScore: true,
        awayScore: true,
        homeTeam: { select: TEAM_REF_SELECT },
        awayTeam: { select: TEAM_REF_SELECT },
        season: { select: { name: true, competition: { select: { name: true } } } },
      },
    });
    if (!rows.length) return null;

    // Contagem do ponto de vista do confronto que está sendo previsto: vitórias do
    // mandante (homeId) e do visitante (awayId), independentemente de quem foi
    // mandante em cada jogo passado.
    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    for (const m of rows) {
      if (m.homeScore === m.awayScore) {
        draws++;
        continue;
      }
      // O mandante de cada confronto passado é sempre homeId ou awayId (query
      // restringe aos dois times); resolve o vencedor pro lado do jogo previsto.
      const pastHomeWon = m.homeScore > m.awayScore;
      const winnerTeamId = pastHomeWon ? m.homeTeamId : oppositeOf(m.homeTeamId, homeId, awayId);
      if (winnerTeamId === homeId) homeWins++;
      else if (winnerTeamId === awayId) awayWins++;
    }

    const meetings = rows.slice(0, H2H_SHOW).map((m) => ({
      matchId: m.id,
      slug: m.slug,
      kickoffAt: m.kickoffAt.toISOString(),
      competition: m.season?.competition?.name ?? m.season?.name ?? null,
      homeTeam: m.homeTeam ?? null,
      awayTeam: m.awayTeam ?? null,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
    }));

    return { total: rows.length, homeWins, awayWins, draws, meetings };
  }

  // ── O que está em jogo (tabela do grupo) ─────────────────────────────────────
  private async buildStandings(
    stageId: string | null,
    groupId: string | null,
    homeId: string,
    awayId: string,
  ): Promise<PreviewStandings | null> {
    if (!stageId || !groupId) return null; // só faz sentido em liga/grupo
    const stage = await this.standings.stageStandings(stageId);
    const group = stage.groups.find((g) => g.groupId === groupId);
    if (!group) return null;

    const pick = (teamId: string): PreviewStandingRow | null => {
      const r = group.rows.find((row) => row.team.id === teamId);
      if (!r) return null;
      return {
        position: r.position,
        points: r.points,
        played: r.played,
        wins: r.wins,
        draws: r.draws,
        losses: r.losses,
        goalDiff: r.goalDiff,
        form: r.form,
      };
    };

    const home = pick(homeId);
    const away = pick(awayId);
    if (!home && !away) return null;
    return { stageName: stage.stageName, groupName: group.groupName, home, away };
  }

  // ── Artilheiros da competição ────────────────────────────────────────────────
  private async buildScorers(
    seasonId: string,
    homeId: string,
    awayId: string,
    competition: string | null,
  ): Promise<PreviewScorers | null> {
    const [home, away] = await Promise.all([
      this.teamScorers(seasonId, homeId),
      this.teamScorers(seasonId, awayId),
    ]);
    if (!home.length && !away.length) return null;
    return { competition, home, away };
  }

  private async teamScorers(seasonId: string, teamId: string): Promise<PreviewScorer[]> {
    const grouped = await this.prisma.matchEvent.groupBy({
      by: ['playerId'],
      where: {
        teamId,
        type: { in: GOAL_TYPES },
        playerId: { not: null },
        match: { seasonId, status: 'FINISHED' },
      },
      _count: { playerId: true },
      orderBy: { _count: { playerId: 'desc' } },
      take: SCORERS_TAKE,
    });
    const ids = grouped.map((g) => g.playerId).filter((id): id is string => !!id);
    if (!ids.length) return [];

    const players = await this.prisma.player.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, photoUrl: true },
    });
    const byId = new Map(players.map((p) => [p.id, p]));

    return grouped
      .map((g) => {
        const p = g.playerId ? byId.get(g.playerId) : undefined;
        if (!p) return null;
        return { player: p, goals: g._count.playerId };
      })
      .filter((s): s is PreviewScorer => s !== null);
  }
}

/** Dado o mandante de um jogo passado, devolve o OUTRO time do confronto previsto. */
function oppositeOf(pastHomeTeamId: string | null, homeId: string, awayId: string): string | null {
  if (pastHomeTeamId === homeId) return awayId;
  if (pastHomeTeamId === awayId) return homeId;
  return null;
}
