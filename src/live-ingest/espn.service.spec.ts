import { parseDiscipline, playerFairPlay } from './espn.service';

describe('playerFairPlay (FIFA fair-play points per player/match)', () => {
  it('single yellow = -1', () => {
    expect(playerFairPlay(1, 0)).toBe(-1);
  });
  it('no cards = 0', () => {
    expect(playerFairPlay(0, 0)).toBe(0);
  });
  it('two yellows (sent off) = -3 even if the red event is missing', () => {
    expect(playerFairPlay(2, 0)).toBe(-3);
  });
  it('yellow + red (second booking) = -3', () => {
    expect(playerFairPlay(1, 1)).toBe(-3);
  });
  it('straight red, no prior yellow = -4', () => {
    expect(playerFairPlay(0, 1)).toBe(-4);
  });
  it('extra yellows alongside a red still resolve to a second booking (-3)', () => {
    expect(playerFairPlay(2, 1)).toBe(-3);
  });
});

describe('parseDiscipline (real RSA@MEX feed shape)', () => {
  // Mirrors the live ESPN competition.details[] for event 760415 (2026-06-11):
  // MEX(203): Gutiérrez yellow, Montes straight red → Y1 R1, fair play -5.
  // RSA(467): Mokoena yellow, Sithole red, Sibisi yellow, Zwane red → Y2 R2, -10.
  const idToAbbr = { '203': 'MEX', '467': 'RSA' };
  const card = (
    teamId: string,
    athId: string,
    kind: 'y' | 'r',
  ): {
    yellowCard?: boolean;
    redCard?: boolean;
    team?: { id?: string };
    athletesInvolved?: Array<{ id?: string }>;
  } => ({
    yellowCard: kind === 'y',
    redCard: kind === 'r',
    team: { id: teamId },
    athletesInvolved: [{ id: athId }],
  });
  const details = [
    card('467', 'mokoena', 'y'),
    card('203', 'gutierrez', 'y'),
    card('467', 'sithole', 'r'),
    card('203', 'montes', 'r'),
    card('467', 'sibisi', 'y'),
    card('467', 'zwane', 'r'),
  ];

  it('tallies raw cards and fair play per team', () => {
    const { cards, fairPlay } = parseDiscipline(details, idToAbbr);
    expect(cards).toEqual({ MEX: { yellow: 1, red: 1 }, RSA: { yellow: 2, red: 2 } });
    expect(fairPlay).toEqual({ MEX: -5, RSA: -10 });
  });

  it('scores a second yellow (same player Y then R) as -3', () => {
    const d = [card('203', 'p1', 'y'), card('203', 'p1', 'r')];
    const { cards, fairPlay } = parseDiscipline(d, idToAbbr);
    expect(cards.MEX).toEqual({ yellow: 1, red: 1 });
    expect(fairPlay.MEX).toBe(-3); // one player booked twice, not -1 + -4
  });
});
