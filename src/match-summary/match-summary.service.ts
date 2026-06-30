import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { MonitorService } from '../monitor/monitor.service';
import {
  clockGoesBack,
  EspnCommentaryLine,
  EspnEvent,
  EspnMatchEvent,
  EspnService,
  EspnTeamStats,
  LiveScoreReconciler,
} from '../live-ingest/espn.service';
import { scoreboardDates } from '../live-ingest/live-ingest.service';
import { raiseStatus, resumedClock } from './live-merge';
import { SlotResolverService } from '../structure/slot-resolver.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  espnCode,
  espnExternalId,
  espnSlug,
  mergeExternalIds,
} from '../common/external-ids';

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

// Janela de ingestão. Lineups saem ~1h antes → abrimos cedo (PRE_WINDOW_MIN). O fim
// é ancorado no APITO REAL (finishedAt), não em kickoff+Nh: paramos só POST_FINISH_MIN
// depois do jogo terminar de fato — assim jogo paralisado/atrasado não sai da janela
// antes de acabar. LIVE fica sempre na janela (com uma trava de segurança contra um
// LIVE "zumbi" que nunca finaliza). SCHEDULED entra um pouco antes e também um tempo
// DEPOIS do horário (kickoff pode passar antes do robô detectar o início).
const PRE_WINDOW_MIN = 75;
const SCHEDULED_GRACE_HOURS = 3; // kickoff já passou mas ainda não virou LIVE
const LIVE_MAX_HOURS = 8; // trava: para de insistir num LIVE travado após 8h de kickoff
const POST_FINISH_MIN = 60; // segue ingerindo até 1h DEPOIS do apito real
const FINISH_FALLBACK_HOURS = 3.5; // FINISHED legado sem finishedAt (jogo antigo/seed)
const TICK_CRON = '*/15 * * * * *'; // every 15s (60/15 → even spacing). One tick =
// 1 scoreboard fetch per league (batch baseline) + 1 summary fetch per in-window
// match (lineup + keyEvents + commentary + stats). On a busy fixture day that risks
// ESPN rate-limiting; the shared backoff pauses all calls and fires a webhook alert
// (AlertsService), and the `running` guard skips a tick if the previous one is still
// working, so it can't pile up. 15s also bounds how far the commentary sliding
// window can scroll between ticks (the post-whistle grace keeps catching the tail).

