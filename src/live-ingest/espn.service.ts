import { Injectable, Logger } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service';
import { normalizeRefereeName } from '../common/referee';

/** A parsed fixture from the ESPN public scoreboard. */
export interface EspnEvent {
  id: string;
  dateIso: string;
  state: 'pre' | 'in' | 'post';
  statusName: string; // e.g. STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL, STATUS_POSTPONED
  clock: string | null; // live match clock, e.g. "49'" / "90'+5'" (null when absent)
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

// ESPN encodes a roster player's sub status as { didSub: boolean } — an OBJECT,
// so `!!p.subbedIn` is ALWAYS true (any object is truthy), which flagged every
// player as subbed in AND out (every starter ↓, every reserve ↑). Read .didSub
// explicitly; tolerate a bare boolean too, in case the shape ever changes.
function didSub(v: boolean | { didSub?: boolean } | undefined): boolean {
  return typeof v === 'object' && v !== null ? !!v.didSub : !!v;
}

const DEFAULT_LEAGUE_SLUG = 'fifa.world';
// `dates` is YYYYMMDD or a YYYYMMDD-YYYYMMDD range. Without it, ESPN returns only
// its own current "day", which lags real UTC time (it stays on the last day that
// had matches), so the FIRST fixture of the next day — e.g. a 00:00 ET / late-UTC
// kickoff — never appears and the robot can't see it go LIVE. The caller passes
// the UTC date span of the in-window matches so every fixture is queried by its
// actual kickoff date.
const scoreboardUrl = (slug: string, dates?: string): string =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard` +
  (dates ? `?dates=${dates}` : '');

const summaryUrl = (slug: string, eventId: string): string =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`;

// The ESPN endpoints are unofficial, so be a good citizen on the shared VPS IP:
// send a browser-like UA (a default Node/undici UA reads as a bot) and back off
// hard when ESPN rate-limits us. Both robots fetch through EspnService, so one
// cooldown stops ALL calls instead of hammering through a 429/block.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_BACKOFF_MS = 10 * 60_000; // cap the cooldown at 10 min

/** A lineup row for one team, parsed from the ESPN match summary. */
export interface EspnLineupTeam {
  homeAway: 'home' | 'away';
  formation: string | null;
  players: EspnLineupPlayer[];
}
export interface EspnLineupPlayer {
  espnId: string | null; // athlete id — maps to our Player.espnId
  subForEspnId: string | null; // swap partner's athlete id
  name: string;
  jersey: string | null;
  position: string | null; // ESPN abbreviation, e.g. "CM", "CD-R"
  line: 'GK' | 'DEF' | 'MID' | 'FWD';
  formationPlace: number | null;
  starter: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
  yellow: number; // yellow cards this match
  red: number; // red cards this match
  photo: string | null; // ESPN headshot URL, when available
  subFor: string | null; // who they swapped with (in ↔ out partner), if subbed
  subMinute: string | null; // when the sub happened, e.g. "61'"
}

/**
 * Map an ESPN position abbreviation to a pitch line. Order matters: a defensive
 * mid ("DM") carries a D but is a midfielder, so the M test runs before the D/B
 * (defender) test. Wing-backs ("RWB") carry a B → defender, before the W (winger)
 * test. Unknown/empty falls back to midfield.
 */
export function classifyLine(position: string | null | undefined): EspnLineupPlayer['line'] {
  const p = (position ?? '').toUpperCase();
  if (!p) return 'MID';
  if (p.startsWith('G')) return 'GK';
  if (p.includes('M')) return 'MID';
  if (p.includes('B') || p.includes('D')) return 'DEF';
  if (p.includes('F') || p.includes('W') || p.includes('S')) return 'FWD';
  return 'MID';
}

/** A timeline event (goal/card/substitution/…) parsed from the summary keyEvents. */
export interface EspnMatchEvent {
  espnId: string | null;
  type:
    | 'GOAL'
    | 'OWN_GOAL'
    | 'PENALTY_GOAL'
    | 'PENALTY_MISSED' // missed or saved spot-kick (detail says which)
    | 'PENALTY_AWARDED' // a penalty was given (outcome arrives as its own event)
    | 'YELLOW'
    | 'RED'
    | 'SECOND_YELLOW' // second booking → sending-off
    | 'SUBSTITUTION'
    | 'VAR' // a VAR review/decision (detail summarises it)
    | 'FOUL'
    | 'OFFSIDE'
    | 'CORNER'
    | 'SHOT_ON_TARGET' // on goal (scored separately) — saved/hit the target
    | 'SHOT_OFF_TARGET'
    | 'SHOT_BLOCKED'
    | 'SAVE' // shot on target stopped by the keeper — detail = goalkeeper name
    | 'WOODWORK' // shot that hit the post/bar (detail = which)
    | 'DELAY' // injury / drinks break / VAR check stoppage (detail = reason)
    | 'PERIOD_START' // kickoff of a resumed half — seeds the period header, no row
    | 'PERIOD_END';
  detail: string | null; // short pt label: goal method, VAR decision, delay reason, miss/save
  minute: string | null;
  clockValue: number;
  period: number;
  espnTeamId: string | null;
  playerEspnId: string | null; // scorer / booked / subbed-in
  relatedEspnId: string | null; // assist / subbed-off
  // Player/assist NAMES, when the feed gives a name but no id (the commentary feed
  // does this) — resolved to a Player by name on persist.
  playerName?: string | null;
  relatedName?: string | null;
  text: string | null;
}

/** Pitch method behind a goal, from the ESPN type label ("Goal - Header" etc.). */
function goalMethod(t: string): string | null {
  if (t.includes('header')) return 'De cabeça';
  if (t.includes('volley')) return 'De voleio';
  if (t.includes('free-kick') || t.includes('free kick')) return 'De falta';
  if (t.includes('bicycle')) return 'De bicicleta';
  return null;
}

/** Why the match was stopped, from the Start Delay narrative. */
function delayReason(text: string): string {
  const x = text.toLowerCase();
  if (x.includes('injury')) {
    const m = text.match(/injury\s+(.+?)\s*\(/i);
    return m ? `Atendimento médico · ${m[1].trim()}` : 'Atendimento médico';
  }
  if (x.includes('drinks')) return 'Pausa para água';
  if (x.includes('cooling')) return 'Pausa técnica';
  if (x.includes('var')) return 'Checagem do VAR';
  return 'Jogo paralisado';
}

/** Summarise a VAR decision from its narrative (English) into a pt label. */
function varDetail(text: string): string {
  const x = text.toLowerCase();
  if (
    x.includes('goal') &&
    (x.includes('disallow') ||
      x.includes('cancel') ||
      x.includes('no goal') ||
      x.includes('overturn') ||
      x.includes('ruled out'))
  )
    return 'Gol anulado';
  // A review still IN PROGRESS ("VAR Checking: … Goal") is not a confirmation —
  // its outcome lands as its own event. Test before the plain "goal" branch so it
  // isn't mislabelled "Gol confirmado".
  if (x.includes('check')) return 'Revisão do VAR';
  if (x.includes('goal')) return 'Gol confirmado';
  if (x.includes('penalty') && (x.includes('no ') || x.includes('overturn') || x.includes('cancel')))
    return 'Pênalti revertido';
  if (x.includes('penalty')) return 'Pênalti confirmado';
  if (x.includes('red')) return 'Cartão vermelho';
  if (x.includes('card')) return 'Cartão revisado';
  return 'Revisão do VAR';
}

/**
 * Goalkeeper who stopped an on-target shot, from the ESPN narrative
 * "... is saved ... by <Keeper> (<Team>) ...". Null when the text isn't a save
 * (e.g. cleared off the line), so the caller keeps it a plain SHOT_ON_TARGET.
 */
function keeperFromText(text: string): string | null {
  const m = text.match(/saved[\s\S]*?\bby\s+([^()]+?)\s*\(/i);
  return m ? m[1].trim() || null : null;
}

/** Which woodwork was hit — "No travessão" (bar/crossbar) vs "Na trave" (post). */
function woodworkSpot(text: string): string {
  const x = text.toLowerCase();
  if (x.includes('crossbar') || x.includes('the bar')) return 'No travessão';
  return 'Na trave';
}

/**
 * Classify one ESPN keyEvent into our timeline type + a short pt detail, or null
 * to skip it. ESPN labels by free text (id varies), so we match on the type text
 * and narrative. Order matters: VAR is tested FIRST — its text often contains
 * "goal"/"card"/"penalty", which would otherwise invent a phantom goal/card; and
 * "second yellow" / penalty saved-or-missed are tested before the plain
 * yellow / goal branches.
 */
function classifyEvent(
  typeText?: string,
  text?: string,
): { type: EspnMatchEvent['type']; detail: string | null } | null {
  const t = (typeText ?? '').toLowerCase();
  const x = (text ?? '').toLowerCase();

  // Stoppages: ESPN emits a Start Delay (carries the reason) + an End Delay
  // (resumption). Surface only the start, labelled by reason — the end is noise.
  if (t.includes('start delay')) return { type: 'DELAY', detail: delayReason(text ?? '') };
  if (t.includes('end delay') || x.startsWith('delay over')) return null;

  // VAR review — before goal/card so a "Goal Disallowed" / "(Red) Card Upgrade"
  // doesn't masquerade as a real goal or card.
  if (t.includes('var')) return { type: 'VAR', detail: varDetail(text ?? '') };

  if (t.includes('substitution')) return { type: 'SUBSTITUTION', detail: null };

  // Sending-off by a second booking — before the plain yellow test.
  if (t.includes('second yellow') || x.includes('second yellow'))
    return { type: 'SECOND_YELLOW', detail: null };
  // Require "red card" (not bare "red"): the word "scoRED" — e.g. in
  // "Penalty - Scored" — contains "red" and would otherwise become a red card.
  if (t.includes('red card')) return { type: 'RED', detail: null };
  if (t.includes('yellow')) return { type: 'YELLOW', detail: null };

  // Penalty outcomes — saved/missed BEFORE the goal branch (the text can mention
  // "penalty"/"goal"). A bare "Penalty" (just awarded) is skipped; its outcome
  // arrives as its own event.
  if (t.includes('penalty')) {
    if (t.includes('saved') || x.includes('saved') || x.includes(' save'))
      return { type: 'PENALTY_MISSED', detail: 'Defendido' };
    if (t.includes('miss') || x.includes('miss'))
      return { type: 'PENALTY_MISSED', detail: 'Perdido' };
    if (t.includes('scored') || x.startsWith('goal')) return { type: 'PENALTY_GOAL', detail: null };
    return null;
  }

  if (t.includes('goal') || x.startsWith('goal')) {
    if (t.includes('own') || x.includes('own goal')) return { type: 'OWN_GOAL', detail: null };
    if (x.includes('penalty')) return { type: 'PENALTY_GOAL', detail: null };
    return { type: 'GOAL', detail: goalMethod(t) };
  }

  // Referee whistle ending a period: ESPN "Halftime" (id 81), "End Regular Time"
  // (83), and the extra-time / full-time variants.
  if (
    t === 'halftime' ||
    t.includes('end regular time') ||
    t.includes('full time') ||
    t.includes('match ends') ||
    t.includes('end of extra time') ||
    t.includes('end of 2nd half') ||
    t.includes('end of second half')
  )
    return { type: 'PERIOD_END', detail: null };

  // Kickoff of a RESUMED period — surfaces its header the moment the half
  // restarts, before any event lands. The 1st-half "Kickoff" is left out on
  // purpose (the live "A partida começou" empty-state covers the pre-event gap).
  if (
    t.includes('start 2nd half') ||
    t.includes('start second half') ||
    (t.includes('start') && t.includes('extra'))
  )
    return { type: 'PERIOD_START', detail: null };
  return null; // skip non-events (1st-half kickoff)
}

/** Per-team boxscore statistics (raw name → value); curation happens on persist. */
export interface EspnTeamStats {
  homeAway: 'home' | 'away';
  stats: { key: string; value: string }[];
}

export function parseTeamStats(boxscore?: EspnBoxscore): EspnTeamStats[] {
  return (boxscore?.teams ?? []).map((t) => ({
    homeAway: t.homeAway === 'away' ? 'away' : 'home',
    stats: (t.statistics ?? [])
      .filter((s) => s.name && s.displayValue != null)
      .map((s) => ({ key: s.name!, value: String(s.displayValue) })),
  }));
}

/** Live score + clock + status read from the SAME summary snapshot as the events,
 * so a goal and the score it produces can be applied together (the scoreboard
 * feed the other robot polls can lag this one). Scores keyed by ESPN team id. */
export interface EspnLiveState {
  scores: Record<string, number>;
  clock: string | null;
  statusName: string;
  state: 'pre' | 'in' | 'post' | null;
}

/** Sort weight of a live-clock string, or null for non-numeric ones ("Intervalo",
 * empty) so transitions to/from them are never blocked (no stuck clock at a
 * half-time / extra-time break). */
export function liveClockOrder(clock: string | null): number | null {
  const m = clock?.match(/(\d+)\s*'?\s*(?:\+\s*(\d+))?/);
  return m ? Number(m[1]) * 100 + (m[2] ? Number(m[2]) : 0) : null;
}

/** While live the two ESPN feeds can disagree for a moment; never let the shown
 * clock jump backwards. Blocks ONLY a numeric→smaller-numeric move; anything
 * involving "Intervalo"/unknown is allowed. */
export function clockGoesBack(cur: string | null, next: string | null): boolean {
  const a = liveClockOrder(cur);
  const b = liveClockOrder(next);
  return a !== null && b !== null && b < a;
}

/** One play-by-play entry from the ESPN summary `commentary` feed. */
interface EspnCommentaryPlay {
  id?: string | number;
  type?: { text?: string; type?: string };
  text?: string;
  period?: { number?: number };
  clock?: { value?: number; displayValue?: string };
  team?: { displayName?: string };
  participants?: Array<{ athlete?: { displayName?: string } }>;
}

/**
 * ESPN does NOT put VAR rulings in keyEvents — a disallowed goal simply never
 * appears there (the goal is dropped, leaving no trace). They live in the
 * play-by-play `commentary` instead: a chalked-off goal as "Deleted After Review"
 * (type "deleted-after-review") and the formal call as "VAR - Referee decision
 * cancelled". Pull just those into our timeline as VAR events.
 *
 * Commentary carries NAMES, not ids, so the team is resolved via the header's
 * name→id map (teamIdByName, then the usual espnTeamMap on persist) and the
 * player is left unlinked — the detail ("Gol anulado") + side carry the meaning.
 *
 * A deletion (e.g. 8') and its "VAR Decision: No Goal" (9') describe ONE
 * annulment, so a "No Goal" decision is dropped when a deletion sits within ~3min
 * of it in the same period — otherwise the timeline shows two "Gol anulado" rows.
 * The id is namespaced ("cmt:") so it can't collide with a keyEvent id on upsert.
 */
export function parseCommentaryVarEvents(
  commentary: Array<{ play?: EspnCommentaryPlay }>,
  teamIdByName: Map<string, string>,
): EspnMatchEvent[] {
  const isVar = (p: EspnCommentaryPlay): boolean => {
    const tt = (p.type?.type ?? '').toLowerCase();
    const tx = (p.type?.text ?? '').toLowerCase();
    return tt.includes('review') || tt.includes('var') || tt.includes('delet') || tx.includes('var');
  };
  const isDeletion = (p: EspnCommentaryPlay): boolean =>
    (p.type?.type ?? '').toLowerCase().includes('delet');
  const secs = (p: EspnCommentaryPlay): number => Math.round(Number(p.clock?.value ?? 0)) || 0;
  const per = (p: EspnCommentaryPlay): number => Number(p.period?.number ?? 1) || 1;

  const plays = commentary
    .map((c) => c.play)
    .filter((p): p is EspnCommentaryPlay => !!p && !!p.id && isVar(p));
  const deletions = plays.filter(isDeletion);

  const out: EspnMatchEvent[] = [];
  for (const p of plays) {
    const deletion = isDeletion(p);
    const detail = deletion ? 'Gol anulado' : varDetail(p.text ?? '');
    // Skip a "No Goal" decision that mirrors a nearby deletion (same annulment).
    if (
      !deletion &&
      detail === 'Gol anulado' &&
      deletions.some((d) => per(d) === per(p) && Math.abs(secs(d) - secs(p)) <= 180)
    )
      continue;
    out.push({
      espnId: `cmt:${p.id}`,
      type: 'VAR',
      detail,
      minute: p.clock?.displayValue ?? null,
      clockValue: secs(p),
      period: per(p),
      espnTeamId: teamIdByName.get((p.team?.displayName ?? '').toLowerCase()) ?? null,
      playerEspnId: null,
      relatedEspnId: null,
      playerName: p.participants?.[0]?.athlete?.displayName ?? null,
      text: p.text ?? null,
    });
  }
  return out;
}

/**
 * Extract the running play-by-play — fouls, offsides, corners, shots, a penalty
 * award — from the commentary feed into typed timeline events (the "Narração").
 * The keyEvents/VAR parsers cover goals/cards/subs/VAR; this fills in the rest.
 *
 * Language-free by design: we persist the TYPE + structured player/team only,
 * never the English narration, so the front renders each locale's label. Names
 * come without ids (resolved by name on persist); team via the header name→id map.
 *
 * Quirks: a foul CAN emit a pair — "Foul by X" (the offender) and "Y wins a free
 * kick" (the victim) — but ESPN often sends only ONE of the two (frequently just
 * the "wins a free kick" half). So we keep both forms and only drop a "wins a free
 * kick" when its exact "Foul by" twin (same period + second) is present — otherwise
 * dropping them all loses every foul ESPN reported only that way. An offside's
 * participants name the passer, not the caught player, so that name is read from
 * the text instead. A corner names no player. Ids are namespaced ("cmt:").
 */
export function parseCommentaryActionEvents(
  commentary: Array<{ play?: EspnCommentaryPlay }>,
  teamIdByName: Map<string, string>,
): EspnMatchEvent[] {
  const secs = (p: EspnCommentaryPlay): number => Math.round(Number(p.clock?.value ?? 0)) || 0;
  const per = (p: EspnCommentaryPlay): number => Number(p.period?.number ?? 1) || 1;
  const part = (p: EspnCommentaryPlay, i: number): string | null =>
    p.participants?.[i]?.athlete?.displayName ?? null;

  // Moments that already have an explicit "Foul by X" — used to drop the redundant
  // "wins a free kick" twin only when the offender half is actually present.
  const foulByAt = new Set<string>();
  for (const c of commentary) {
    const p = c?.play;
    if (
      p?.id &&
      (p.type?.type ?? '').toLowerCase() === 'foul' &&
      (p.text ?? '').toLowerCase().startsWith('foul by')
    )
      foulByAt.add(`${per(p)}:${secs(p)}`);
  }

  const out: EspnMatchEvent[] = [];
  for (const c of commentary) {
    const p = c.play;
    if (!p?.id) continue;
    const tt = (p.type?.type ?? '').toLowerCase();
    const tx = (p.text ?? '').toLowerCase();

    let type: EspnMatchEvent['type'];
    let playerName: string | null = null;
    let relatedName: string | null = null;
    let detail: string | null = null;
    if (tt === 'foul') {
      // Keep "Foul by X"; keep "X wins a free kick" only when no offender twin
      // exists at the same moment (else it'd duplicate the kept "Foul by").
      if (!tx.startsWith('foul by') && foulByAt.has(`${per(p)}:${secs(p)}`))
        continue;
      type = 'FOUL';
      playerName = part(p, 0);
    } else if (tt === 'offside') {
      type = 'OFFSIDE';
      playerName = p.text?.match(/\.\s*(.+?)\s+is caught offside/i)?.[1]?.trim() ?? null;
    } else if (tt === 'corner-awarded') {
      type = 'CORNER';
    } else if (tt === 'shot-off-target') {
      type = 'SHOT_OFF_TARGET';
      playerName = part(p, 0);
      relatedName = part(p, 1);
    } else if (tt === 'shot-hit-woodwork') {
      // Hit the post/bar — a near-goal worth its own row.
      type = 'WOODWORK';
      playerName = part(p, 0);
      relatedName = part(p, 1);
      detail = woodworkSpot(p.text ?? '');
    } else if (tt === 'shot-on-target') {
      // An on-target shot that didn't score was stopped by the keeper: surface it
      // as a SAVE highlighting the goalkeeper (detail), since the keeper is on the
      // opposing team and can't resolve as a same-team `related` player.
      const keeper = keeperFromText(p.text ?? '');
      if (keeper) {
        type = 'SAVE';
        playerName = part(p, 0); // shooter
        detail = keeper; // goalkeeper name
      } else {
        type = 'SHOT_ON_TARGET';
        playerName = part(p, 0);
        relatedName = part(p, 1);
      }
    } else if (tt === 'shot-blocked') {
      type = 'SHOT_BLOCKED';
      playerName = part(p, 0);
      relatedName = part(p, 1);
    } else if (tt.includes('penalty') && !tt.includes('miss') && !tt.includes('saved')) {
      type = 'PENALTY_AWARDED';
    } else {
      continue;
    }

    out.push({
      espnId: `cmt:${p.id}`,
      type,
      detail,
      minute: p.clock?.displayValue ?? null,
      clockValue: secs(p),
      period: per(p),
      espnTeamId: teamIdByName.get((p.team?.displayName ?? '').toLowerCase()) ?? null,
      playerEspnId: null,
      relatedEspnId: null,
      playerName,
      relatedName,
      text: p.text ?? null,
    });
  }
  return out;
}

// A confirmed downward score move must persist at least this long before it's
// applied — longer than the worst lag between the two ESPN feeds (summary ticks
// every 60s), so a momentarily-stale feed can't sneak a real-looking drop past it.
const SCORE_DROP_CONFIRM_MS = 90_000;

type PendingDrop = { value: number; since: number };

/**
 * Reconciles one side's live score against the feed. A goal can be annulled (VAR),
 * so the score must be allowed to go DOWN — but the two ESPN feeds lag each other,
 * and a lagging feed momentarily reports the pre-goal score, which must NOT revert
 * a fresh goal (the flicker the monotonic guard was added to kill).
 *
 * We tell the two apart by persistence: an upward move applies at once; a downward
 * move (play never lowers a score — it's always a correction) applies only after
 * the lower value has been observed continuously for SCORE_DROP_CONFIRM_MS. A
 * lagging feed re-asserts the higher score within a cycle and clears the pending
 * drop; a real VAR annulment stays low and eventually applies. At FINISHED the
 * feed is authoritative, so the exact value is taken immediately.
 *
 * Keeps per-match in-memory state, so each robot owns its own instance. A process
 * restart just resets the (short) confirmation timer — harmless.
 */
export class LiveScoreReconciler {
  // matchId → side → pending downward correction awaiting confirmation.
  private pending = new Map<string, Partial<Record<'home' | 'away', PendingDrop>>>();

  /** The value to write for this side, or undefined to leave it unchanged. */
  reconcile(
    matchId: string,
    side: 'home' | 'away',
    reported: number | undefined,
    current: number | null,
    isFinal: boolean,
    now: number,
  ): number | undefined {
    const clear = () => {
      const p = this.pending.get(matchId);
      if (!p) return;
      delete p[side];
      if (!p.home && !p.away) this.pending.delete(matchId);
    };
    const cur = current ?? 0;
    if (reported === undefined || reported === cur) {
      clear();
      return undefined;
    }
    if (isFinal || reported > cur) {
      clear();
      return reported;
    }
    // reported < cur → a downward correction; apply only once it has persisted.
    const p = this.pending.get(matchId) ?? {};
    const prev = p[side];
    if (prev && prev.value === reported && now - prev.since >= SCORE_DROP_CONFIRM_MS) {
      clear();
      return reported;
    }
    if (!prev || prev.value !== reported) {
      p[side] = { value: reported, since: now };
      this.pending.set(matchId, p);
    }
    return undefined;
  }
}

/** Keep only meaningful events; participants[0]=scorer/sub-in, [1]=assist/sub-off.
 * Shootout spot-kicks are pinned to period 5 so they group as a separate
 * "Disputa de pênaltis" block, apart from any extra-time events. */
export function parseMatchEvents(keyEvents: EspnKeyEvent[]): EspnMatchEvent[] {
  const out: EspnMatchEvent[] = [];
  for (const e of keyEvents) {
    const c = classifyEvent(e.type?.text, e.text);
    if (!c) continue;
    const parts = e.participants ?? [];
    out.push({
      espnId: e.id != null ? String(e.id) : null,
      type: c.type,
      detail: c.detail,
      minute: e.clock?.displayValue ?? null,
      clockValue: Math.round(Number(e.clock?.value ?? 0)) || 0,
      period: e.shootout ? 5 : Number(e.period?.number ?? 1) || 1,
      espnTeamId: e.team?.id != null ? String(e.team.id) : null,
      playerEspnId: parts[0]?.athlete?.id != null ? String(parts[0].athlete!.id) : null,
      relatedEspnId: parts[1]?.athlete?.id != null ? String(parts[1].athlete!.id) : null,
      text: e.text ?? null,
    });
  }
  return out;
}

/**
 * Reads a league's scoreboard from ESPN's public (unofficial) site API. The
 * league slug (e.g. "fifa.world", "bra.1", "conmebol.libertadores") comes from
 * the Competition, so one engine serves every tournament. No key required.
 * `dates` (YYYYMMDD or a range) pins the query to specific UTC days instead of
 * ESPN's lagging default day. Returns [] on any failure — the caller must degrade
 * gracefully (manual control still works). Easy to swap for a keyed provider later.
 */
@Injectable()
export class EspnService {
  private readonly logger = new Logger(EspnService.name);
  // Set when ESPN rate-limits us (429/503): skip ALL calls until this instant.
  private blockedUntil = 0;
  private backoffStreak = 0;

  constructor(private readonly alerts: AlertsService) {}

  /**
   * Shared GET → JSON for the unofficial ESPN endpoints. Sends a browser UA,
   * honours an active cooldown (returns null WITHOUT calling out), and on a
   * 429/503 arms an exponential backoff (respecting Retry-After when present).
   * Returns null on any non-OK / network error so callers degrade gracefully.
   */
  private async getJson<T>(url: string, label: string): Promise<T | null> {
    if (Date.now() < this.blockedUntil) return null; // cooling down — don't hit ESPN
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      this.logger.warn(`ESPN fetch failed (${label}): ${(e as Error).message}`);
      return null;
    }
    if (res.status === 429 || res.status === 503) {
      this.noteRateLimit(res.headers.get('retry-after'), label);
      return null;
    }
    if (!res.ok) {
      this.logger.warn(`ESPN responded ${res.status} for ${label}`);
      return null;
    }
    if (this.backoffStreak > 0) {
      const streak = this.backoffStreak;
      this.logger.log(`ESPN recovered after ${streak} backoff(s)`);
      this.backoffStreak = 0;
      this.blockedUntil = 0;
      void this.alerts.notify('ESPN normalizada', `Voltou a responder apos ${streak} backoff(s). ✅`);
    }
    return (await res.json()) as T;
  }

  /**
   * Arm (or grow) the cooldown after a rate-limit. Uses Retry-After when the
   * header is present (seconds or HTTP-date), else exponential 30s·2^n, capped.
   */
  private noteRateLimit(retryAfter: string | null, label: string): void {
    let wait = 0;
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs)) wait = secs * 1000;
      else {
        const when = Date.parse(retryAfter);
        if (!Number.isNaN(when)) wait = when - Date.now();
      }
    }
    if (wait <= 0) wait = Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** this.backoffStreak);
    // Alert once at the START of a backoff episode (streak 0→1), not on every 429,
    // so a sustained block sends one heads-up, not a flood. Recovery sends the all-clear.
    const firstOfEpisode = this.backoffStreak === 0;
    this.backoffStreak++;
    this.blockedUntil = Date.now() + wait;
    this.logger.warn(`ESPN rate-limited — backing off ${Math.round(wait / 1000)}s`);
    if (firstOfEpisode)
      void this.alerts.notify(
        'ESPN bloqueada',
        `Rate-limit (429/503) em ${label}. Pausando chamadas por ~${Math.round(wait / 1000)}s. ⚠️`,
        'high',
      );
  }

  async fetchScoreboard(
    slug: string = DEFAULT_LEAGUE_SLUG,
    dates?: string,
  ): Promise<EspnEvent[]> {
    const data = await this.getJson<EspnScoreboard>(scoreboardUrl(slug, dates), slug);
    if (!data) return [];
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
        clock: ev.status?.displayClock ?? null,
        scores,
        abbrs: Object.keys(scores),
        cards,
        fairPlay,
      });
    }
    return out;
  }

  /**
   * Reads a single match's lineups from the ESPN summary endpoint (same public
   * API as the scoreboard). Returns one row per team (formation + players with
   * starter/sub flags), or null when the feed has no rosters yet — ESPN publishes
   * lineups ~1h before kickoff, so before that this is empty. Degrades to null on
   * any failure (the caller surfaces "escalação indisponível").
   */
  async fetchSummaryFull(
    slug: string,
    eventId: string,
  ): Promise<{
    teams: EspnLineupTeam[];
    events: EspnMatchEvent[];
    stats: EspnTeamStats[];
    live: EspnLiveState | null;
    gameInfo: { attendance: number | null; referee: string | null };
  } | null> {
    const data = await this.getJson<EspnSummary>(summaryUrl(slug, eventId), `${slug}/${eventId}`);
    if (!data) return null;

    // Pair up substitutions from keyEvents: "X replaces Y" → participants[0] in,
    // participants[1] out. Key both athletes by id to their swap partner + minute.
    const subInfo = new Map<
      string,
      { partner: string; partnerId: string | null; minute: string | null }
    >();
    for (const e of data.keyEvents ?? []) {
      if ((e.type?.text ?? '').toLowerCase() !== 'substitution') continue;
      const inA = e.participants?.[0]?.athlete;
      const outA = e.participants?.[1]?.athlete;
      const minute = e.clock?.displayValue ?? null;
      if (inA?.id && outA?.displayName)
        subInfo.set(String(inA.id), { partner: outA.displayName, partnerId: outA.id ?? null, minute });
      if (outA?.id && inA?.displayName)
        subInfo.set(String(outA.id), { partner: inA.displayName, partnerId: inA.id ?? null, minute });
    }

    const teams: EspnLineupTeam[] = (data.rosters ?? []).map((r) => ({
      homeAway: r.homeAway === 'away' ? 'away' : 'home',
      formation: r.formation ?? null,
      players: (r.roster ?? []).map((p) => {
        const position = p.position?.abbreviation ?? null;
        const stat = (abbr: string): number => {
          const s = p.stats?.find((x) => x.abbreviation === abbr);
          return s ? Number(s.displayValue) || 0 : 0;
        };
        const sub = p.athlete?.id ? subInfo.get(String(p.athlete.id)) : undefined;
        return {
          espnId: p.athlete?.id ?? null,
          subForEspnId: sub?.partnerId ?? null,
          name: p.athlete?.displayName ?? '',
          jersey: p.jersey ?? null,
          position,
          line: classifyLine(position),
          formationPlace:
            p.formationPlace != null ? Number(p.formationPlace) : null,
          starter: !!p.starter,
          subbedIn: didSub(p.subbedIn),
          subbedOut: didSub(p.subbedOut),
          yellow: stat('YC'),
          red: stat('RC'),
          photo: p.athlete?.headshot?.href ?? null,
          subFor: sub?.partner ?? null,
          subMinute: sub?.minute ?? null,
        };
      }),
    }));

    // Live score + clock from the header (same snapshot as the events above).
    const comp = data.header?.competitions?.[0];

    // ESPN team displayName → id, from the header — the commentary feed (which
    // carries VAR rulings) names the team but gives no id, so this bridges it back
    // to the espnTeamMap used on persist.
    const teamIdByName = new Map<string, string>();
    for (const c of comp?.competitors ?? []) {
      if (c.team?.id != null && c.team.displayName)
        teamIdByName.set(c.team.displayName.toLowerCase(), String(c.team.id));
    }

    const events = [
      ...parseMatchEvents(data.keyEvents ?? []),
      ...parseCommentaryVarEvents(data.commentary ?? [], teamIdByName),
      ...parseCommentaryActionEvents(data.commentary ?? [], teamIdByName),
    ];
    const stats = parseTeamStats(data.boxscore);
    const live: EspnLiveState | null = comp
      ? {
          scores: Object.fromEntries(
            (comp.competitors ?? [])
              .filter((c) => c.team?.id != null && c.score != null)
              .map((c) => [String(c.team!.id), Number.parseInt(String(c.score), 10) || 0]),
          ),
          clock: comp.status?.displayClock ?? null,
          statusName: comp.status?.type?.name ?? '',
          state: comp.status?.type?.state ?? null,
        }
      : null;

    // gameInfo: crowd + the main referee (the official whose position is exactly
    // "Referee", not an assistant / fourth / VAR).
    const gi = data.gameInfo;
    const attendance =
      typeof gi?.attendance === 'number' && gi.attendance > 0 ? gi.attendance : null;
    let referee: string | null = null;
    for (const o of gi?.officials ?? []) {
      if ((o.position?.displayName ?? '').toLowerCase() === 'referee') {
        referee = normalizeRefereeName(o.displayName ?? o.fullName);
        break;
      }
    }
    const gameInfo = { attendance, referee };

    if (!teams.length && !events.length && !stats.length && !live) return null;
    return { teams, events, stats, live, gameInfo };
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
interface EspnSummary {
  rosters?: Array<{
    homeAway?: string;
    formation?: string;
    roster?: Array<{
      athlete?: { id?: string; displayName?: string; headshot?: { href?: string } };
      jersey?: string;
      position?: { abbreviation?: string };
      formationPlace?: number | string;
      starter?: boolean;
      subbedIn?: boolean | { didSub?: boolean };
      subbedOut?: boolean | { didSub?: boolean };
      stats?: Array<{ abbreviation?: string; displayValue?: string }>;
    }>;
  }>;
  keyEvents?: EspnKeyEvent[];
  commentary?: Array<{ play?: EspnCommentaryPlay }>;
  boxscore?: EspnBoxscore;
  header?: {
    competitions?: Array<{
      competitors?: Array<{
        score?: string | number;
        team?: { id?: string | number; displayName?: string };
      }>;
      status?: { displayClock?: string; type?: { name?: string; state?: 'pre' | 'in' | 'post' } };
    }>;
  };
  gameInfo?: {
    attendance?: number;
    officials?: Array<{
      displayName?: string;
      fullName?: string;
      position?: { displayName?: string; name?: string };
    }>;
  };
}
interface EspnBoxscore {
  teams?: Array<{
    homeAway?: string;
    statistics?: Array<{ name?: string; displayValue?: string }>;
  }>;
}
interface EspnKeyEvent {
  id?: string | number;
  type?: { text?: string };
  text?: string;
  clock?: { value?: number; displayValue?: string };
  period?: { number?: number };
  team?: { id?: string | number };
  shootout?: boolean;
  participants?: Array<{ athlete?: { id?: string; displayName?: string } }>;
}
interface EspnScoreboard {
  events?: Array<{
    id: string | number;
    date: string;
    status?: { type?: { state?: 'pre' | 'in' | 'post'; name?: string }; displayClock?: string };
    competitions?: Array<{
      competitors?: Array<{
        score?: string;
        team?: { id?: string | number; abbreviation?: string };
      }>;
      details?: EspnDetail[];
    }>;
  }>;
}
