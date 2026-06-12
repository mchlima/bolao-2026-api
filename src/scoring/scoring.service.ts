import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Proximity scoring (Model B). Getting the outcome (winner/draw) right is the
 * gate; from there points grow with how close each team's goal count is:
 *
 *   wrong outcome            → 0, UNLESS a team's exact goal count matched,
 *                              then → TEAM_EXACT_MISS (flat consolation)
 *   right outcome            → BASE
 *     + per team: exact goals → TEAM_EXACT, off by one → TEAM_NEAR, else 0
 *
 * With the defaults (BASE 4, TEAM_EXACT 3, TEAM_NEAR 1) an exact score is 10.
 * The consolation (TEAM_EXACT_MISS 1) stays strictly below BASE, so getting the
 * outcome right always beats merely nailing one team's goals with the wrong winner.
 * `tier` is a coarse label derived from the same facts (for UI labels/colors).
 * This is the ONE source of truth for scoring — tournament ranking, match
 * ranking (provisional during LIVE) and admin engagement all consume it.
 * See bolao-2026-docs/api/scoring.md.
 */
export type ScoreTier =
  | 'EXACT' // exact score (Cravou)
  | 'ONE_TEAM_SCORE' // right outcome + one team's exact goals
  | 'CLOSE' // right outcome, no exact team, both within one goal (Quase)
  | 'OUTCOME' // right outcome only
  | 'TEAM_GOALS' // WRONG outcome but one team's exact goals matched (consolation)
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
// teamExactMiss (Decision #18, 2026-06-12): consolation for nailing one team's
// goal count even when the outcome (winner/draw) is wrong. Must stay < base.
const DEFAULTS = { base: 4, teamExact: 3, teamNear: 1, teamExactMiss: 1 };

@Injectable()
export class ScoringService {
  private readonly base: number;
  private readonly teamExact: number;
  private readonly teamNear: number;
  private readonly teamExactMiss: number;

  constructor(config: ConfigService) {
    this.base = envInt(config, 'SCORING_BASE', DEFAULTS.base);
    this.teamExact = envInt(config, 'SCORING_TEAM_EXACT', DEFAULTS.teamExact);
    this.teamNear = envInt(config, 'SCORING_TEAM_NEAR', DEFAULTS.teamNear);
    this.teamExactMiss = envInt(
      config,
      'SCORING_TEAM_EXACT_MISS',
      DEFAULTS.teamExactMiss,
    );
  }

  /** Coarse label for the prediction vs the actual result (drives UI copy). */
  tierFor(pred: Scoreline, result: Scoreline): ScoreTier {
    if (pred.home === result.home && pred.away === result.away) return 'EXACT';
    if (
      Math.sign(pred.home - pred.away) !== Math.sign(result.home - result.away)
    ) {
      // Wrong winner/draw: only an exact team-goal count earns the consolation.
      // (Both exact would be EXACT, handled above, so at most one matches here.)
      return pred.home === result.home || pred.away === result.away
        ? 'TEAM_GOALS'
        : 'NONE';
    }
    const dh = Math.abs(pred.home - result.home);
    const da = Math.abs(pred.away - result.away);
    if (dh === 0 || da === 0) return 'ONE_TEAM_SCORE';
    if (dh <= 1 && da <= 1) return 'CLOSE';
    return 'OUTCOME';
  }

  score(pred: Scoreline, result: Scoreline): ScoreResult {
    const tier = this.tierFor(pred, result);
    if (tier === 'NONE') return { tier, points: 0 };
    if (tier === 'TEAM_GOALS') {
      // Outcome missed: flat consolation per team whose exact goal count matched
      // (only the exact match counts here — "off by one" does not).
      const exacts =
        (pred.home === result.home ? 1 : 0) +
        (pred.away === result.away ? 1 : 0);
      return { tier, points: exacts * this.teamExactMiss };
    }
    const per = (d: number) =>
      d === 0 ? this.teamExact : d === 1 ? this.teamNear : 0;
    const points =
      this.base +
      per(Math.abs(pred.home - result.home)) +
      per(Math.abs(pred.away - result.away));
    return { tier, points };
  }
}

function envInt(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  const n = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
