import { ConfigService } from '@nestjs/config';
import { ScoringService, ScoreTier } from './scoring.service';

describe('ScoringService', () => {
  // ConfigService that returns no overrides → service uses defaults.
  const service = new ScoringService({
    get: () => undefined,
  } as unknown as ConfigService);

  const cases: Array<{
    name: string;
    pred: [number, number];
    result: [number, number];
    tier: ScoreTier;
    points: number;
  }> = [
    { name: 'exact score', pred: [2, 1], result: [2, 1], tier: 'EXACT', points: 10 },
    { name: 'exact draw', pred: [0, 0], result: [0, 0], tier: 'EXACT', points: 10 },
    { name: 'home goals match', pred: [2, 0], result: [2, 3], tier: 'ONE_TEAM_SCORE', points: 5 },
    { name: 'away goals match', pred: [0, 1], result: [3, 1], tier: 'ONE_TEAM_SCORE', points: 5 },
    { name: 'goal diff, home win', pred: [1, 0], result: [2, 1], tier: 'GOAL_DIFF', points: 4 },
    { name: 'goal diff, draw', pred: [1, 1], result: [2, 2], tier: 'GOAL_DIFF', points: 4 },
    { name: 'outcome only (home)', pred: [3, 0], result: [2, 1], tier: 'OUTCOME', points: 3 },
    { name: 'outcome only (away)', pred: [0, 3], result: [1, 2], tier: 'OUTCOME', points: 3 },
    { name: 'nothing', pred: [0, 2], result: [2, 0], tier: 'NONE', points: 0 },
  ];

  it.each(cases)('$name → $tier ($points)', ({ pred, result, tier, points }) => {
    const r = service.score(
      { home: pred[0], away: pred[1] },
      { home: result[0], away: result[1] },
    );
    expect(r.tier).toBe(tier);
    expect(r.points).toBe(points);
  });

  it('returns only the single highest tier (not cumulative)', () => {
    // Exact also satisfies one-team and outcome, but must return EXACT only.
    expect(service.tierFor({ home: 2, away: 1 }, { home: 2, away: 1 })).toBe(
      'EXACT',
    );
  });

  it('honors env overrides for tier points', () => {
    const custom = new ScoringService({
      get: (k: string) => (k === 'SCORING_EXACT' ? '25' : undefined),
    } as unknown as ConfigService);
    expect(custom.score({ home: 1, away: 0 }, { home: 1, away: 0 }).points).toBe(
      25,
    );
  });
});
