// Standings (classificação) shapes — the P/J/V/E/D/GP/GC/SG/% league/group table.
// Computed (never stored) by StandingsService from FINISHED matches.

export interface StandingsTeam {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  countryCode: string | null;
}

export interface StandingsRow {
  position: number;
  team: StandingsTeam;
  played: number; // J — jogos
  wins: number; // V — vitórias
  draws: number; // E — empates
  losses: number; // D — derrotas
  goalsFor: number; // GP — gols pró
  goalsAgainst: number; // GC — gols contra
  goalDiff: number; // SG — saldo de gols
  points: number; // P — pontos
  pct: number; // % — aproveitamento (points / (played*3) * 100, 1 decimal)
  form: ('W' | 'D' | 'L')[]; // last 5 results, oldest → newest
  live: boolean; // true while this team has a match in progress (provisional row)
}

export interface GroupStandings {
  groupId: string;
  groupName: string;
  rows: StandingsRow[];
}

export interface StageStandings {
  stageId: string;
  stageName: string;
  format: 'LEAGUE' | 'GROUP';
  groups: GroupStandings[];
}
