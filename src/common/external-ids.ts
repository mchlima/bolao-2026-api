import { Prisma } from '@prisma/client';

/**
 * Unified external-provider references, stored as one JSON column (`externalIds`)
 * on Team / Match / Competition — replacing the old scattered columns. One blob
 * per entity holds every provider we know, so adding a provider never adds a
 * column. Per-provider keys are sparse (only what that provider gives us):
 *   Team.espn        { id, code }   code = ESPN abbreviation (live robot match key)
 *   Team.ge          { id, code }   code = GE sigla
 *   Match.espn       { id }         id   = ESPN event id (robot fixture link)
 *   Match.ge         { id }         id   = GE game id
 *   Competition.espn { slug }       slug = ESPN league slug the robot polls
 *   Competition.ge   { championshipId, phase }
 */
export type ExternalIds = {
  espn?: { id?: string; code?: string; slug?: string };
  ge?: {
    id?: string;
    code?: string;
    championshipId?: string;
    phase?: string;
  };
};

type Json = Prisma.JsonValue | null | undefined;

/** Safe read: coerces the stored JSON value to ExternalIds ({} when absent/odd). */
export function readExternalIds(v: Json): ExternalIds {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as ExternalIds) : {};
}

/** ESPN abbreviation (the live robot's score match key). */
export function espnCode(v: Json): string | undefined {
  return readExternalIds(v).espn?.code;
}
/** ESPN external id (event id for a Match, team id for a Team). */
export function espnExternalId(v: Json): string | undefined {
  return readExternalIds(v).espn?.id;
}
/** ESPN league slug (Competition). */
export function espnSlug(v: Json): string | undefined {
  return readExternalIds(v).espn?.slug;
}

/**
 * Merge a provider patch into an entity's existing externalIds, returning a
 * value writable by Prisma. Existing keys of other providers are preserved.
 */
export function mergeExternalIds(
  current: Json,
  provider: 'espn' | 'ge',
  patch: Record<string, string | undefined>,
): Prisma.InputJsonValue {
  const cur = readExternalIds(current);
  return {
    ...cur,
    [provider]: { ...(cur[provider] ?? {}), ...patch },
  } as Prisma.InputJsonValue;
}
