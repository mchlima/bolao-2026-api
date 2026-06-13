import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from './scoring.service';

/**
 * Resolves the per-match phase multiplier for a season. Knockout rounds get a
 * depth-based weight (deeper = higher); group/league matches default to 1.
 *
 * Depth is the round's 1-based position within its season's KNOCKOUT stages
 * (ordered by stage then round). It adapts to the bracket: a World Cup starting
 * at the Round of 32 ("16-avos") has more depths than one starting at the Round
 * of 16, with no hardcoded round names. See ScoringService.phaseWeight.
 */
@Injectable()
export class PhaseWeightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
  ) {}

  /**
   * Map of knockout `roundId` → phase weight, across one or more seasons.
   * Rounds absent from the map (group/league, or matches with no round) weigh 1,
   * so callers can `map.get(roundId) ?? 1`. Depth restarts per season.
   */
  async byRound(seasonIds: string | string[]): Promise<Map<string, number>> {
    const ids = Array.isArray(seasonIds) ? seasonIds : [seasonIds];
    const rounds = await this.prisma.round.findMany({
      where: { stage: { seasonId: { in: ids }, format: 'KNOCKOUT' } },
      select: { id: true, order: true, stage: { select: { seasonId: true, order: true } } },
      orderBy: [
        { stage: { seasonId: 'asc' } },
        { stage: { order: 'asc' } },
        { order: 'asc' },
      ],
    });
    const weights = new Map<string, number>();
    const depthBySeason = new Map<string, number>();
    for (const r of rounds) {
      const seasonId = r.stage.seasonId;
      const depth = (depthBySeason.get(seasonId) ?? 0) + 1;
      depthBySeason.set(seasonId, depth);
      weights.set(r.id, this.scoring.phaseWeight(depth));
    }
    return weights;
  }
}
