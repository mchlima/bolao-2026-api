import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { MonitorService } from '../monitor/monitor.service';
import {
  clockGoesBack,
  EspnMatchEvent,
  EspnService,
  EspnTeamStats,
  LiveScoreReconciler,
} from '../live-ingest/espn.service';
import { espnCode, espnExternalId, espnSlug } from '../common/external-ids';

const headshot = (espnId: string) =>
  `https://a.espncdn.com/i/headshots/soccer/players/full/${espnId}.png`;

// Curated boxscore stats to persist (ESPN name → pt label + display order).
const STAT_MAP: Record<string, { label: string; order: number }> = {
  possessionPct: { label: 'Posse de bola', order: 1 },
  totalShots: { label: 'Finalizações', order: 2 },
  shotsOnTarget: { label: 'No alvo', order: 3 },
  wonCorners: { label: 'Escanteios', order: 4 },
  foulsCommitted: { label: 'Faltas', order: 5 },
  offsides: { label: 'Impedimentos', order: 6 },
  yellowCards: { label: 'Cartões amarelos', order: 7 },
  redCards: { label: 'Cartões vermelhos', order: 8 },
  saves: { label: 'Defesas', order: 9 },
  accuratePasses: { label: 'Passes certos', order: 10 },
  totalPasses: { label: 'Passes', order: 11 },
};

// Lineups publish ~1h before kickoff, so open the summary window earlier than the
// score robot's; keep ingesting until a few hours after kickoff.
const PRE_WINDOW_MIN = 75;
const POST_WINDOW_HOURS = 3;
const TICK_CRON = '*/10 * * * * *'; // every 10s — fastest narration. Heaviest
// fetch (lineup + events + commentary + stats per in-window match): on a busy
// fixture day this risks ESPN rate-limiting; the shared backoff pauses all calls
// and now fires a webhook alert (AlertsService), and the `running` guard skips a
// tick if the previous one is still working, so it can't pile up.

/**
 * Reads the ESPN match summary (lineups, and later events/stats) and PERSISTS it
 * to our DB, so the front consumes our backend only — never ESPN. Runs in the
 * pre-match → post-match window, upserts any unseen player on the fly
 * (auto-heal), and emits the realtime signal when the lineup changed.
 */
@Injectable()
export class MatchSummaryService {
  private readonly logger = new Logger(MatchSummaryService.name);
  private running = false;
  private readonly score = new LiveScoreReconciler();

  constructor(
    private readonly prisma: PrismaService,
    private readonly espn: EspnService,
    private readonly events: EventsService,
    private readonly monitor: MonitorService,
  ) {}

