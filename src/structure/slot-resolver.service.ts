import { Injectable, Logger } from '@nestjs/common';
import { MatchStatus, TieResolution } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StandingsService } from './standings.service';
import { StandingsTeam } from './standings.types';
import { WC2026_THIRDS_TABLE } from './data/wc2026-thirds-table';

// A tie's projected occupants (provisional): the teams that WOULD fill the slots
// given the current standings / live results. Only the parts not yet officially
// resolved are meaningful to surface as "projection".
export interface TieProjection {
  home: StandingsTeam | null;
  away: StandingsTeam | null;
  winner: StandingsTeam | null;
}

// Typed feeder stored in Tie.homeSource / Tie.awaySource (see SlotSourceType).
// BEST_RANKED.winnerGroup = the group letter of the WINNER this third faces (the
// column key into the Annex C table). eligibleGroups is kept for display/labeling.
type SlotSource =
  | { type: 'GROUP_POSITION'; groupId: string; position: number }
  | {
      type: 'BEST_RANKED';
      stageId: string;
      winnerGroup?: string;
      eligibleGroups?: string[];
      position?: number;
    }
  | { type: 'MATCH_WINNER'; tieId: string }
  | { type: 'MATCH_LOSER'; tieId: string };

export interface ThirdSeed {
  letter: string; // group letter
  points: number;
  goalDiff: number;
  goalsFor: number;
  fairPlay?: number; // FIFA fair-play points (≤ 0); higher = better. Default 0.
  name: string;
}

/**
 * Pure: rank the third-placed teams (points → GD → GF → fair play → name), take
 * the best 8, and look up — via the FIFA Annex C table — which third faces
 * `winnerGroup`. Returns that third's group letter, or null if undecidable.
 * Fair play (disciplinary) is the last objective FIFA criterion before the draw
 * of lots / FIFA ranking (modelled as the name fallback / admin override).
 * Exported for testing.
 */
export function bestThirdLetter(
  thirds: ThirdSeed[],
  winnerGroup: string,
): string | null {
  if (thirds.length < 8) return null;
  const ranked = [...thirds].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      (b.fairPlay ?? 0) - (a.fairPlay ?? 0) ||
      a.name.localeCompare(b.name, 'pt-BR'),
  );
  const key = ranked
    .slice(0, 8)
    .map((t) => t.letter)
    .sort()
    .join('');
  return WC2026_THIRDS_TABLE[key]?.[winnerGroup] ?? null;
}

@Injectable()
export class SlotResolverService {
  private readonly logger = new Logger(SlotResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly standings: StandingsService,
  ) {}

  /**
   * Recompute every Tie's aggregate/winner and resolve TBD slots from typed feeders
   * across a whole season. Idempotent; runs to a fixpoint so MATCH_WINNER chains fill
   * as earlier rounds resolve. Called after a result changes (admin or robot).
   * BEST_RANKED (best-third) slots are left for admin override — the FIFA combination
   * table isn't auto-applied here.
   */
  async resolveSeason(seasonId: string): Promise<void> {
    const maxPasses = 8; // bracket depth bound (R32→R16→QF→SF→Final + slack)
    for (let pass = 0; pass < maxPasses; pass++) {
      const changed = await this.resolvePass(seasonId);
      if (!changed) break;
    }
  }

  private async resolvePass(seasonId: string): Promise<boolean> {
    const ties = await this.prisma.tie.findMany({
      where: { round: { stage: { seasonId } } },
      orderBy: [
        { round: { stage: { order: 'asc' } } },
        { round: { order: 'asc' } },
        { order: 'asc' },
      ],
      include: {
        matches: {
          select: {
            id: true,
            leg: true,
            homeTeamId: true,
            awayTeamId: true,
            homeScore: true,
            awayScore: true,
            homePenalties: true,
            awayPenalties: true,
            status: true,
          },
          orderBy: { leg: 'asc' },
        },
      },
    });

    let changed = false;
    for (const tie of ties) {
      // 1) Resolve TBD participants from feeders.
      const home =
        tie.homeTeamId ?? (await this.resolveFeeder(tie.homeSource as unknown as SlotSource | null));
      const away =
        tie.awayTeamId ?? (await this.resolveFeeder(tie.awaySource as unknown as SlotSource | null));

      const data: Record<string, unknown> = {};
      if (home && home !== tie.homeTeamId) data.homeTeamId = home;
      if (away && away !== tie.awayTeamId) data.awayTeamId = away;

      // 2) Recompute aggregate + winner when both known and all legs finished.
      const agg = this.computeAggregate(
        home,
        away,
        tie.matches as LegMatch[],
      );
      if (agg) {
        if (agg.aggregateHome !== tie.aggregateHome) data.aggregateHome = agg.aggregateHome;
        if (agg.aggregateAway !== tie.aggregateAway) data.aggregateAway = agg.aggregateAway;
        if (agg.winnerTeamId !== tie.winnerTeamId) data.winnerTeamId = agg.winnerTeamId;
        if (agg.resolution !== tie.resolution) data.resolution = agg.resolution;
      }

      if (Object.keys(data).length) {
        await this.prisma.tie.update({ where: { id: tie.id }, data });
        changed = true;
      }

      // 3) Mirror resolved participants onto the tie's leg matches (respecting home/away swap).
      if (home || away) {
        const mirrored = await this.mirrorToMatches(
          home ?? tie.homeTeamId,
          away ?? tie.awayTeamId,
          tie.matches as LegMatch[],
        );
        if (mirrored) changed = true;
      }
    }
    return changed;
  }

