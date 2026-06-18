import { raiseStatus, resumedClock } from './live-merge';
import { EspnMatchEvent } from '../live-ingest/espn.service';

const ev = (over: Partial<EspnMatchEvent>): EspnMatchEvent => ({
  espnId: 'x',
  type: 'FOUL',
  detail: null,
  minute: null,
  clockValue: 0,
  period: 1,
  espnTeamId: null,
  playerEspnId: null,
  relatedEspnId: null,
  text: null,
  ...over,
});

describe('raiseStatus (most-advanced wins, monotonic)', () => {
  it('SCHEDULED → LIVE when a feed reports in-progress', () => {
    expect(raiseStatus('SCHEDULED', ['in'])).toBe('LIVE');
  });

  it('SCHEDULED → FINISHED straight from post', () => {
    expect(raiseStatus('SCHEDULED', ['post'])).toBe('FINISHED');
  });

  it('takes the most advanced of two disagreeing feeds', () => {
    expect(raiseStatus('LIVE', ['in', 'post'])).toBe('FINISHED');
    expect(raiseStatus('SCHEDULED', ['pre', 'in'])).toBe('LIVE');
  });

  it('does not advance on pre', () => {
    expect(raiseStatus('SCHEDULED', ['pre'])).toBeNull();
  });

  it('does not re-raise the status it already holds', () => {
    expect(raiseStatus('LIVE', ['in'])).toBeNull();
    expect(raiseStatus('FINISHED', ['post'])).toBeNull();
  });

  it('never goes backwards — a lagging feed cannot un-finish a match', () => {
    expect(raiseStatus('FINISHED', ['in'])).toBeNull();
    expect(raiseStatus('FINISHED', ['pre', 'in'])).toBeNull();
    expect(raiseStatus('LIVE', ['pre'])).toBeNull();
  });

  it('returns null with no live states this tick', () => {
    expect(raiseStatus('LIVE', [])).toBeNull();
  });
});

describe('resumedClock (half-time → resume from the events feed)', () => {
  it('null while only 1st-half events have landed (genuine break)', () => {
    expect(resumedClock([ev({ period: 1, minute: "45'+2'" })])).toBeNull();
  });

  it('returns the 2nd-half event minute once one lands', () => {
    expect(
      resumedClock([
        ev({ period: 1, minute: "45'" }),
        ev({ period: 2, clockValue: 2700, minute: "46'" }),
      ]),
    ).toBe("46'");
  });

  it('picks the latest 2nd-half event by clock', () => {
    expect(
      resumedClock([
        ev({ period: 2, clockValue: 2760, minute: "47'" }),
        ev({ period: 2, clockValue: 2820, minute: "48'" }),
        ev({ period: 2, clockValue: 2700, minute: "46'" }),
      ]),
    ).toBe("48'");
  });

  it('prefers a higher period over a higher clock (extra time)', () => {
    expect(
      resumedClock([
        ev({ period: 2, clockValue: 5400, minute: "90'" }),
        ev({ period: 3, clockValue: 100, minute: "91'" }),
      ]),
    ).toBe("91'");
  });

  it('null when the 2nd-half event carries no minute', () => {
    expect(
      resumedClock([ev({ period: 2, clockValue: 2700, minute: null })]),
    ).toBeNull();
  });

  it('null on no events', () => {
    expect(resumedClock([])).toBeNull();
  });
});
