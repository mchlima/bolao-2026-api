import { Injectable } from '@nestjs/common';
import { MatchStatus, TiebreakPreset } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  GroupStandings,
  StageStandings,
  StandingsRow,
  StandingsTeam,
} from './standings.types';

// Minimal match shape the standings math needs.
interface ScoredMatch {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number;
  awayScore: number;
  status: MatchStatus;
  kickoffAt: Date;
  // Discipline (default 0 when absent) — drives the fair-play tiebreak + display.
  homeYellow?: number;
  homeRed?: number;
  awayYellow?: number;
  awayRed?: number;
  homeFairPlay?: number;
  awayFairPlay?: number;
}

// Ordered secondary criteria applied WITHIN a points-block (teams already level on
// points). Overall metrics use every match in the group; H2H_* metrics use only
// matches among the tied teams. "%" (aproveitamento) is display-only, never a criterion.
type Criterion =
  | 'WINS'
  | 'GOAL_DIFF'
  | 'GOALS_FOR'
  | 'H2H_POINTS'
  | 'H2H_GOAL_DIFF'
  | 'H2H_GOALS_FOR'
  | 'FAIR_PLAY'; // fewest disciplinary points — last objective tiebreak before draw of lots

// FAIR_PLAY closes each preset as the final objective criterion (its FIFA-correct
// spot, after overall + head-to-head); a draw of lots / FIFA ranking would follow,
// modelled here as the team-name fallback / admin override.
const PRESET_CRITERIA: Record<TiebreakPreset, Criterion[]> = {
  GENERIC: ['GOAL_DIFF', 'GOALS_FOR', 'FAIR_PLAY'],
  BRASILEIRAO: ['WINS', 'GOAL_DIFF', 'GOALS_FOR', 'H2H_POINTS', 'FAIR_PLAY'],
  // FIFA: overall GD/GF first, then head-to-head among the tied teams, then fair play.
  FIFA: ['GOAL_DIFF', 'GOALS_FOR', 'H2H_POINTS', 'H2H_GOAL_DIFF', 'H2H_GOALS_FOR', 'FAIR_PLAY'],
  // UEFA: head-to-head first, then overall GD/GF, then fair play.
  UEFA: ['H2H_POINTS', 'H2H_GOAL_DIFF', 'H2H_GOALS_FOR', 'GOAL_DIFF', 'GOALS_FOR', 'FAIR_PLAY'],
  CONMEBOL: ['GOAL_DIFF', 'GOALS_FOR', 'FAIR_PLAY'],
};

interface Stat {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  yellow: number;
  red: number;
  fairPlay: number;
}

const emptyStat = (): Stat => ({
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  points: 0,
  yellow: 0,
  red: 0,
  fairPlay: 0,
});

