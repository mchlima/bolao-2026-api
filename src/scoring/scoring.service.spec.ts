import { ConfigService } from '@nestjs/config';
import { ScoringService } from './scoring.service';

// Defaults (no env overrides): EXACT 25 / WINNER_GOALS 18 / GOAL_DIFF 15 /
// LOSER_GOALS 12 / OUTCOME 10 / NONE 0.
const noEnv = { get: () => undefined } as unknown as ConfigService;
const service = new ScoringService(noEnv);

const sc = (h: number, a: number) => ({ home: h, away: a });

describe('ScoringService.score — granular market model', () => {
  describe('home win 2-1', () => {
    const result = sc(2, 1);
    const cases: Array<[number, number, string, number]> = [
      [2, 1, 'EXACT', 25],
      [2, 0, 'WINNER_GOALS', 18], // winner's goals (2) exact
      [3, 2, 'GOAL_DIFF', 15], // same goal difference (+1)
      [3, 1, 'LOSER_GOALS', 12], // loser's goals (1) exact
      [4, 2, 'OUTCOME', 10], // right winner, nothing else
      [0, 2, 'NONE', 0], // wrong winner
      [1, 1, 'NONE', 0], // predicted draw, was a home win
    ];
    it.each(cases)('%i-%i → %s (%i pts)', (h, a, tier, points) => {
      expect(service.score(sc(h, a), result)).toEqual({ tier, points });
    });
  });

  describe('away win 1-3', () => {
    const result = sc(1, 3);
    it('0-2 keeps the goal difference (-2) → GOAL_DIFF 15', () => {
      expect(service.score(sc(0, 2), result)).toEqual({
        tier: 'GOAL_DIFF',
        points: 15,
      });
    });
    it('1-4 nails the loser (home 1) goals → LOSER_GOALS 12', () => {
      expect(service.score(sc(1, 4), result)).toEqual({
        tier: 'LOSER_GOALS',
        points: 12,
      });
    });
    it('0-3 nails the winner (away 3) goals → WINNER_GOALS 18', () => {
      expect(service.score(sc(0, 3), result)).toEqual({
        tier: 'WINNER_GOALS',
        points: 18,
      });
    });
  });

  describe('draw 2-2 (no winner/loser, so only EXACT or OUTCOME)', () => {
    const result = sc(2, 2);
    it('2-2 → EXACT 25', () =>
      expect(service.score(sc(2, 2), result).tier).toBe('EXACT'));
    it('1-1 → OUTCOME 10 (right draw, wrong score)', () =>
      expect(service.score(sc(1, 1), result)).toEqual({
        tier: 'OUTCOME',
        points: 10,
      }));
    it('0-0 → OUTCOME 10', () =>
      expect(service.score(sc(0, 0), result).points).toBe(10));
    it('3-1 → NONE 0 (predicted a home win)', () =>
      expect(service.score(sc(3, 1), result)).toEqual({
        tier: 'NONE',
        points: 0,
      }));
  });

  describe('phase weight (knockout multiplier, progressive with cap)', () => {
    it('default step 1, cap 3: group 1×, then 2×, 3×, capped at 3×', () => {
      expect(service.phaseWeight(0)).toBe(1); // group
      expect(service.phaseWeight(1)).toBe(2); // 16-avos
      expect(service.phaseWeight(2)).toBe(3); // oitavas
      expect(service.phaseWeight(3)).toBe(3); // quartas — capped
      expect(service.phaseWeight(5)).toBe(3); // final — capped
    });
    it('weight multiplies the points, not the tier', () => {
      expect(service.score(sc(2, 1), sc(2, 1), 3)).toEqual({
        tier: 'EXACT',
        points: 75,
      });
      expect(service.score(sc(4, 2), sc(2, 1), 2)).toEqual({
        tier: 'OUTCOME',
        points: 20,
      });
    });
  });

  describe('env overrides', () => {
    const make = (env: Record<string, string>) =>
      new ScoringService({
        get: (k: string) => env[k],
      } as unknown as ConfigService);

    it('honors SCORING_* point values', () => {
      expect(make({ SCORING_EXACT: '30' }).score(sc(2, 1), sc(2, 1)).points).toBe(
        30,
      );
    });

    it('"dobrar fixo": step 1 + cap 2 → every knockout round is 2×', () => {
      const s = make({ SCORING_PHASE_STEP: '1', SCORING_PHASE_CAP: '2' });
      expect(s.phaseWeight(0)).toBe(1); // group
      expect(s.phaseWeight(1)).toBe(2); // 16-avos
      expect(s.phaseWeight(4)).toBe(2); // semis — still 2×
    });

    it('cap 0 = no cap (pure progression); step 2', () => {
      const s = make({ SCORING_PHASE_STEP: '2', SCORING_PHASE_CAP: '0' });
      expect(s.phaseWeight(1)).toBe(3); // 1 + 1*2
      expect(s.phaseWeight(3)).toBe(7); // 1 + 3*2, uncapped
    });

    it('step 0 disables phase weighting', () => {
      const s = make({ SCORING_PHASE_STEP: '0' });
      expect(s.phaseWeight(5)).toBe(1);
    });
  });
});
