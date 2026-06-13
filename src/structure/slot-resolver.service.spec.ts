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
});