@Injectable()
export class StandingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Standings for a whole season (all LEAGUE/GROUP stages). */
  async seasonStandings(seasonId: string): Promise<StageStandings[]> {
    const stages = await this.prisma.stage.findMany({
      where: { seasonId, format: { in: ['LEAGUE', 'GROUP'] } },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    return Promise.all(stages.map((s) => this.stageStandings(s.id)));
  }

  /** Standings for one stage — one table per group (LEAGUE stage has a single group). */
  async stageStandings(stageId: string): Promise<StageStandings> {
    const stage = await this.prisma.stage.findUniqueOrThrow({
      where: { id: stageId },
      include: {
        groups: {
          orderBy: { order: 'asc' },
          include: {
            teams: {
              include: {
                team: {
                  select: {
                    id: true,
                    name: true,
                    shortName: true,
                    logoUrl: true,
                    countryCode: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const groups: GroupStandings[] = [];
    for (const group of stage.groups) {
      const matches = await this.prisma.match.findMany({
        // LIVE matches count provisionally — the table reacts to in-progress
        // scores (ge.globo-style "classificação ao vivo").
        where: {
          groupId: group.id,
          status: { in: [MatchStatus.FINISHED, MatchStatus.LIVE] },
        },
        select: {
          homeTeamId: true,
          awayTeamId: true,
          homeScore: true,
          awayScore: true,
          status: true,
          kickoffAt: true,
          homeYellow: true,
          homeRed: true,
          awayYellow: true,
          awayRed: true,
          homeFairPlay: true,
          awayFairPlay: true,
        },
      });
      const teams: StandingsTeam[] = group.teams.map((gt) => gt.team);
      groups.push({
        groupId: group.id,
        groupName: group.name,
        rows: this.computeTable(teams, matches, stage.tiebreakPreset),
      });
    }

    return {
      stageId: stage.id,
      stageName: stage.name,
      format: stage.format as 'LEAGUE' | 'GROUP',
      groups,
    };
  }

  /** Pure: build a sorted classification table from teams + their matches
   * (FINISHED count fully; LIVE count provisionally with their current score). */
  computeTable(
    teams: StandingsTeam[],
    matches: ScoredMatch[],
    preset: TiebreakPreset,
  ): StandingsRow[] {
    const stats = new Map<string, Stat>();
    for (const t of teams) stats.set(t.id, emptyStat());

    // FINISHED + LIVE both count toward the table (LIVE provisionally).
    const counted = matches.filter(
      (m) =>
        (m.status === MatchStatus.FINISHED || m.status === MatchStatus.LIVE) &&
        m.homeTeamId &&
        m.awayTeamId,
    );
    for (const m of counted) {
      const home = stats.get(m.homeTeamId!);
      const away = stats.get(m.awayTeamId!);
      if (!home || !away) continue; // match involves a team outside this group
      home.played++;
      away.played++;
      home.goalsFor += m.homeScore;
      home.goalsAgainst += m.awayScore;
      away.goalsFor += m.awayScore;
      away.goalsAgainst += m.homeScore;
      home.yellow += m.homeYellow ?? 0;
      home.red += m.homeRed ?? 0;
      away.yellow += m.awayYellow ?? 0;
      away.red += m.awayRed ?? 0;
      home.fairPlay += m.homeFairPlay ?? 0;
      away.fairPlay += m.awayFairPlay ?? 0;
      if (m.homeScore > m.awayScore) {
        home.wins++;
        home.points += 3;
        away.losses++;
      } else if (m.homeScore < m.awayScore) {
        away.wins++;
        away.points += 3;
        home.losses++;
      } else {
        home.draws++;
        away.draws++;
        home.points++;
        away.points++;
      }
    }

    // Form (last 5) reflects only settled results — an in-progress match is
    // not yet a W/D/L.
    const finished = counted.filter((m) => m.status === MatchStatus.FINISHED);
    const form = this.computeForm(teams, finished);

    // Teams currently playing — drives the "ao vivo" indicator on their row.
    const liveTeamIds = new Set<string>();
    for (const m of counted) {
      if (m.status !== MatchStatus.LIVE) continue;
      if (m.homeTeamId) liveTeamIds.add(m.homeTeamId);
      if (m.awayTeamId) liveTeamIds.add(m.awayTeamId);
    }
    const rows = teams.map((team) => {
      const s = stats.get(team.id)!;
      const goalDiff = s.goalsFor - s.goalsAgainst;
      const pct =
        s.played > 0
          ? Math.round((s.points / (s.played * 3)) * 1000) / 10
          : 0;
      return {
        position: 0,
        team,
        played: s.played,
        wins: s.wins,
        draws: s.draws,
        losses: s.losses,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
        goalDiff,
        points: s.points,
        pct,
        yellowCards: s.yellow,
        redCards: s.red,
        fairPlay: s.fairPlay,
        form: form.get(team.id) ?? [],
        live: liveTeamIds.has(team.id),
      } satisfies StandingsRow;
    });

    this.sort(rows, counted, preset);
    rows.forEach((r, i) => (r.position = i + 1));
    return rows;
  }

  /** Sort rows in place: points desc, then preset criteria within each points-block, then name. */
  private sort(
    rows: StandingsRow[],
    matches: ScoredMatch[],
    preset: TiebreakPreset,
  ): void {
    const criteria = PRESET_CRITERIA[preset];
    rows.sort((a, b) => b.points - a.points); // primary: points

    // Resolve ties within each maximal block of equal points.
    let i = 0;
    while (i < rows.length) {
      let j = i + 1;
      while (j < rows.length && rows[j].points === rows[i].points) j++;
      if (j - i > 1) this.breakBlockTie(rows, i, j, matches, criteria);
      i = j;
    }
  }

  private breakBlockTie(
    rows: StandingsRow[],
    start: number,
    end: number,
    matches: ScoredMatch[],
    criteria: Criterion[],
  ): void {
    const block = rows.slice(start, end);
    const ids = new Set(block.map((r) => r.team.id));
    const h2h = this.computeH2H(matches, ids); // teamId → Stat (matches among the block)

    const valueOf = (r: StandingsRow, c: Criterion): number => {
      switch (c) {
        case 'WINS':
          return r.wins;
        case 'GOAL_DIFF':
          return r.goalDiff;
        case 'GOALS_FOR':
          return r.goalsFor;
        case 'H2H_POINTS':
          return h2h.get(r.team.id)?.points ?? 0;
        case 'H2H_GOAL_DIFF': {
          const s = h2h.get(r.team.id);
          return s ? s.goalsFor - s.goalsAgainst : 0;
        }
        case 'H2H_GOALS_FOR':
          return h2h.get(r.team.id)?.goalsFor ?? 0;
        case 'FAIR_PLAY':
          // fairPlay ≤ 0; less negative = fewer/lighter cards = ranked higher.
          // Descending sort (valueOf(b) - valueOf(a)) already favours the larger
          // (less negative) value, so return it directly.
          return r.fairPlay;
      }
    };

    block.sort((a, b) => {
      for (const c of criteria) {
        const diff = valueOf(b, c) - valueOf(a, c);
        if (diff !== 0) return diff;
      }
      return a.team.name.localeCompare(b.team.name, 'pt-BR');
    });
    for (let k = 0; k < block.length; k++) rows[start + k] = block[k];
  }

  /** Mini-table (points/goals) among a subset of teams, using only matches between them. */
  private computeH2H(
    matches: ScoredMatch[],
    ids: Set<string>,
  ): Map<string, Stat> {
    const h2h = new Map<string, Stat>();
    for (const id of ids) h2h.set(id, emptyStat());
    for (const m of matches) {
      if (!m.homeTeamId || !m.awayTeamId) continue;
      if (!ids.has(m.homeTeamId) || !ids.has(m.awayTeamId)) continue;
      const home = h2h.get(m.homeTeamId)!;
      const away = h2h.get(m.awayTeamId)!;
      home.goalsFor += m.homeScore;
      home.goalsAgainst += m.awayScore;
      away.goalsFor += m.awayScore;
      away.goalsAgainst += m.homeScore;
      if (m.homeScore > m.awayScore) home.points += 3;
      else if (m.homeScore < m.awayScore) away.points += 3;
      else {
        home.points++;
        away.points++;
      }
    }
    return h2h;
  }

  /** Last-5 form per team (oldest → newest) from finished matches. */
  private computeForm(
    teams: StandingsTeam[],
    finished: ScoredMatch[],
  ): Map<string, ('W' | 'D' | 'L')[]> {
    const byKickoff = [...finished].sort(
      (a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime(),
    );
    const form = new Map<string, ('W' | 'D' | 'L')[]>();
    for (const t of teams) form.set(t.id, []);
    for (const m of byKickoff) {
      if (!m.homeTeamId || !m.awayTeamId) continue;
      const homeArr = form.get(m.homeTeamId);
      const awayArr = form.get(m.awayTeamId);
      if (homeArr) {
        homeArr.push(
          m.homeScore > m.awayScore ? 'W' : m.homeScore < m.awayScore ? 'L' : 'D',
        );
      }
      if (awayArr) {
        awayArr.push(
          m.awayScore > m.homeScore ? 'W' : m.awayScore < m.homeScore ? 'L' : 'D',
        );
      }
    }
    for (const [id, arr] of form) form.set(id, arr.slice(-5));
    return form;
  }
}