  @Cron(TICK_CRON)
  async tick(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
      this.monitor.beat('match-summary');
    } catch (e) {
      this.logger.warn(`summary tick failed: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const now = new Date();
    const matches = await this.prisma.match.findMany({
      where: {
        homeTeamId: { not: null },
        awayTeamId: { not: null },
        OR: [
          { status: 'LIVE' },
          {
            status: { in: ['SCHEDULED', 'FINISHED'] },
            kickoffAt: {
              gte: new Date(now.getTime() - POST_WINDOW_HOURS * 3_600_000),
              lte: new Date(now.getTime() + PRE_WINDOW_MIN * 60_000),
            },
          },
        ],
      },
      select: { id: true },
    });
    for (const m of matches) {
      try {
        await this.ingest(m.id);
      } catch (e) {
        this.logger.warn(`summary ingest ${m.id} failed: ${(e as Error).message.split('\n')[0]}`);
      }
    }
  }

  /**
   * Fetch the ESPN summary for one match and persist its lineup + formations.
   * Auto-heals players. Emits `match:`/`tournament:` when the lineup changed.
   * Returns the number of entries written (0 when no lineup yet).
   */
  async ingest(matchId: string): Promise<number> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        seasonId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        liveClock: true,
        kickoffAt: true,
        externalIds: true,
        homeTeam: { select: { externalIds: true } },
        awayTeam: { select: { externalIds: true } },
        season: { select: { competition: { select: { externalIds: true } } } },
      },
    });
    if (!match?.homeTeamId || !match.awayTeamId) return 0;

    const slug = espnSlug(match.season.competition.externalIds) ?? 'fifa.world';
    const eventId =
      espnExternalId(match.externalIds) ?? (await this.resolveEventId(match, slug));
    if (!eventId) return 0;

    const full = await this.espn.fetchSummaryFull(slug, eventId);
    if (!full) return 0;
    const { teams, events, stats, live } = full;

    // Resolve every player first (auto-heal), building espnId → our playerId, so
    // sub partners can be linked even when bench-side.
    const idByEspn = new Map<string, string>();
    for (const t of teams) {
      const teamId = t.homeAway === 'away' ? match.awayTeamId : match.homeTeamId;
      for (const p of t.players) {
        if (!p.espnId || idByEspn.has(p.espnId)) continue;
        idByEspn.set(p.espnId, await this.resolvePlayer(p.espnId, p.name, p.position, teamId));
      }
    }

    // Snapshot the existing lineup to detect a change before writing.
    const before = await this.prisma.matchLineupEntry.findMany({
      where: { matchId },
      select: { playerId: true, isStarter: true, subbedIn: true, subbedOut: true, yellow: true, red: true, subForPlayerId: true },
    });
    const sig = (rows: typeof before) =>
      rows
        .map((r) => `${r.playerId}:${r.isStarter}:${r.subbedIn}:${r.subbedOut}:${r.yellow}:${r.red}:${r.subForPlayerId ?? ''}`)
        .sort()
        .join('|');
    const beforeSig = sig(before);

    let written = 0;
    const written_: typeof before = [];
    for (const t of teams) {
      const teamId = t.homeAway === 'away' ? match.awayTeamId : match.homeTeamId;
      for (const p of t.players) {
        const playerId = p.espnId ? idByEspn.get(p.espnId) : undefined;
        if (!playerId) continue;
        const subForPlayerId = p.subForEspnId ? idByEspn.get(p.subForEspnId) ?? null : null;
        const data = {
          teamId,
          isStarter: p.starter,
          jersey: p.jersey,
          position: p.position,
          formationPlace: p.formationPlace,
          subbedIn: p.subbedIn,
          subbedOut: p.subbedOut,
          subForPlayerId,
          yellow: p.yellow,
          red: p.red,
        };
        await this.prisma.matchLineupEntry.upsert({
          where: { matchId_playerId: { matchId, playerId } },
          update: data,
          create: { matchId, playerId, ...data },
        });
        written++;
        written_.push({ playerId, isStarter: p.starter, subbedIn: p.subbedIn, subbedOut: p.subbedOut, yellow: p.yellow, red: p.red, subForPlayerId });
      }
    }

    const home = teams.find((x) => x.homeAway === 'home');
    const away = teams.find((x) => x.homeAway === 'away');

    // ESPN team id → our teamId, for placing events on a side (and the score).
    const espnTeamMap = new Map<string, string>();
    const hid = espnExternalId(match.homeTeam?.externalIds ?? null);
    const aid = espnExternalId(match.awayTeam?.externalIds ?? null);
    if (hid) espnTeamMap.set(hid, match.homeTeamId);
    if (aid) espnTeamMap.set(aid, match.awayTeamId);

    // Formations + the live score and clock — read from the SAME summary snapshot
    // as the events, so a goal and the score it produces land together in one
    // write/emit (the scoreboard robot's feed can lag this one, which is why a
    // goal could appear in the timeline before the score moved). The score moves
    // up at once but a drop is confirmed by persistence (LiveScoreReconciler — a
    // VAR annulment lowers it, a lagging feed can't), and the clock never regresses
    // (clockGoesBack), so a momentary disagreement between the feeds can't flip
    // either back.
    const matchData: Prisma.MatchUpdateInput = {
      homeFormation: home?.formation ?? null,
      awayFormation: away?.formation ?? null,
    };
    let scoreChanged = false;
    let clockChanged = false;
    if (live && (live.state === 'in' || live.state === 'post')) {
      const isFinal = live.state === 'post';
      const now = Date.now();
      const hs = hid ? live.scores[hid] : undefined;
      const as = aid ? live.scores[aid] : undefined;
      const nh = this.score.reconcile(matchId, 'home', hs, match.homeScore, isFinal, now);
      const na = this.score.reconcile(matchId, 'away', as, match.awayScore, isFinal, now);
      if (nh !== undefined) {
        matchData.homeScore = nh;
        scoreChanged = true;
      }
      if (na !== undefined) {
        matchData.awayScore = na;
        scoreChanged = true;
      }
      const clock =
        live.state === 'in' ? (/HALFTIME/i.test(live.statusName) ? 'Intervalo' : live.clock) : null;
      if (clock !== match.liveClock && !clockGoesBack(match.liveClock, clock)) {
        matchData.liveClock = clock;
        clockChanged = true;
      }
    }
    await this.prisma.match.update({ where: { id: matchId }, data: matchData });

    const eventsChanged = await this.persistEvents(matchId, events, idByEspn, espnTeamMap);
    await this.persistStats(matchId, stats, match.homeTeamId, match.awayTeamId);

    const lineupChanged = written > 0 && sig(written_) !== beforeSig;
    if (lineupChanged || eventsChanged || scoreChanged || clockChanged) {
      const rooms = [`match:${matchId}`];
      // Score/lineup/events drive the tournament-wide views too; a bare clock tick
      // only needs the match view to refetch.
      if (lineupChanged || eventsChanged || scoreChanged) rooms.push(`tournament:${match.seasonId}`);
      this.events.emit(...rooms);
    }
    return written;
  }

  /** Upsert timeline events (idempotent by espnEventId). Returns true if a new
   * event appeared (so the caller emits). Players/teams resolved to our records. */
  private async persistEvents(
    matchId: string,
    events: EspnMatchEvent[],
    idByEspn: Map<string, string>,
    espnTeamMap: Map<string, string>,
  ): Promise<boolean> {
    if (!events.length) return false;
    const before = await this.prisma.matchEvent.findMany({
      where: { matchId },
      select: { espnEventId: true },
    });
    const seen = new Set(before.map((e) => e.espnEventId));
    // Cache name→playerId within this ingest — a player commits many fouls/shots,
    // so this avoids re-querying the same name dozens of times per tick.
    const nameCache = new Map<string, string | null>();
    let changed = false;
    for (const ev of events) {
      if (!ev.espnId) continue;
      const teamId = ev.espnTeamId ? espnTeamMap.get(ev.espnTeamId) ?? null : null;
      // Prefer the athlete id; fall back to name+team for feeds that name the
      // player without an id (the commentary feed — fouls, shots, VAR, …).
      const playerId =
        (await this.eventPlayer(ev.playerEspnId, idByEspn)) ??
        (await this.playerByName(ev.playerName, teamId, nameCache));
      const relatedPlayerId =
        (await this.eventPlayer(ev.relatedEspnId, idByEspn)) ??
        (await this.playerByName(ev.relatedName, teamId, nameCache));
      const data = {
        teamId,
        type: ev.type,
        detail: ev.detail,
        minute: ev.minute,
        clockValue: ev.clockValue,
        period: ev.period,
        playerId,
        relatedPlayerId,
        text: ev.text,
      };
      await this.prisma.matchEvent.upsert({
        where: { espnEventId: ev.espnId },
        update: data,
        create: { matchId, espnEventId: ev.espnId, ...data },
      });
      if (!seen.has(ev.espnId)) changed = true;
    }
    return changed;
  }

  /** Resolve a player by name within a team — the fallback for feeds (commentary)
   * that give a name but no athlete id. Scoped to the team to avoid a namesake on
   * the other side; returns null when absent (event just shows without a player). */
  private async playerByName(
    name: string | null | undefined,
    teamId: string | null,
    cache?: Map<string, string | null>,
  ): Promise<string | null> {
    if (!name || !teamId) return null;
    const key = `${teamId}:${name}`;
    if (cache?.has(key)) return cache.get(key)!;
    const p = await this.prisma.player.findFirst({
      where: { name, teamId },
      select: { id: true },
    });
    const id = p?.id ?? null;
    cache?.set(key, id);
    return id;
  }

  private async eventPlayer(
    espnId: string | null,
    idByEspn: Map<string, string>,
  ): Promise<string | null> {
    if (!espnId) return null;
    const inLineup = idByEspn.get(espnId);
    if (inLineup) return inLineup;
    const p = await this.prisma.player.findUnique({ where: { espnId }, select: { id: true } });
    return p?.id ?? null;
  }

  /** Upsert the curated per-team boxscore stats (idempotent by match+team+key). */
  private async persistStats(
    matchId: string,
    stats: EspnTeamStats[],
    homeTeamId: string,
    awayTeamId: string,
  ): Promise<void> {
    for (const t of stats) {
      const teamId = t.homeAway === 'away' ? awayTeamId : homeTeamId;
      for (const s of t.stats) {
        const meta = STAT_MAP[s.key];
        if (!meta) continue;
        await this.prisma.matchStat.upsert({
          where: { matchId_teamId_key: { matchId, teamId, key: s.key } },
          update: { value: s.value, label: meta.label, order: meta.order },
          create: { matchId, teamId, key: s.key, value: s.value, label: meta.label, order: meta.order },
        });
      }
    }
  }

  private async resolvePlayer(
    espnId: string,
    name: string,
    position: string | null,
    teamId: string,
  ): Promise<string> {
    const existing = await this.prisma.player.findUnique({ where: { espnId }, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.player.create({
      data: { espnId, teamId, name, position, photoUrl: headshot(espnId) },
      select: { id: true },
    });
    return created.id;
  }

  private async resolveEventId(
    match: { kickoffAt: Date; homeTeam: { externalIds: unknown } | null; awayTeam: { externalIds: unknown } | null },
    slug: string,
  ): Promise<string | undefined> {
    const home = espnCode(match.homeTeam?.externalIds ?? null);
    const away = espnCode(match.awayTeam?.externalIds ?? null);
    if (!home || !away) return undefined;
    const day = match.kickoffAt.toISOString().slice(0, 10).replace(/-/g, '');
    const events = await this.espn.fetchScoreboard(slug, day);
    return events.find((e) => e.abbrs.includes(home) && e.abbrs.includes(away))?.id;
  }
}
