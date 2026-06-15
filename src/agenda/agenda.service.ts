import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaQueryDto, AgendaScope } from './dto/agenda-query.dto';

// Public agenda payload: a match with enough context to render a cross-tournament
// card (teams, score, venue, phase, competition + sport labels).
const AGENDA_INCLUDE = {
  homeTeam: true,
  awayTeam: true,
  stadium: true,
  season: {
    select: {
      id: true,
      name: true,
      status: true,
      competition: {
        select: {
          id: true,
          name: true,
          slug: true,
          sport: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.MatchInclude;

export interface AgendaDay {
  date: string; // YYYY-MM-DD in America/São_Paulo
  matches: Prisma.MatchGetPayload<{ include: typeof AGENDA_INCLUDE }>[];
}

// Brazil has no DST since 2019 → a fixed -03:00. The calendar day a match belongs
// to is its local (BRT) day, which is why grouping is done server-side.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const brtDay = (d: Date): string =>
  new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
const startOfBrtDay = (dayStr: string): Date => new Date(`${dayStr}T00:00:00-03:00`);

@Injectable()
export class AgendaService {
  constructor(private readonly prisma: PrismaService) {}

  async agenda(query: AgendaQueryDto): Promise<{ scope: AgendaScope; days: AgendaDay[] }> {
    const scope = query.scope ?? 'upcoming';
    const now = new Date();
    const todayStart = startOfBrtDay(brtDay(now));

    // Tournament/sport scoping. competitionId/seasonId narrow to one tournament;
    // sportId narrows to a sport (the global agenda passes none).
    const where: Prisma.MatchWhereInput = {
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    };
    if (query.seasonId) where.seasonId = query.seasonId;
    else if (query.competitionId) where.season = { competitionId: query.competitionId };
    else if (query.sportId) where.season = { competition: { sportId: query.sportId } };

    // Explicit date window wins; otherwise the scope picks one.
    if (query.from || query.to) {
      where.kickoffAt = {
        ...(query.from ? { gte: startOfBrtDay(query.from) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59-03:00`) } : {}),
      };
    } else {
      switch (scope) {
        case 'live':
          where.status = 'LIVE';
          break;
        case 'today':
          where.kickoffAt = {
            gte: todayStart,
            lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000),
          };
          break;
        case 'past':
          where.status = 'FINISHED';
          break;
        case 'upcoming':
          // From today onward, plus any match still LIVE now (it may have kicked
          // off before midnight BRT — e.g. a late game running past 00:00 — so a
          // kickoff>=today filter would wrongly drop the one match happening right
          // now), plus postponed games (placeholder past date, no real date yet).
          // Postponed carry a placeholder PAST date, so under an ascending `limit`
          // they'd sort to the top and eat the result set — only include them in
          // the full (unlimited) agenda.
          where.OR = [
            { kickoffAt: { gte: todayStart } },
            { status: 'LIVE' },
            ...(query.limit ? [] : [{ status: 'POSTPONED' as const }]),
          ];
          break;
        case 'all':
          break;
      }
    }

    const desc = scope === 'past';
    const take = Math.min(query.limit ? Number(query.limit) || 500 : 500, 500);
    const matches = await this.prisma.match.findMany({
      where,
      include: AGENDA_INCLUDE,
      orderBy: [{ kickoffAt: desc ? 'desc' : 'asc' }],
      take,
    });

    // Group by BRT calendar day, preserving the ordered traversal. POSTPONED games
    // carry a placeholder (past) date with no real kickoff yet, so they'd otherwise
    // sort to the very top of an ascending list — collect them into a trailing
    // "a definir" bucket instead (the front renders that day label as "A definir").
    const byDay = new Map<string, AgendaDay>();
    const postponed: AgendaDay['matches'] = [];
    for (const m of matches) {
      if (m.status === 'POSTPONED') {
        postponed.push(m);
        continue;
      }
      const date = brtDay(m.kickoffAt);
      (byDay.get(date) ?? byDay.set(date, { date, matches: [] }).get(date)!).matches.push(m);
    }
    const days = [...byDay.values()];
    if (postponed.length) days.push({ date: 'postponed', matches: postponed });
    return { scope, days };
  }
}
