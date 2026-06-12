import { ConfigService } from '@nestjs/config';
import { ScoringService, ScoreTier } from './scoring.service';

describe('ScoringService (Model B — proximity)', () => {
  // ConfigService that returns no overrides → service uses defaults (4/3/1).
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
    {
      name: 'exact score',
      pred: [2, 1],
      result: [2, 1],
      tier: 'EXACT',
      points: 10,
    },
    {
      name: 'exact draw',
      pred: [0, 0],
      result: [0, 0],
      tier: 'EXACT',
      points: 10,
    },
    {
      name: 'one team exact + other near',
      pred: [2, 0],
      result: [2, 1],
      tier: 'ONE_TEAM_SCORE',
      points: 8,
    },
    {
      name: 'one team exact + other far',
      pred: [4, 3],
      result: [4, 1],
      tier: 'ONE_TEAM_SCORE',
      points: 7,
    },
    {
      name: 'close, both off by one',
      pred: [3, 2],
      result: [2, 1],
      tier: 'CLOSE',
      points: 6,
    },
    {
      name: 'close draw',
      pred: [1, 1],
      result: [2, 2],
      tier: 'CLOSE',
      points: 6,
    },
    {
      name: 'outcome only, one near',
      pred: [5, 0],
      result: [2, 1],
      tier: 'OUTCOME',
      points: 5,
    },
    {
      name: 'outcome only, both far',
      pred: [5, 3],
      result: [2, 1],
      tier: 'OUTCOME',
      points: 4,
    },
    {
      name: 'one team exact but wrong winner (consolation)',
      pred: [2, 3],
      result: [2, 1],
      tier: 'TEAM_GOALS',
      points: 1,
    },
    {
      name: 'Fagner: 2x1 on a 0x1 — away goals exact, wrong winner',
      pred: [2, 1],
      result: [0, 1],
      tier: 'TEAM_GOALS',
      points: 1,
    },
    { name: 'nothing', pred: [0, 2], result: [2, 0], tier: 'NONE', points: 0 },
  ];

  it.each(cases)(
    '$name → $tier ($points)',
    ({ pred, result, tier, points }) => {
      const r = service.score(
        { home: pred[0], away: pred[1] },
        { home: result[0], away: result[1] },
      );
      expect(r.tier).toBe(tier);
      expect(r.points).toBe(points);
    },
  );

  it('outcome is the gate — wrong winner with no exact team scores 0', () => {
    expect(service.tierFor({ home: 0, away: 2 }, { home: 2, away: 0 })).toBe(
      'NONE',
    );
  });

  it('wrong winner but one exact team goal → consolation below base', () => {
    const r = service.score({ home: 2, away: 3 }, { home: 2, away: 1 });
    expect(r.tier).toBe('TEAM_GOALS');
    expect(r.points).toBe(1);
    // never beats getting the outcome right (which earns base = 4)
    expect(r.points).toBeLessThan(4);
  });

  it('honors SCORING_TEAM_EXACT_MISS override', () => {
    const custom = new ScoringService({
      get: (k: string) =>
        k === 'SCORING_TEAM_EXACT_MISS' ? '2' : undefined,
    } as unknown as ConfigService);
    expect(
      custom.score({ home: 2, away: 3 }, { home: 2, away: 1 }).points,
    ).toBe(2);
  });

  it('honors env overrides for the point components', () => {
    const custom = new ScoringService({
      get: (k: string) => (k === 'SCORING_BASE' ? '20' : undefined),
    } as unknown as ConfigService);
    // outcome-only (both teams far): BASE only.
    expect(
      custom.score({ home: 5, away: 3 }, { home: 2, away: 1 }).points,
    ).toBe(20);
  });
});
