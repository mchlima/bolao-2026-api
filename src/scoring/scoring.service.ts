import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Market-traditional, tier-based scoring (granular "dacopa" model). Getting the
 * outcome (winner/draw) right is the gate; within a correct outcome, the more
 * precise the prediction, the more it earns — by this priority:
 *
 *   wrong winner/draw                → NONE         (0)
 *   exact scoreline                  → EXACT        (cravou)
 *   right winner + winner's goals    → WINNER_GOALS (vencedor + gols do vencedor)
 *   right winner + goal difference   → GOAL_DIFF    (vencedor + saldo)
 *   right winner + loser's goals     → LOSER_GOALS  (vencedor + gols do perdedor)
 *   right winner/draw, nothing else  → OUTCOME      (só o vencedor/empate)
 *
 * A draw has no winner/loser, so a correct-but-inexact draw is always OUTCOME.
 *
 * Defaults (via SCORING_* env): EXACT 25, WINNER_GOALS 18, GOAL_DIFF 15,
 * LOSER_GOALS 12, OUTCOME 10. Knockout matches scale by a phase weight (see
 * phaseWeight) so deeper rounds are worth more. `tier` is a label derived from
 * the same facts (UI copy/colors). This is the ONE source of truth for scoring —
 * tournament ranking, match ranking (provisional during LIVE) and admin
 * engagement all consume it. See bolao-2026-docs/api/scoring.md.
 */
export type ScoreTier =
  | 'EXACT' // exact scoreline (Cravou)
  | 'WINNER_GOALS' // right winner + winner's exact goals
  | 'GOAL_DIFF' // right winner + goal difference (saldo)
  | 'LOSER_GOALS' // right winner + loser's exact goals
  | 'OUTCOME' // right winner/draw only
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
// Granular market model (Decision #19, 2026-06-13): replaces the proximity model
// to match how Brazilian/worldwide bolões score — "saldo de gols" is a tier.
const DEFAULTS = {
  exact: 25,
  winnerGoals: 18,
  goalDiff: 15,
  loserGoals: 12,
  outcome: 10,
  // Knockout multiplier: weight = min(1 + depth * phaseStep, phaseCap).
  // depth 0 = group (always 1×). phaseStep = how much each knockout round adds
  // (+1, +2, …). phaseCap = ceiling (0 = no ceiling, pure progression).
  // "Dobrar fixo no mata-mata" = step 1 + cap 2 (every knockout round → 2×).
  phaseStep: 1,
  phaseCap: 3,
};

type ScoredTier = Exclude<ScoreTier, 'NONE'>;

@Injectable()
export class ScoringService {
  private readonly points: Record<ScoredTier, number>;
  private readonly phaseStep: number;
  private readonly phaseCap: number;

  constructor(config: ConfigService) {
    this.points = {
      EXACT: envInt(config, 'SCORING_EXACT', DEFAULTS.exact),
      WINNER_GOALS: envInt(config, 'SCORING_WINNER_GOALS', DEFAULTS.winnerGoals),
      GOAL_DIFF: envInt(config, 'SCORING_GOAL_DIFF', DEFAULTS.goalDiff),
      LOSER_GOALS: envInt(config, 'SCORING_LOSER_GOALS', DEFAULTS.loserGoals),
      OUTCOME: envInt(config, 'SCORING_OUTCOME', DEFAULTS.outcome),
    };
    this.phaseStep = envInt(config, 'SCORING_PHASE_STEP', DEFAULTS.phaseStep);
    this.phaseCap = envInt(config, 'SCORING_PHASE_CAP', DEFAULTS.phaseCap);
  }

  /** Coarse label for the prediction vs the actual result (drives UI copy). */
  tierFor(pred: Scoreline, result: Scoreline): ScoreTier {
    const po = Math.sign(pred.home - pred.away);
    const ro = Math.sign(result.home - result.away);
    if (po !== ro) return 'NONE'; // missed the winner/draw — the gate
    if (pred.home === result.home && pred.away === result.away) return 'EXACT';
    if (ro === 0) return 'OUTCOME'; // correct but inexact draw: no winner/loser
    // Decisive result, correct winner side. Rank by winner's / saldo / loser's.
    const predWin = po > 0 ? pred.home : pred.away;
    const predLose = po > 0 ? pred.away : pred.home;
    const resWin = ro > 0 ? result.home : result.away;
    const resLose = ro > 0 ? result.away : result.home;
    if (predWin === resWin) return 'WINNER_GOALS';
    if (pred.home - pred.away === result.home - result.away) return 'GOAL_DIFF';
    if (predLose === resLose) return 'LOSER_GOALS';
    return 'OUTCOME';
  }

  /**
   * Points for a prediction. `weight` scales the result for knockout phases
   * (1 for group/league); see phaseWeight. The tier itself is weight-independent.
   */
  score(pred: Scoreline, result: Scoreline, weight = 1): ScoreResult {
    const tier = this.tierFor(pred, result);
    const base = tier === 'NONE' ? 0 : this.points[tier];
    return { tier, points: base * weight };
  }

  /**
   * Phase multiplier by knockout depth. depth 0 = group/league (weight 1);
   * depth 1..N = knockout rounds from the first to the final. The weight grows
   * by SCORING_PHASE_STEP per round and is capped by SCORING_PHASE_CAP:
   *
   *   weight = min(1 + depth * step, cap)         (cap 0 = no cap, pure progression)
   *
   * Adapts to any bracket size — a tournament starting at the Round of 32 simply
   * has more depths than one starting at the Round of 16. "Dobrar fixo no
   * mata-mata" = step 1 + cap 2 (every knockout round → 2×). step 0 (or cap 1)
   * disables phase weighting entirely.
   */
  phaseWeight(depth: number): number {
    const raw = 1 + Math.max(0, depth) * this.phaseStep;
    const cap = Math.max(1, this.phaseCap); // cap < 1 is meaningless; floor at 1×
    return this.phaseCap > 0 ? Math.min(raw, cap) : raw;
  }
}

function envInt(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  const n = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
