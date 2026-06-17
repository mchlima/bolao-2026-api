import {
  LiveScoreReconciler,
  parseCommentaryVarEvents,
  parseDiscipline,
  playerFairPlay,
} from './espn.service';

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

describe('LiveScoreReconciler (VAR drop vs lagging-feed revert)', () => {
  const M = 'match1';
  const CONFIRM = 90_000;
  let r: LiveScoreReconciler;
  beforeEach(() => {
    r = new LiveScoreReconciler();
  });

  it('applies an upward move immediately', () => {
    expect(r.reconcile(M, 'home', 1, 0, false, 0)).toBe(1);
  });

  it('treats null current as 0 (no change reported as 0)', () => {
    expect(r.reconcile(M, 'home', 0, null, false, 0)).toBeUndefined();
    expect(r.reconcile(M, 'home', 1, null, false, 0)).toBe(1);
  });

  it('leaves an unchanged score alone', () => {
    expect(r.reconcile(M, 'home', 2, 2, false, 0)).toBeUndefined();
  });

  it('ignores a lagging-feed drop that recovers within the window', () => {
    // Stored 1; a stale feed reports 0, then re-asserts 1 before confirmation.
    expect(r.reconcile(M, 'home', 0, 1, false, 0)).toBeUndefined();
    expect(r.reconcile(M, 'home', 0, 1, false, 30_000)).toBeUndefined();
    // Feed catches up to the real score → pending drop is cleared.
    expect(r.reconcile(M, 'home', 1, 1, false, 60_000)).toBeUndefined();
    // Even past the window, the earlier drop must not resurface.
    expect(r.reconcile(M, 'home', 1, 1, false, 200_000)).toBeUndefined();
  });

  it('applies a VAR annulment once the lower score persists past the window', () => {
    // Stored 1 (annulled goal still counted); feed consistently reports 0.
    expect(r.reconcile(M, 'home', 0, 1, false, 0)).toBeUndefined();
    expect(r.reconcile(M, 'home', 0, 1, false, CONFIRM - 1)).toBeUndefined();
    expect(r.reconcile(M, 'home', 0, 1, false, CONFIRM)).toBe(0);
  });

  it('restarts the timer if the pending drop target changes', () => {
    expect(r.reconcile(M, 'home', 1, 2, false, 0)).toBeUndefined(); // 2→1 pending
    expect(r.reconcile(M, 'home', 0, 2, false, 50_000)).toBeUndefined(); // now 2→0, timer resets
    expect(r.reconcile(M, 'home', 0, 2, false, 50_000 + CONFIRM - 1)).toBeUndefined();
    expect(r.reconcile(M, 'home', 0, 2, false, 50_000 + CONFIRM)).toBe(0);
  });

  it('takes the exact value at once when FINISHED (official correction)', () => {
    expect(r.reconcile(M, 'home', 0, 1, true, 0)).toBe(0);
  });

  it('keeps the two sides independent', () => {
    expect(r.reconcile(M, 'home', 0, 1, false, 0)).toBeUndefined();
    expect(r.reconcile(M, 'away', 3, 2, false, 0)).toBe(3); // away up applies, home drop still pending
    expect(r.reconcile(M, 'home', 0, 1, false, CONFIRM)).toBe(0);
  });
});

describe('parseCommentaryVarEvents (VAR rulings live in commentary, not keyEvents)', () => {
  // Real ARG@ALG (event 760433) commentary shape: a goal chalked off + its formal call.
  const names = new Map([['algeria', '624'], ['argentina', '202']]);
  const deletion = {
    play: {
      id: '49535759',
      type: { id: '175', text: 'Deleted After Review', type: 'deleted-after-review' },
      text: 'GOAL OVERTURNED BY VAR: Farès Chaïbi (Algeria) scores but the goal is ruled out after a VAR review.',
      period: { number: 1 },
      clock: { value: 447, displayValue: "8'" },
      team: { displayName: 'Algeria' },
    },
  };
  const noGoalDecision = {
    play: {
      id: '49535801',
      type: { text: 'VAR - Referee decision cancelled', type: 'var-referee-decision-cancelled' },
      text: 'VAR Decision: No Goal Argentina 0-0 Algeria.',
      period: { number: 1 },
      clock: { value: 510, displayValue: "9'" },
      team: { displayName: 'Algeria' },
    },
  };
  const foul = {
    play: { id: '1', type: { text: 'Foul', type: 'foul' }, text: 'Foul by someone.', clock: { value: 600 } },
  };

  it('extracts a disallowed goal as a VAR event on the right side', () => {
    const out = parseCommentaryVarEvents([foul, deletion], names);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      espnId: 'cmt:49535759',
      type: 'VAR',
      detail: 'Gol anulado',
      minute: "8'",
      period: 1,
      espnTeamId: '624',
      playerEspnId: null,
    });
  });

  it('collapses the "No Goal" decision that mirrors a nearby deletion', () => {
    const out = parseCommentaryVarEvents([deletion, noGoalDecision], names);
    expect(out).toHaveLength(1); // not two "Gol anulado" rows
    expect(out[0].espnId).toBe('cmt:49535759'); // the deletion is kept
  });

  it('keeps a standalone "No Goal" decision when no deletion accompanies it', () => {
    const out = parseCommentaryVarEvents([noGoalDecision], names);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ detail: 'Gol anulado', espnId: 'cmt:49535801' });
  });

  it('leaves the team unresolved when the name is unknown', () => {
    const out = parseCommentaryVarEvents([deletion], new Map());
    expect(out[0].espnTeamId).toBeNull();
  });

  it('ignores non-VAR commentary and plays without an id', () => {
    expect(parseCommentaryVarEvents([foul], names)).toHaveLength(0);
    expect(parseCommentaryVarEvents([{ play: { ...deletion.play, id: undefined } }], names)).toHaveLength(0);
  });
});