  /** Resolve a feeder reference to a concrete teamId, or null if not yet determinable. */
  private async resolveFeeder(source: SlotSource | null): Promise<string | null> {
    if (!source) return null;
    switch (source.type) {
      case 'MATCH_WINNER': {
        const tie = await this.prisma.tie.findUnique({
          where: { id: source.tieId },
          select: { winnerTeamId: true },
        });
        return tie?.winnerTeamId ?? null;
      }
      case 'MATCH_LOSER': {
        const tie = await this.prisma.tie.findUnique({
          where: { id: source.tieId },
          select: { homeTeamId: true, awayTeamId: true, winnerTeamId: true },
        });
        if (!tie?.winnerTeamId || !tie.homeTeamId || !tie.awayTeamId) return null;
        return tie.winnerTeamId === tie.homeTeamId ? tie.awayTeamId : tie.homeTeamId;
      }
      case 'GROUP_POSITION': {
        // Only resolvable once the whole group has finished.
        const pending = await this.prisma.match.count({
          where: { groupId: source.groupId, status: { not: MatchStatus.FINISHED } },
        });
        if (pending > 0) return null;
        const group = await this.prisma.group.findUnique({
          where: { id: source.groupId },
          select: { stageId: true },
        });
        if (!group) return null;
        const stage = await this.standings.stageStandings(group.stageId);
        const g = stage.groups.find((x) => x.groupId === source.groupId);
        return g?.rows[source.position - 1]?.team.id ?? null;
      }
      case 'BEST_RANKED':
        return this.resolveBestThird(source);
    }
  }

  /**
   * Resolve a "best third-placed team" slot via the FIFA Annex C combination table
   * (WC2026_THIRDS_TABLE). Needs the whole group stage finished: rank the 12 thirds
   * (points → GD → GF → fair play → name), take the best 8, key the table by their
   * group letters, and read which third faces this slot's winner group. Returns null
   * until decidable; admin can override. Fair play (cards) now feeds the ranking from
   * the ESPN robot; only the FIFA-ranking/draw-of-lots final step stays manual.
   */
  private async resolveBestThird(source: {
    stageId: string;
    winnerGroup?: string;
  }): Promise<string | null> {
    if (!source.winnerGroup) return null;
    const pending = await this.prisma.match.count({
      where: { stageId: source.stageId, status: { not: MatchStatus.FINISHED } },
    });
    if (pending > 0) return null; // group stage not complete yet

    const stage = await this.standings.stageStandings(source.stageId);
    const thirds: ThirdSeed[] = stage.groups
      .map((g) => ({ letter: g.groupName, row: g.rows[2] }))
      .filter((t): t is { letter: string; row: NonNullable<typeof t.row> } => !!t.row)
      .map((t) => ({
        letter: t.letter,
        points: t.row.points,
        goalDiff: t.row.goalDiff,
        goalsFor: t.row.goalsFor,
        fairPlay: t.row.fairPlay,
        name: t.row.team.name,
      }));

    const thirdLetter = bestThirdLetter(thirds, source.winnerGroup);
    if (!thirdLetter) return null;

    const grp = stage.groups.find((g) => g.groupName === thirdLetter);
    return grp?.rows[2]?.team.id ?? null;
  }

