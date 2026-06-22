import type { SeasonStatus } from '@prisma/client';
import type { RankingEntry } from '../rankings/rankings.service';

/** The current user's row + the size of the field, for one ranking scope. */
export interface MyStanding {
  me: RankingEntry | null;
  total: number;
}

export interface MyPoolStanding extends MyStanding {
  poolId: string;
  name: string;
}

/** A tournament the user plays: its GERAL (season-wide) standing + their pools. */
export interface MyStandingsTournament {
  id: string;
  slug: string | null;
  name: string;
  status: SeasonStatus;
  general: MyStanding;
  pools: MyPoolStanding[];
}

export interface MyStandingsResponse {
  tournaments: MyStandingsTournament[];
}
