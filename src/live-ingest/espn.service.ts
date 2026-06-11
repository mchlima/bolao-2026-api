import { Injectable, Logger } from '@nestjs/common';

/** A parsed fixture from the ESPN public scoreboard. */
export interface EspnEvent {
  id: string;
  dateIso: string;
  state: 'pre' | 'in' | 'post';
  statusName: string; // e.g. STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL, STATUS_POSTPONED
  /** Goal count keyed by team abbreviation (matches our Team.shortName). */
  scores: Record<string, number>;
  abbrs: string[];
}

const SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

/**
 * Reads the FIFA World Cup scoreboard from ESPN's public (unofficial) site API.
 * No key required. Returns [] on any failure — the caller must degrade gracefully
 * (manual control still works). Easy to swap for a keyed provider later.
 */
@Injectable()
export class EspnService {
  private readonly logger = new Logger(EspnService.name);

  async fetchScoreboard(): Promise<EspnEvent[]> {
    let res: Response;
    try {
      res = await fetch(SCOREBOARD_URL, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      this.logger.warn(`ESPN fetch failed: ${(e as Error).message}`);
      return [];
    }
    if (!res.ok) {
      this.logger.warn(`ESPN responded ${res.status}`);
      return [];
    }
    const data = (await res.json()) as EspnScoreboard;
    const out: EspnEvent[] = [];
    for (const ev of data.events ?? []) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const scores: Record<string, number> = {};
      for (const c of comp.competitors ?? []) {
        const abbr = c.team?.abbreviation;
        if (!abbr) continue;
        scores[abbr] = Number.parseInt(c.score ?? '0', 10) || 0;
      }
      out.push({
        id: String(ev.id),
        dateIso: ev.date,
        state: ev.status?.type?.state ?? 'pre',
        statusName: ev.status?.type?.name ?? '',
        scores,
        abbrs: Object.keys(scores),
      });
    }
    return out;
  }
}

// Minimal shape of the bits we read from ESPN's response.
interface EspnScoreboard {
  events?: Array<{
    id: string | number;
    date: string;
    status?: { type?: { state?: 'pre' | 'in' | 'post'; name?: string } };
    competitions?: Array<{
      competitors?: Array<{ score?: string; team?: { abbreviation?: string } }>;
    }>;
  }>;
}
