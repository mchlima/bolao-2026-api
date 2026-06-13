import { Injectable, Logger } from '@nestjs/common';

/** A parsed fixture from the ESPN public scoreboard. */
export interface EspnEvent {
  id: string;
  dateIso: string;
  state: 'pre' | 'in' | 'post';
  statusName: string; // e.g. STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL, STATUS_POSTPONED
  /** Goal count keyed by team abbreviation (matches our Team.espnAbbr). */
  scores: Record<string, number>;
  abbrs: string[];
  /** Raw card counts keyed by team abbreviation. */
  cards: Record<string, { yellow: number; red: number }>;
  /** FIFA fair-play points (≤ 0) keyed by team abbreviation — the disciplinary
   * tiebreak input, computed per-player from the event's card sequence. */
  fairPlay: Record<string, number>;
}

/**
 * FIFA fair-play points for ONE player in ONE match, from their card counts.
 * Single yellow −1; second yellow (sending off) −3; direct red −4. ESPN encodes
 * a second booking as a red event with no distinct type, so a player who has
 * BOTH a yellow and a red is treated as a second yellow (−3); the rare
 * yellow + straight-red (−5) is indistinguishable in the feed and left to admin
 * override. See architecture/espn-fairplay-spike.md.
 */
export function playerFairPlay(yellows: number, reds: number): number {
  if (reds === 0) return yellows >= 2 ? -3 : yellows === 1 ? -1 : 0;
  return yellows >= 1 ? -3 : -4;
}

const DEFAULT_LEAGUE_SLUG = 'fifa.world';
const scoreboardUrl = (slug: string): string =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`;

/**
 * Reads a league's scoreboard from ESPN's public (unofficial) site API. The
 * league slug (e.g. "fifa.world", "bra.1", "conmebol.libertadores") comes from
 * the Competition, so one engine serves every tournament. No key required.
 * Returns [] on any failure — the caller must degrade gracefully (manual control
 * still works). Easy to swap for a keyed provider later.
 */
@Injectable()
export class EspnService {
  private readonly logger = new Logger(EspnService.name);

  async fetchScoreboard(
    slug: string = DEFAULT_LEAGUE_SLUG,
  ): Promise<EspnEvent[]> {
    let res: Response;
    try {
      res = await fetch(scoreboardUrl(slug), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      this.logger.warn(`ESPN fetch failed (${slug}): ${(e as Error).message}`);
      return [];
    }
    if (!res.ok) {
      this.logger.warn(`ESPN responded ${res.status} for ${slug}`);
      return [];
    }
    const data = (await res.json()) as EspnScoreboard;
    const out: EspnEvent[] = [];
    for (const ev of data.events ?? []) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const scores: Record<string, number> = {};
      const idToAbbr: Record<string, string> = {};
      for (const c of comp.competitors ?? []) {
        const abbr = c.team?.abbreviation;
        if (!abbr) continue;
        scores[abbr] = Number.parseInt(c.score ?? '0', 10) || 0;
        if (c.team?.id) idToAbbr[String(c.team.id)] = abbr;
      }
      const { cards, fairPlay } = parseDiscipline(comp.details ?? [], idToAbbr);
      out.push({
        id: String(ev.id),
        dateIso: ev.date,
        state: ev.status?.type?.state ?? 'pre',
        statusName: ev.status?.type?.name ?? '',
        scores,
        abbrs: Object.keys(scores),
        cards,
        fairPlay,
      });
    }
    return out;
  }
}

/**
 * Tally cards (raw counts) and fair-play points (per FIFA, summed per team) from
 * a competition's `details[]` card events. Cards carry the ESPN team id, so we
 * map id → abbreviation. A second yellow is inferred per athlete: a player with
 * both a yellow and a red is scored as a second booking (see playerFairPlay).
 */
export function parseDiscipline(
  details: EspnDetail[],
  idToAbbr: Record<string, string>,
): {
  cards: Record<string, { yellow: number; red: number }>;
  fairPlay: Record<string, number>;
} {
  const cards: Record<string, { yellow: number; red: number }> = {};
  // Per athlete: their team abbr + yellow/red counts within this match.
  const perAthlete = new Map<string, { abbr: string; y: number; r: number }>();
  details.forEach((d, i) => {
    if (!d.yellowCard && !d.redCard) return;
    const abbr = d.team?.id != null ? idToAbbr[String(d.team.id)] : undefined;
    if (!abbr) return;
    const c = (cards[abbr] ??= { yellow: 0, red: 0 });
    if (d.yellowCard) c.yellow++;
    if (d.redCard) c.red++;
    const athId = d.athletesInvolved?.[0]?.id;
    // Unattributed cards still count raw, but fair-play needs a player to infer a
    // second yellow — fall back to the detail index so a lone card still scores.
    const key = athId != null ? `${abbr}:${athId}` : `${abbr}:#${i}`;
    const a = perAthlete.get(key) ?? { abbr, y: 0, r: 0 };
    if (d.yellowCard) a.y++;
    if (d.redCard) a.r++;
    perAthlete.set(key, a);
  });
  const fairPlay: Record<string, number> = {};
  for (const abbr of Object.keys(cards)) fairPlay[abbr] = 0;
  for (const { abbr, y, r } of perAthlete.values()) {
    fairPlay[abbr] = (fairPlay[abbr] ?? 0) + playerFairPlay(y, r);
  }
  return { cards, fairPlay };
}

// Minimal shape of the bits we read from ESPN's response.
interface EspnDetail {
  yellowCard?: boolean;
  redCard?: boolean;
  team?: { id?: string | number };
  athletesInvolved?: Array<{ id?: string | number }>;
}
interface EspnScoreboard {
  events?: Array<{
    id: string | number;
    date: string;
    status?: { type?: { state?: 'pre' | 'in' | 'post'; name?: string } };
    competitions?: Array<{
      competitors?: Array<{
        score?: string;
        team?: { id?: string | number; abbreviation?: string };
      }>;
      details?: EspnDetail[];
    }>;
  }>;
}
