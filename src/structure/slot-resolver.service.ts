import { Injectable, Logger } from '@nestjs/common';
import { MatchStatus, TieResolution } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StandingsService } from './standings.service';
import { WC2026_THIRDS_TABLE } from './data/wc2026-thirds-table';

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
  name: string;
}

/**
 * Pure: rank the third-placed teams (points → GD → GF → name), take the best 8,
 * and look up — via the FIFA Annex C table — which third faces `winnerGroup`.
 * Returns that third's group letter, or null if undecidable. Exported for testing.
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
   * (points → GD → GF → name), take the best 8, key the table by their group letters,
   * and read which third faces this slot's winner group. Returns null until decidable;
   * admin can override. Cards/FIFA-ranking tiebreaks are not modelled (rare → override).
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
        name: t.row.team.name,
      }));

    const thirdLetter = bestThirdLetter(thirds, source.winnerGroup);
    if (!thirdLetter) return null;

    const grp = stage.groups.find((g) => g.groupName === thirdLetter);
    return grp?.rows[2]?.team.id ?? null;
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
