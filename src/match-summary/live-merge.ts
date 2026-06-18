import { MatchStatus } from '@prisma/client';
import { EspnMatchEvent } from '../live-ingest/espn.service';
import { RANK, STATE_TO_STATUS } from '../live-ingest/live-ingest.service';

type FeedState = 'pre' | 'in' | 'post';

/**
 * The most-advanced match status across the live feeds' states, raised
 * monotonically from `current` — or null when nothing advances it. This is the
 * "most-advanced wins" rule for the status: whichever feed (scoreboard or summary
 * header) is further along sets it, and RANK keeps it one-way so a lagging feed
 * can never pull it back (e.g. a feed still reporting `in` won't un-finish a match).
 */
export function raiseStatus(
  current: MatchStatus,
  states: FeedState[],
): MatchStatus | null {
  let target: MatchStatus | undefined;
  for (const s of states) {
    const t = STATE_TO_STATUS[s];
    if (!target || RANK[t] > RANK[target]) target = t;
  }
  return target && RANK[target] > RANK[current] ? target : null;
}

/**
 * During the half-time break the events feed reaches the 2nd half before the live
 * header does. If any 2nd-half event (period ≥ 2) has landed, the break is over —
 * return the latest such event's minute so the clock resumes WITH the narration
 * instead of sticking on "Intervalo". Null when still genuinely at the break (only
 * 1st-half events so far, or the 2nd-half event carries no minute).
 */
export function resumedClock(events: EspnMatchEvent[]): string | null {
  let latest: EspnMatchEvent | undefined;
  for (const e of events) {
    if (e.period < 2) continue;
    if (
      !latest ||
      e.period > latest.period ||
      (e.period === latest.period && e.clockValue > latest.clockValue)
    )
      latest = e;
  }
  return latest?.minute ?? null;
}
