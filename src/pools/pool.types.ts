import { PoolMemberRole, PoolVisibility } from '@prisma/client';
import { ScoreTier } from '../scoring/scoring.service';

export interface TournamentSummary {
  id: string;
  name: string;
  logoUrl: string | null;
  status: string;
}

export interface PoolMemberView {
  user: { id: string; name: string };
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
  visibility: PoolVisibility;
  tournament: TournamentSummary;
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
  visibility: PoolVisibility;
  tournament: TournamentSummary;
  memberCount: number;
  alreadyMember: boolean;
}

export interface PoolMatchPredictionEntry {
  user: { id: string; name: string };
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
