// Prévia de jogo (estado SCHEDULED): blocos determinísticos montados SÓ com o
// nosso banco — forma recente, retrospecto (H2H), o que está em jogo (tabela do
// grupo) e destaques (artilheiros da competição). Sem LLM, sem API externa.
// Servido por GET /matches/:id/preview; o front busca apenas quando o jogo ainda
// não começou. Ver match-preview.service.ts e a memória match-preview-feature.

/** Time enxuto (escudo) referenciado nos blocos da prévia. */
export interface PreviewTeamRef {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
}

/** Um jogo passado na forma recente de um time (do ponto de vista DELE). */
export interface PreviewFormMatch {
  matchId: string;
  slug: string | null;
  kickoffAt: string;
  competition: string | null;
  home: boolean; // o time jogou em casa neste confronto
  opponent: PreviewTeamRef | null;
  goalsFor: number;
  goalsAgainst: number;
  result: 'W' | 'D' | 'L';
}

export interface PreviewForm {
  matches: PreviewFormMatch[]; // mais recente primeiro
  summary: { w: number; d: number; l: number };
}

/** Um confronto direto passado (com a orientação ORIGINAL casa/fora do jogo). */
export interface PreviewH2HMeeting {
  matchId: string;
  slug: string | null;
  kickoffAt: string;
  competition: string | null;
  homeTeam: PreviewTeamRef | null;
  awayTeam: PreviewTeamRef | null;
  homeScore: number;
  awayScore: number;
}

export interface PreviewH2H {
  total: number;
  homeWins: number; // vitórias do MANDANTE do jogo que está sendo previsto
  awayWins: number; // vitórias do VISITANTE do jogo que está sendo previsto
  draws: number;
  meetings: PreviewH2HMeeting[]; // mais recente primeiro, limitado
}

/** Linha de um time na tabela do grupo/liga. */
export interface PreviewStandingRow {
  position: number;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalDiff: number;
  form: ('W' | 'D' | 'L')[];
}

export interface PreviewStandings {
  stageName: string;
  groupName: string;
  home: PreviewStandingRow | null;
  away: PreviewStandingRow | null;
}

export interface PreviewScorer {
  player: { id: string; name: string; photoUrl: string | null };
  goals: number;
}

export interface PreviewScorers {
  competition: string | null;
  home: PreviewScorer[];
  away: PreviewScorer[];
}

export interface MatchPreview {
  // true quando há confronto de verdade E pelo menos um bloco com dado.
  available: boolean;
  home: PreviewTeamRef | null;
  away: PreviewTeamRef | null;
  form: { home: PreviewForm; away: PreviewForm } | null;
  h2h: PreviewH2H | null;
  standings: PreviewStandings | null;
  scorers: PreviewScorers | null;
}