  /**
   * Read-only PROJECTION of the knockout bracket from the CURRENT standings:
   * fills each unresolved slot with the team that WOULD occupy it right now
   * (current group position / current best third) and propagates a tie's
   * provisional leader (current aggregate of a tie with real teams being played)
   * into the next round. Never writes — real slots stay TBD until a group
   * finishes. Returns tieId → projected {home, away, winner} teams; the caller
   * surfaces only the parts not yet officially resolved (so they read as
   * "provável"). A slot is only projected once its group/stage has ≥1 played
   * match (no meaningless all-zero alphabetical projection).
   */
  async projectBracket(seasonId: string): Promise<Map<string, TieProjection>> {
    const stages = await this.standings.seasonStandings(seasonId);
    const teamById = new Map<string, StandingsTeam>();
    const groupRank = new Map<string, string[]>(); // groupId → team ids by current position
    const groupHasData = new Map<string, boolean>();
    const stageHasData = new Map<string, boolean>();
    for (const st of stages) {
      let stData = false;
      for (const g of st.groups) {
        groupRank.set(g.groupId, g.rows.map((r) => r.team.id));
        const has = g.rows.some((r) => r.played > 0);
        groupHasData.set(g.groupId, has);
        if (has) stData = true;
        for (const r of g.rows) teamById.set(r.team.id, r.team);
      }
      stageHasData.set(st.stageId, stData);
    }
    const stageById = new Map(stages.map((s) => [s.stageId, s]));

    const bestThird = (stageId: string, winnerGroup?: string): string | null => {
      if (!winnerGroup || !stageHasData.get(stageId)) return null;
      const st = stageById.get(stageId);
      if (!st) return null;
      const thirds: ThirdSeed[] = st.groups
        .map((g) => ({ letter: g.groupName, row: g.rows[2] }))
        .filter((t): t is { letter: string; row: NonNullable<typeof t.row> } => !!t.row)
        .map((t) => ({
          letter: t.letter,
          points: t.row.points,
          goalDiff: t.row.goalDiff,
          goalsFor: t.row.goalsFor,
          fairPlay: t.row.fairPlay,
          name: t.row.team.name,
        }));
      const letter = bestThirdLetter(thirds, winnerGroup);
      if (!letter) return null;
      return st.groups.find((g) => g.groupName === letter)?.rows[2]?.team.id ?? null;
    };

    const koStages = await this.prisma.stage.findMany({
      where: { seasonId, format: 'KNOCKOUT' },
      orderBy: { order: 'asc' },
      include: {
        rounds: {
          orderBy: { order: 'asc' },
          include: {
            ties: {
              orderBy: { order: 'asc' },
              select: {
                id: true,
                homeTeamId: true,
                awayTeamId: true,
                winnerTeamId: true,
                homeSource: true,
                awaySource: true,
                matches: {
                  select: { status: true, homeScore: true, awayScore: true, homeTeamId: true, awayTeamId: true },
                },
              },
            },
          },
        },
      },
    });

    // id-level cascade (rounds processed in order so MATCH_WINNER feeders can
    // read earlier rounds' projected winners).
    const ids = new Map<string, { home: string | null; away: string | null; winner: string | null }>();
    const projectSource = (src: SlotSource | null): string | null => {
      if (!src) return null;
      switch (src.type) {
        case 'GROUP_POSITION':
          return groupHasData.get(src.groupId)
            ? (groupRank.get(src.groupId)?.[src.position - 1] ?? null)
            : null;
        case 'BEST_RANKED':
          return bestThird(src.stageId, src.winnerGroup);
        case 'MATCH_WINNER':
          return ids.get(src.tieId)?.winner ?? null;
        case 'MATCH_LOSER': {
          const p = ids.get(src.tieId);
          if (!p?.winner || !p.home || !p.away) return null;
          return p.winner === p.home ? p.away : p.home;
        }
      }
    };

    for (const stage of koStages) {
      for (const round of stage.rounds) {
        for (const tie of round.ties) {
          const home = tie.homeTeamId ?? projectSource(tie.homeSource as unknown as SlotSource | null);
          const away = tie.awayTeamId ?? projectSource(tie.awaySource as unknown as SlotSource | null);
          let winner = tie.winnerTeamId ?? null;
          // Provisional leader: only for a tie with REAL teams currently playing.
          if (!winner && tie.homeTeamId && tie.awayTeamId) {
            winner = this.provisionalLeader(tie.homeTeamId, tie.awayTeamId, tie.matches);
          }
          ids.set(tie.id, { home, away, winner });
        }
      }
    }

    const out = new Map<string, TieProjection>();
    for (const [tieId, p] of ids) {
      out.set(tieId, {
        home: p.home ? (teamById.get(p.home) ?? null) : null,
        away: p.away ? (teamById.get(p.away) ?? null) : null,
        winner: p.winner ? (teamById.get(p.winner) ?? null) : null,
      });
    }
    return out;
  }

