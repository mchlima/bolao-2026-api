import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Score tiers, highest → lowest. Layered (NOT cumulative): a prediction yields ONLY the
 * single highest tier it reaches. This is the ONE source of truth for scoring — tournament
 * ranking, match ranking (provisional during LIVE) and admin engagement all consume it.
 * See bolao-2026-docs/api/scoring.md.
 */
export type ScoreTier =
  | 'EXACT' // exact score
  | 'ONE_TEAM_SCORE' // got one team's goal count
  | 'GOAL_DIFF' // got the goal difference (⇒ same result)
  | 'OUTCOME' // got only the winner/draw
  | 'NONE';

export interface Scoreline {
  home: number;
  away: number;
}

export interface ScoreResult {
  tier: ScoreTier;
  points: number;
}

// Decision #1: values configurable via env (SCORING_*); defaults below.
const DEFAULTS: Record<ScoreTier, number> = {
  EXACT: 10,
  ONE_TEAM_SCORE: 5,
  GOAL_DIFF: 4,
  OUTCOME: 3,
  NONE: 0,
};

@Injectable()
export class ScoringService {
  private readonly points: Record<ScoreTier, number>;

  constructor(config: ConfigService) {
    this.points = {
      EXACT: envInt(config, 'SCORING_EXACT', DEFAULTS.EXACT),
      ONE_TEAM_SCORE: envInt(
        config,
        'SCORING_ONE_TEAM_SCORE',
        DEFAULTS.ONE_TEAM_SCORE,
      ),
      GOAL_DIFF: envInt(config, 'SCORING_GOAL_DIFF', DEFAULTS.GOAL_DIFF),
      OUTCOME: envInt(config, 'SCORING_OUTCOME', DEFAULTS.OUTCOME),
      NONE: 0,
    };
  }

  /** The single highest tier the prediction reaches against the actual result. */
  tierFor(pred: Scoreline, result: Scoreline): ScoreTier {
    if (pred.home === result.home && pred.away === result.away) return 'EXACT';
    if (pred.home === result.home || pred.away === result.away)
      return 'ONE_TEAM_SCORE';
    if (pred.home - pred.away === result.home - result.away) return 'GOAL_DIFF';
    if (Math.sign(pred.home - pred.away) === Math.sign(result.home - result.away))
      return 'OUTCOME';
    return 'NONE';
  }

  score(pred: Scoreline, result: Scoreline): ScoreResult {
    const tier = this.tierFor(pred, result);
    return { tier, points: this.points[tier] };
  }

  /** Current configured point value of a tier (e.g. for docs/diagnostics). */
  pointsFor(tier: ScoreTier): number {
    return this.points[tier];
  }
}

function envInt(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  const n = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
