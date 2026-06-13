import { bestThirdLetter, ThirdSeed } from './slot-resolver.service';
import { WC2026_THIRDS_TABLE } from './data/wc2026-thirds-table';

const third = (letter: string, points: number): ThirdSeed => ({
  letter,
  points,
  goalDiff: 0,
  goalsFor: 0,
  name: letter,
});

describe('Annex C third-place table', () => {
  it('has all 495 combinations', () => {
    expect(Object.keys(WC2026_THIRDS_TABLE)).toHaveLength(495);
  });

  it('every combination maps the 8 winner columns to distinct third groups', () => {
    for (const [key, assign] of Object.entries(WC2026_THIRDS_TABLE)) {
      expect(key).toHaveLength(8);
      const winners = Object.keys(assign);
      expect(winners.sort()).toEqual(['A', 'B', 'D', 'E', 'G', 'I', 'K', 'L']);
      const thirds = Object.values(assign);
      expect(new Set(thirds).size).toBe(8); // each qualifying third used once
      expect(thirds.sort().join('')).toBe(key); // the 8 assigned thirds == the key set
    }
  });
});

describe('bestThirdLetter', () => {
  // E,F,G,H,I,J,K,L finish 3rd with points; A,B,C,D's thirds don't qualify.
  const thirds: ThirdSeed[] = [
    third('A', 0), third('B', 0), third('C', 0), third('D', 0),
    third('E', 3), third('F', 3), third('G', 3), third('H', 3),
    third('I', 3), third('J', 3), third('K', 3), third('L', 3),
  ];

  it('matches Annex C row 1 (set EFGHIJKL)', () => {
    // Table row 1: 1A→3E, 1B→3J, 1D→3I, 1E→3F, 1G→3H, 1I→3G, 1K→3L, 1L→3K.
    expect(bestThirdLetter(thirds, 'A')).toBe('E');
    expect(bestThirdLetter(thirds, 'B')).toBe('J');
    expect(bestThirdLetter(thirds, 'E')).toBe('F');
    expect(bestThirdLetter(thirds, 'L')).toBe('K');
  });

  it('returns null with fewer than 8 thirds', () => {
    expect(bestThirdLetter(thirds.slice(0, 5), 'A')).toBeNull();
  });

  it('returns null for a winner group that does not host a third', () => {
    // Only winners of A,B,D,E,G,I,K,L host a third — C never does.
    expect(bestThirdLetter(thirds, 'C')).toBeNull();
  });

  it('fair play decides which third makes the best-8 cut', () => {
    // 7 thirds clearly qualify (6 pts); 3 clearly don't (0 pts). The 8th slot is
    // contested between A and L — level on points/GD/GF, so fair play decides.
    const winners = ['A', 'B', 'D', 'E', 'G', 'I', 'K', 'L'];
    const base = [
      third('B', 6), third('C', 6), third('D', 6), third('E', 6),
      third('F', 6), third('G', 6), third('H', 6),
      third('I', 0), third('J', 0), third('K', 0),
    ];
    const fp = (s: ThirdSeed, v: number): ThirdSeed => ({ ...s, fairPlay: v });
    // L cleaner than A → L takes the 8th slot (A would win the name tiebreak).
    const lWins = [...base, fp(third('A', 3), -5), fp(third('L', 3), 0)];
    const aWins = [...base, fp(third('A', 3), 0), fp(third('L', 3), -5)];

    const resL = winners.map((w) => bestThirdLetter(lWins, w));
    const resA = winners.map((w) => bestThirdLetter(aWins, w));
    // Swapping ONLY the fair-play values flips which team qualifies.
    expect(resL).toContain('L');
    expect(resL).not.toContain('A');
    expect(resA).toContain('A');
    expect(resA).not.toContain('L');
  });
});
