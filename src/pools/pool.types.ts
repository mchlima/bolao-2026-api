import { PoolMemberRole, PoolRunStatus, PoolVisibility } from '@prisma/client';
import { ScoreTier } from '../scoring/scoring.service';

export interface TournamentSummary {
  id: string;
  name: string;
  logoUrl: string | null;
  status: string;
  // Competição-dona (p/ o front linkar o hub por /futebol/campeonato/:urlSlug).
  competition?: { name: string; urlSlug: string | null } | null;
}

/** A pool's "temporada" — the season it disputes within a time window. */
export interface PoolRunView {
  id: string;
  label: string | null;
  status: PoolRunStatus; // DRAFT | ACTIVE | ENDED
  startAt: Date | null;
  endAt: Date | null;
  order: number;
}

/** A past/current temporada with its winner (for the "temporadas" history). */
export interface PoolRunWithChampion extends PoolRunView {
  tournament: TournamentSummary;
  champion: { user: { id: string; name: string; avatarUrl: string | null }; points: number } | null;
  totalParticipants: number;
}

export interface PoolMemberView {
  user: { id: string; name: string; avatarUrl: string | null };
  role: PoolMemberRole;
  joinedAt: Date;
}

export interface PoolInviteView {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
}

/** Compact pool entry for the "my pools" list. */
export interface PoolSummary {
  id: string;
  name: string;
  description: string | null; // internal (members)
  inviteDescription: string | null; // shown on the invite page
  visibility: PoolVisibility;
  tournament: TournamentSummary | null; // a temporada atual define o torneio; null se o bolão ainda não tem temporada
  currentRun: PoolRunView | null; // the open (or latest) temporada
  myRole: PoolMemberRole;
  memberCount: number;
  createdAt: Date;
}

/** Full pool detail for a member. Invites are present only for owner/admin. */
export interface PoolDetail extends PoolSummary {
  members: PoolMemberView[];
  invites?: PoolInviteView[];
}

/** What an invite code resolves to — shown before the user commits to joining. */
export interface JoinPreview {
  id: string;
  name: string;
  description: string | null;
  visibility: PoolVisibility;
  tournament: TournamentSummary | null; // null se o bolão ainda não tem temporada
  memberCount: number;
  alreadyMember: boolean;
}

export interface PoolMatchPredictionEntry {
  user: { id: string; name: string; avatarUrl: string | null };
  prediction: { home: number; away: number };
  points?: number; // present once the match is scored (LIVE/FINISHED)
  tier?: ScoreTier;
}

/**
 * Members' predictions for one match in a pool. `revealed` is false until the
 * match starts (kickoff) — before that, only the requester's OWN prediction is
 * returned, so nobody can peek at others' guesses before betting (same fairness
 * rule as the prediction lock).
 */
export interface PoolMatchPredictionsView {
  revealed: boolean;
  entries: PoolMatchPredictionEntry[];
}