/**
 * THE live-ingestion robot (single writer). Per tick it pulls both ESPN endpoints
 * for every in-window match and persists a merged snapshot to OUR DB, so the front
 * consumes our backend only — never ESPN:
 *  • scoreboard (1 fetch/league) — baseline score/status/clock, cards/fair-play, and
 *    the ESPN event id;
 *  • summary (1 fetch/match) — lineups, keyEvents + commentary, stats, and a live
 *    header that LEADS the scoreboard at the kickoff/half-time/full-time transitions.
 * The two are merged with the most-advanced value winning on the overlap (one-way via
 * RANK/clockGoesBack), so neither pulls the other back and a failed summary fetch still
 * leaves the scoreboard baseline. Replaces the old two-robot setup (LiveIngestService
 * is retired) — being the only writer is what lets the half-time clock resume cleanly.
 * Auto-heals unseen players, and emits the realtime signal on any change.
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
    private readonly resolver: SlotResolverService,
    private readonly notifications: NotificationsService,
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
      this.logger.warn(
        `summary tick failed: ${(e as Error).message.split('\n')[0]}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const now = new Date();
    // In-window matches: LIVE, near-kickoff, or recently finished. Admin-managed
    // matches (autoManaged:false) are NOT filtered out here — they still get their
    // narration/lineup/stats from the feed; ingest() only skips the score/status/
    // clock/cards merge for them (those the admin owns).
    const ms = now.getTime();
    const candidates = await this.prisma.match.findMany({
      where: {
        homeTeamId: { not: null },
        awayTeamId: { not: null },
        OR: [
          // LIVE sempre na janela (jogo paralisado/com muito acréscimo segue sendo
          // ingerido), com trava contra um LIVE que nunca finaliza.
          { status: 'LIVE', kickoffAt: { gte: new Date(ms - LIVE_MAX_HOURS * 3_600_000) } },
          // Pré-jogo (lineups) + folga depois do horário (kickoff pode passar antes do
          // robô flipar pra LIVE).
          {
            status: 'SCHEDULED',
            kickoffAt: {
              gte: new Date(ms - SCHEDULED_GRACE_HOURS * 3_600_000),
              lte: new Date(ms + PRE_WINDOW_MIN * 60_000),
            },
          },
          // Pós-apito: segue ingerindo até 1h DEPOIS do fim REAL (finishedAt), pra
          // pegar VAR tardio, a narração de fechamento e as stats finais.
          { status: 'FINISHED', finishedAt: { gte: new Date(ms - POST_FINISH_MIN * 60_000) } },
          // Fallback p/ FINISHED sem finishedAt (jogos antigos/seed): janela curta por
          // kickoff, pra não ingerir histórico inteiro nem perder o pós-jogo recente.
          {
            status: 'FINISHED',
            finishedAt: null,
            kickoffAt: { gte: new Date(ms - FINISH_FALLBACK_HOURS * 3_600_000) },
          },
        ],
      },
      select: {
        id: true,
        kickoffAt: true,
        externalIds: true,
        homeTeam: { select: { shortName: true, externalIds: true } },
        awayTeam: { select: { shortName: true, externalIds: true } },
        season: { select: { competition: { select: { externalIds: true } } } },
      },
    });
    if (candidates.length === 0) return;

    // One scoreboard fetch per league serves every match of that league — the cheap
    // baseline (score/status/clock/cards + the ESPN event id). The per-match summary
    // fetch then enriches (lineup/events/stats) and LEADS at the transitions.
    const bySlug = new Map<string, typeof candidates>();
    for (const m of candidates) {
      const slug = espnSlug(m.season.competition.externalIds) ?? 'fifa.world';
      (bySlug.get(slug) ?? bySlug.set(slug, []).get(slug)!).push(m);
    }
    for (const [slug, group] of bySlug) {
      let sbEvents: EspnEvent[] = [];
      try {
        sbEvents = await this.espn.fetchScoreboard(
          slug,
          scoreboardDates(group),
        );
      } catch (e) {
        // A scoreboard failure must not sink the pass — fall through with no
        // baseline; each match still gets its summary fetch (and vice-versa).
        this.logger.warn(
          `scoreboard ${slug} failed: ${(e as Error).message.split('\n')[0]}`,
        );
      }
      for (const m of group) {
        try {
          await this.ingest(m.id, this.findScoreboardEvent(sbEvents, m));
        } catch (e) {
          this.logger.warn(
            `summary ingest ${m.id} failed: ${(e as Error).message.split('\n')[0]}`,
          );
        }
      }
    }
  }

  /**
   * Ingest one match from BOTH ESPN endpoints and persist the merged result. The
   * scoreboard event (pre-fetched per league by run(), or resolved here for a
   * standalone call) is the baseline + the only source of cards/fair-play and the
   * ESPN event id; the summary adds lineups/events/stats and a live header that
   * LEADS at the transitions. For the overlap (status/score/clock) the most-advanced
   * value wins, kept one-way by RANK/clockGoesBack — so neither feed pulls the other
   * back, and a summary fetch that fails still leaves the scoreboard baseline applied.
   * Events are append-only and persist regardless of the displayed status, so a late
   * VAR ruling or the closing commentary after the whistle is never dropped.
   * Returns lineup entries written (0 when there's no lineup yet).
   */
  async ingest(matchId: string, sbEvent?: EspnEvent): Promise<number> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        seasonId: true,
        status: true,
        autoManaged: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        homePenalties: true,
        awayPenalties: true,
        homeYellow: true,
        homeRed: true,
        awayYellow: true,
        awayRed: true,
        homeFairPlay: true,
        awayFairPlay: true,
        liveClock: true,
        attendance: true,
        referee: true,
        kickoffAt: true,
        externalIds: true,
        homeTeam: { select: { shortName: true, externalIds: true } },
        awayTeam: { select: { shortName: true, externalIds: true } },
        season: { select: { competition: { select: { externalIds: true } } } },
      },
    });
    if (!match?.homeTeamId || !match.awayTeamId) return 0;

    const slug = espnSlug(match.season.competition.externalIds) ?? 'fifa.world';
    // The ESPN event id: stored first, else from the scoreboard event run() passed,
    // else a standalone lookup. Seed it once known and not yet stored — the job the
    // retired scoreboard robot used to own.
    const storedId = espnExternalId(match.externalIds);
    const eventId =
      storedId ?? sbEvent?.id ?? (await this.resolveEventId(match, slug));

    // POSTPONED/CANCELLED is left to the admin — exclude such a scoreboard event from
    // the merge so it can't auto-finish or zero a match (its id is still usable).
    const sb =
      sbEvent && !/POSTPONED|CANCEL|SUSPEND/i.test(sbEvent.statusName)
        ? sbEvent
        : undefined;

    const full = eventId
      ? await this.espn.fetchSummaryFull(slug, eventId)
      : null;
    if (!full && !sb) return 0; // neither endpoint produced anything this tick

    const live = full?.live ?? null;
    const events = full?.events ?? [];
    const gameInfo = full?.gameInfo ?? null;

    const matchData: Prisma.MatchUpdateInput = {};
    let scoreChanged = false;
    let clockChanged = false;
    let statusChanged = false;
    let cardsChanged = false;
    let penaltiesChanged = false;
    let lineupChanged = false;
    let lineupJustAppeared = false; // 0 → N entries: the lineup was first published
    let eventsChanged = false;

    if (eventId && !storedId)
      matchData.externalIds = mergeExternalIds(match.externalIds, 'espn', {
        id: eventId,
      });

    // Crowd + main referee (ESPN gameInfo). Write once each value appears; never
    // overwrite a known value with a later-missing one, and skip a no-op rewrite.
    if (gameInfo?.attendance != null && gameInfo.attendance !== match.attendance)
      matchData.attendance = gameInfo.attendance;
    if (gameInfo?.referee && gameInfo.referee !== match.referee)
      matchData.referee = gameInfo.referee;

    // ESPN team id → our teamId (event placement + summary score, which keys by id);
    // team abbreviation → scoreboard score/card keys (it keys by code, not id).
    const espnTeamMap = new Map<string, string>();
    const hid = espnExternalId(match.homeTeam?.externalIds ?? null);
    const aid = espnExternalId(match.awayTeam?.externalIds ?? null);
    if (hid) espnTeamMap.set(hid, match.homeTeamId);
    if (aid) espnTeamMap.set(aid, match.awayTeamId);
    const homeCode =
      espnCode(match.homeTeam?.externalIds) ?? match.homeTeam?.shortName;
    const awayCode =
      espnCode(match.awayTeam?.externalIds) ?? match.awayTeam?.shortName;

    // ---------- Lineups (only when the summary fetch succeeded) ----------
    const idByEspn = new Map<string, string>();
    let written = 0;
    if (full) {
      const { teams } = full;
      matchData.homeFormation =
        teams.find((x) => x.homeAway === 'home')?.formation ?? null;
      matchData.awayFormation =
        teams.find((x) => x.homeAway === 'away')?.formation ?? null;

      // Resolve every player first (auto-heal), so sub partners can be linked even
      // when bench-side.
      for (const t of teams) {
        const teamId =
          t.homeAway === 'away' ? match.awayTeamId : match.homeTeamId;
        for (const p of t.players) {
          if (!p.espnId || idByEspn.has(p.espnId)) continue;
          idByEspn.set(
            p.espnId,
            await this.resolvePlayer(p.espnId, p.name, p.position, teamId),
          );
        }
      }

      // Snapshot the existing lineup to detect a change before writing.
      const before = await this.prisma.matchLineupEntry.findMany({
        where: { matchId },
        select: {
          playerId: true,
          isStarter: true,
          subbedIn: true,
          subbedOut: true,
          yellow: true,
          red: true,
          subForPlayerId: true,
        },
      });
      const sig = (rows: typeof before) =>
        rows
          .map(
            (r) =>
              `${r.playerId}:${r.isStarter}:${r.subbedIn}:${r.subbedOut}:${r.yellow}:${r.red}:${r.subForPlayerId ?? ''}`,
          )
          .sort()
          .join('|');
      const beforeSig = sig(before);

      const written_: typeof before = [];
      for (const t of teams) {
        const teamId =
          t.homeAway === 'away' ? match.awayTeamId : match.homeTeamId;
        for (const p of t.players) {
          const playerId = p.espnId ? idByEspn.get(p.espnId) : undefined;
          if (!playerId) continue;
          const subForPlayerId = p.subForEspnId
            ? (idByEspn.get(p.subForEspnId) ?? null)
            : null;
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
          written_.push({
            playerId,
            isStarter: p.starter,
            subbedIn: p.subbedIn,
            subbedOut: p.subbedOut,
            yellow: p.yellow,
            red: p.red,
            subForPlayerId,
          });
        }
      }
      lineupChanged = written > 0 && sig(written_) !== beforeSig;
      lineupJustAppeared = before.length === 0 && written_.length > 0;
    }

    // ---------- Merge (display): status / score / clock / cards ----------
    // Take the most-advanced state of the two feeds; the summary header leads the
    // scoreboard at the boundaries, so prefer it for score/clock, with the scoreboard
    // as the fallback (resilience when the summary fetch failed) and the only source
    // of cards/fair-play. RANK/clockGoesBack keep status/clock one-way. Gated on
    // autoManaged: a match an admin took over keeps its narration/lineup (above) but
    // the admin owns its score/status/clock/cards — the robot doesn't touch those.
    const sbState = sb?.state;
    const smState = live?.state;
    const states = [sbState, smState].filter(
      (s): s is 'pre' | 'in' | 'post' => !!s,
    );
    const target = raiseStatus(match.status, states);
    if (match.autoManaged && target) {
      matchData.status = target;
      statusChanged = true;
      // Carimba o apito real UMA vez (no flip pra FINISHED) — a janela de ingestão
      // pós-jogo conta 1h a partir daqui, não de kickoff+Nh. Assim um jogo paralisado
      // que termina tarde ainda é ingerido até o fim (e o pós-apito).
      if (target === 'FINISHED' && match.status !== 'FINISHED') {
        matchData.finishedAt = new Date();
      }
    }

    if (match.autoManaged && states.some((s) => s === 'in' || s === 'post')) {
      const isFinal =
        sbState === 'post' ||
        smState === 'post' ||
        matchData.status === 'FINISHED';
      const now = Date.now();
      const reportedHome =
        live && hid
          ? live.scores[hid]
          : sb && homeCode
            ? sb.scores[homeCode]
            : undefined;
      const reportedAway =
        live && aid
          ? live.scores[aid]
          : sb && awayCode
            ? sb.scores[awayCode]
            : undefined;
      const nh = this.score.reconcile(
        matchId,
        'home',
        reportedHome,
        match.homeScore,
        isFinal,
        now,
      );
      const na = this.score.reconcile(
        matchId,
        'away',
        reportedAway,
        match.awayScore,
        isFinal,
        now,
      );
      if (nh !== undefined) {
        matchData.homeScore = nh;
        scoreChanged = true;
      }
      if (na !== undefined) {
        matchData.awayScore = na;
        scoreChanged = true;
      }

      // Cards + fair-play: scoreboard only (it ships the aggregates; the standings
      // FIFA disciplinary tiebreak consumes them).
      if (sb && (sbState === 'in' || sbState === 'post')) {
        const hc = homeCode
          ? (sb.cards[homeCode] ?? { yellow: 0, red: 0 })
          : { yellow: 0, red: 0 };
        const ac = awayCode
          ? (sb.cards[awayCode] ?? { yellow: 0, red: 0 })
          : { yellow: 0, red: 0 };
        const hfp = homeCode ? (sb.fairPlay[homeCode] ?? 0) : 0;
        const afp = awayCode ? (sb.fairPlay[awayCode] ?? 0) : 0;
        if (hc.yellow !== match.homeYellow) {
          matchData.homeYellow = hc.yellow;
          cardsChanged = true;
        }
        if (hc.red !== match.homeRed) {
          matchData.homeRed = hc.red;
          cardsChanged = true;
        }
        if (ac.yellow !== match.awayYellow) {
          matchData.awayYellow = ac.yellow;
          cardsChanged = true;
        }
        if (ac.red !== match.awayRed) {
          matchData.awayRed = ac.red;
          cardsChanged = true;
        }
        if (hfp !== match.homeFairPlay) {
          matchData.homeFairPlay = hfp;
          cardsChanged = true;
        }
        if (afp !== match.awayFairPlay) {
          matchData.awayFairPlay = afp;
          cardsChanged = true;
        }
      }

      // Penalty shootout (knockout): ESPN ships shootoutScore per side only once the
      // tie goes to spot-kicks, and it climbs kick-by-kick (monotonic, never drops).
      // We persist it LIVE ('in') as well as at the settle ('post') so the running
      // tally shows during the shootout. The winner is NOT picked from it here — the
      // slot resolver only fires on FINISHED (below), so a live tally can't promote a
      // team early.
      if (sb && (sbState === 'in' || sbState === 'post')) {
        const hp = homeCode ? sb.shootout[homeCode] : undefined;
        const ap = awayCode ? sb.shootout[awayCode] : undefined;
        if (hp !== undefined && ap !== undefined) {
          if (hp !== match.homePenalties) {
            matchData.homePenalties = hp;
            penaltiesChanged = true;
          }
          if (ap !== match.awayPenalties) {
            matchData.awayPenalties = ap;
            penaltiesChanged = true;
          }
        }
      }

      // Clock: prefer the summary header. While LIVE, ESPN freezes the clock at
      // half-time (statusName HALFTIME) → "Intervalo"; but the events feed leads the
      // header out of the break, so once a 2nd-half event has landed (period ≥ 2) show
      // its minute instead of a stuck "Intervalo". `post` nulls the clock. Falls back
      // to the scoreboard when there's no summary header this tick.
      let clock: string | null;
      if (live && (live.state === 'in' || live.state === 'post')) {
        clock =
          live.state === 'in'
            ? /HALFTIME/i.test(live.statusName)
              ? (resumedClock(events) ?? 'Intervalo')
              : live.clock
            : null;
      } else if (sb && (sb.state === 'in' || sb.state === 'post')) {
        clock =
          sb.state === 'in'
            ? /HALFTIME/i.test(sb.statusName)
              ? 'Intervalo'
              : sb.clock
            : null;
      } else {
        clock = match.liveClock;
      }
      if (clock !== match.liveClock && !clockGoesBack(match.liveClock, clock)) {
        matchData.liveClock = clock;
        clockChanged = true;
      }
    }

    if (Object.keys(matchData).length > 0)
      await this.prisma.match.update({
        where: { id: matchId },
        data: matchData,
      });

    // Append-only, independent of the displayed status (decoupled ingestion).
    if (full) {
      eventsChanged = await this.persistEvents(
        matchId,
        events,
        idByEspn,
        espnTeamMap,
      );
      await this.persistStats(
        matchId,
        full.stats,
        match.homeTeamId,
        match.awayTeamId,
      );
      await this.persistCommentary(matchId, full.commentary, espnTeamMap);
    }

    // A flip to FINISHED may decide a group or feed a knockout slot — re-resolve.
    // Also re-resolve when the shootout score lands on an ALREADY-finished match: the
    // settle can arrive a tick after the FINISHED flip, so without this the penalty
    // winner would never be picked. A live ('in') penalty tick must NOT resolve (the
    // match isn't over) — hence the match.status guard, not bare penaltiesChanged.
    if (
      matchData.status === 'FINISHED' ||
      (penaltiesChanged && match.status === 'FINISHED')
    ) {
      try {
        await this.resolver.resolveSeason(match.seasonId);
      } catch (e) {
        this.logger.warn(
          `slot resolve failed for season ${match.seasonId}: ${(e as Error).message}`,
        );
      }
    }

    if (
      lineupChanged ||
      eventsChanged ||
      scoreChanged ||
      clockChanged ||
      statusChanged ||
      cardsChanged ||
      penaltiesChanged
    ) {
      const rooms = [`match:${matchId}`];
      // Everything but a bare clock tick also drives the tournament-wide views.
      if (
        lineupChanged ||
        eventsChanged ||
        scoreChanged ||
        statusChanged ||
        cardsChanged ||
        penaltiesChanged
      )
        rooms.push(`tournament:${match.seasonId}`);
      this.events.emit(...rooms);
    }

    // Lineup just dropped (0 → N) — alert everyone following the match or a team,
    // deep-linking to the match's lineup tab. Idempotent per (user, type, match),
    // so a later lineup edit (subs/cards) never re-alerts. Guarded to matches
    // around kickoff (lineups land ~1h before) so a historical re-ingest/backfill
    // can't blast alerts for old games. Fire-and-forget: a notification hiccup
    // must never break ingestion.
    const lineupFresh = match.kickoffAt.getTime() > Date.now() - 3 * 60 * 60 * 1000;
    if (lineupJustAppeared && lineupFresh && match.homeTeam && match.awayTeam) {
      void this.notifications
        .notifyMatchFollowers(
          'MATCH_LINEUP_PUBLISHED',
          { id: match.id, homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId },
          {
            title: `Escalação: ${match.homeTeam.shortName} x ${match.awayTeam.shortName}`,
            body: 'Saiu a escalação! Veja quem começa em campo.',
            url: `/futebol/agenda/${match.id}/escalacao`,
          },
        )
        .catch((e) =>
          this.logger.warn(`lineup notify falhou (${matchId}): ${(e as Error).message}`),
        );
    }
    return written;
  }

  /** Link a scoreboard event to a match: stored ESPN id first, else by BOTH team
   * codes (a fixture's home+away pair is unique in the league), kickoff as the
   * tiebreaker. Mirrors the retired scoreboard robot's matcher. */
  private findScoreboardEvent(
    events: EspnEvent[],
    m: {
      externalIds: Prisma.JsonValue | null;
      kickoffAt: Date;
      homeTeam: {
        shortName: string;
        externalIds: Prisma.JsonValue | null;
      } | null;
      awayTeam: {
        shortName: string;
        externalIds: Prisma.JsonValue | null;
      } | null;
    },
  ): EspnEvent | undefined {
    if (!events.length) return undefined;
    const extId = espnExternalId(m.externalIds);
    if (extId) {
      const byId = events.find((e) => e.id === extId);
      if (byId) return byId;
    }
    const home = espnCode(m.homeTeam?.externalIds) ?? m.homeTeam?.shortName;
    const away = espnCode(m.awayTeam?.externalIds) ?? m.awayTeam?.shortName;
    if (!home || !away) return undefined;
    const pairMatches = events.filter(
      (e) => e.abbrs.includes(home) && e.abbrs.includes(away),
    );
    if (pairMatches.length <= 1) return pairMatches[0];
    const kickoff = m.kickoffAt.getTime();
    return pairMatches.reduce((best, e) =>
      Math.abs(new Date(e.dateIso).getTime() - kickoff) <
      Math.abs(new Date(best.dateIso).getTime() - kickoff)
        ? e
        : best,
    );
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
      const teamId = ev.espnTeamId
        ? (espnTeamMap.get(ev.espnTeamId) ?? null)
        : null;
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
        goalY: ev.goalY ?? null,
        fieldX: ev.fieldX ?? null,
        fieldY: ev.fieldY ?? null,
      };
      await this.prisma.matchEvent.upsert({
        where: { espnEventId: ev.espnId },
        update: data,
        create: { matchId, espnEventId: ev.espnId, ...data },
      });
      if (!seen.has(ev.espnId)) changed = true;
    }

    // Reconcile against the authoritative keyEvents feed. ESPN walks back a goal
    // ruled out by VAR (and the VAR notice itself) by DROPPING it from keyEvents
    // — but our writes are upsert-only, so the stale row lingers (a disallowed
    // goal stays green; the VAR notice duplicates the commentary one). keyEvents
    // is the full match list (not a sliding window like commentary), so a
    // keyEvent-sourced GOAL/VAR no longer in it was retracted → delete it. A
    // retracted VAR also leaves its commentary twin (cmt:<id>), so drop that too.
    // Scoped to GOAL/VAR (the only types VAR revises) to bound the blast radius,
    // and only when we actually received keyEvents this tick.
    const keyIds = new Set(
      events
        .filter((e) => e.espnId && !e.espnId.startsWith('cmt:'))
        .map((e) => e.espnId as string),
    );
    if (keyIds.size > 0) {
      const persisted = await this.prisma.matchEvent.findMany({
        where: {
          matchId,
          type: { in: ['GOAL', 'PENALTY_GOAL', 'OWN_GOAL', 'VAR'] },
          NOT: { espnEventId: { startsWith: 'cmt:' } },
        },
        select: { id: true, espnEventId: true, type: true },
      });
      const stale = persisted.filter(
        (e) => e.espnEventId && !keyIds.has(e.espnEventId),
      );
      if (stale.length > 0) {
        const cmtTwins = stale
          .filter((e) => e.type === 'VAR')
          .map((e) => `cmt:${e.espnEventId}`);
        const orphans: Prisma.MatchEventWhereInput[] = [
          { id: { in: stale.map((e) => e.id) } },
        ];
        if (cmtTwins.length) orphans.push({ espnEventId: { in: cmtTwins } });
        await this.prisma.matchEvent.deleteMany({
          where: { matchId, OR: orphans },
        });
        changed = true;
      }
    }
    return changed;
  }

  /** Persist the full human commentary prose (idempotent by espnId). ESPN serves a
   * sliding window live, so upsert-by-id accumulates the complete feed across ticks.
   * Stored verbatim (not language-stripped like the timeline) — it's the rich source
   * the news generator reads via facts.narracaoEspn. teamId resolved from the ESPN
   * header map; left null for play-less narrative lines (kickoff, added time, …). */
  private async persistCommentary(
    matchId: string,
    lines: EspnCommentaryLine[],
    espnTeamMap: Map<string, string>,
  ): Promise<void> {
    if (!lines.length) return;
    for (const l of lines) {
      const teamId = l.espnTeamId ? (espnTeamMap.get(l.espnTeamId) ?? null) : null;
      const data = {
        teamId,
        sequence: l.sequence,
        type: l.type,
        minute: l.minute,
        clockValue: l.clockValue,
        period: l.period,
        text: l.text,
      };
      await this.prisma.matchCommentary.upsert({
        where: { espnId: l.espnId },
        update: data,
        create: { matchId, espnId: l.espnId, ...data },
      });
    }
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
    const p = await this.prisma.player.findUnique({
      where: { espnId },
      select: { id: true },
    });
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
          create: {
            matchId,
            teamId,
            key: s.key,
            value: s.value,
            label: meta.label,
            order: meta.order,
          },
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
    const existing = await this.prisma.player.findUnique({
      where: { espnId },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.player.create({
      data: { espnId, teamId, name, position, photoUrl: headshot(espnId) },
      select: { id: true },
    });
    return created.id;
  }

  private async resolveEventId(
    match: {
      kickoffAt: Date;
      homeTeam: { externalIds: unknown } | null;
      awayTeam: { externalIds: unknown } | null;
    },
    slug: string,
  ): Promise<string | undefined> {
    const home = espnCode(match.homeTeam?.externalIds ?? null);
    const away = espnCode(match.awayTeam?.externalIds ?? null);
    if (!home || !away) return undefined;
    const day = match.kickoffAt.toISOString().slice(0, 10).replace(/-/g, '');
    const events = await this.espn.fetchScoreboard(slug, day);
    return events.find((e) => e.abbrs.includes(home) && e.abbrs.includes(away))
      ?.id;
  }
}