  /** Current-aggregate leader of a tie with real teams (counts LIVE + FINISHED
   *  legs); null when level or nothing played. Powers the provisional winner. */
  private provisionalLeader(
    home: string,
    away: string,
    legs: { status: MatchStatus; homeScore: number; awayScore: number; homeTeamId: string | null; awayTeamId: string | null }[],
  ): string | null {
    let aggHome = 0;
    let aggAway = 0;
    let counted = 0;
    for (const leg of legs) {
      if (leg.status !== MatchStatus.LIVE && leg.status !== MatchStatus.FINISHED) continue;
      if (leg.homeTeamId === home) {
        aggHome += leg.homeScore;
        aggAway += leg.awayScore;
        counted++;
      } else if (leg.homeTeamId === away) {
        aggHome += leg.awayScore;
        aggAway += leg.homeScore;
        counted++;
      }
    }
    if (!counted) return null;
    if (aggHome > aggAway) return home;
    if (aggAway > aggHome) return away;
    return null;
  }

  private computeAggregate(
    homeTeamId: string | null,
    awayTeamId: string | null,
    legs: LegMatch[],
  ): {
    aggregateHome: number;
    aggregateAway: number;
    winnerTeamId: string | null;
    resolution: TieResolution | null;
  } | null {
    if (!homeTeamId || !awayTeamId || legs.length === 0) return null;
    if (legs.some((l) => l.status !== MatchStatus.FINISHED)) return null;

    let aggHome = 0;
    let aggAway = 0;
    for (const leg of legs) {
      // Map each leg's goals onto the tie's home/away orientation.
      if (leg.homeTeamId === homeTeamId) {
        aggHome += leg.homeScore;
        aggAway += leg.awayScore;
      } else if (leg.homeTeamId === awayTeamId) {
        aggHome += leg.awayScore;
        aggAway += leg.homeScore;
      } else {
        // Leg not yet attributed to the tie's teams — can't aggregate reliably.
        return null;
      }
    }

    let winnerTeamId: string | null = null;
    let resolution: TieResolution | null = null;
    if (aggHome > aggAway) {
      winnerTeamId = homeTeamId;
      resolution = TieResolution.AGGREGATE;
    } else if (aggAway > aggHome) {
      winnerTeamId = awayTeamId;
      resolution = TieResolution.AGGREGATE;
    } else {
      // Level aggregate → decided by the last leg's shootout, if any.
      const decisive = legs[legs.length - 1];
      const hp = decisive.homePenalties;
      const ap = decisive.awayPenalties;
      if (hp != null && ap != null && hp !== ap) {
        const penWinnerIsLegHome = hp > ap;
        const legHomeIsTieHome = decisive.homeTeamId === homeTeamId;
        winnerTeamId =
          penWinnerIsLegHome === legHomeIsTieHome ? homeTeamId : awayTeamId;
        resolution = TieResolution.PENALTIES;
      }
    }

    return { aggregateHome: aggHome, aggregateAway: aggAway, winnerTeamId, resolution };
  }

  /** Write the tie's resolved participants onto its leg matches (leg 2 swaps home/away). */
  private async mirrorToMatches(
    homeTeamId: string | null,
    awayTeamId: string | null,
    legs: LegMatch[],
  ): Promise<boolean> {
    let changed = false;
    for (const leg of legs) {
      const isSecondLeg = leg.leg === 2;
      const wantHome = isSecondLeg ? awayTeamId : homeTeamId;
      const wantAway = isSecondLeg ? homeTeamId : awayTeamId;
      const patch: Record<string, string> = {};
      if (wantHome && !leg.homeTeamId) patch.homeTeamId = wantHome;
      if (wantAway && !leg.awayTeamId) patch.awayTeamId = wantAway;
      if (Object.keys(patch).length) {
        await this.prisma.match.update({ where: { id: leg.id }, data: patch });
        changed = true;
      }
    }
    return changed;
  }
}

interface LegMatch {
  id: string;
  leg: number | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number;
  awayScore: number;
  homePenalties: number | null;
  awayPenalties: number | null;
  status: MatchStatus;
}
