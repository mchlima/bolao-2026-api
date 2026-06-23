import { Injectable, NotFoundException } from '@nestjs/common';
import { MatchNote, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { Paginated, paginated } from '../common/pagination';
import { CreateMatchDto } from './dto/create-match.dto';
import { QueryMatchesDto } from './dto/query-matches.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { SlotResolverService } from '../structure/slot-resolver.service';
import { ensureMatchSlug } from './match-slug.util';

// Relations returned with every match (teams carry flag/logo data for the UI).
const MATCH_INCLUDE = {
  homeTeam: true,
  awayTeam: true,
  stadium: true,
  season: {
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      location: true,
      logoUrl: true,
      broadcasters: true,
      competition: { select: { name: true, urlSlug: true, country: true, confederation: true } },
    },
  },
  round: { select: { number: true, name: true } },
} satisfies Prisma.MatchInclude;

export type MatchWithRelations = Prisma.MatchGetPayload<{
  include: typeof MATCH_INCLUDE;
}>;

// Detail payload adds availability counts so the front can decide which match
// tabs (Escalação / Linha do tempo / Estatísticas) to show — synchronously, on
// SSR, instead of waiting for each tab component to mount and report back.
const MATCH_DETAIL_INCLUDE = {
  ...MATCH_INCLUDE,
  _count: { select: { lineupEntries: true, events: true, stats: true } },
} satisfies Prisma.MatchInclude;

export type MatchDetail = Prisma.MatchGetPayload<{
  include: typeof MATCH_DETAIL_INCLUDE;
}>;

// findOne enriches the season with its participating teams (for SEO structured data).
export type MatchDetailWithTeams = MatchDetail & {
  season: MatchDetail['season'] & { teams: { name: string; logoUrl: string | null }[] };
};

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly resolver: SlotResolverService,
  ) {}

  async findAll(
    query: QueryMatchesDto,
  ): Promise<Paginated<MatchWithRelations>> {
    const { page, pageSize, seasonId, status, groupName } = query;
    const where: Prisma.MatchWhereInput = {
      ...(seasonId && { seasonId }),
      ...(status && { status }),
      ...(groupName && { groupName }),
    };

    // Parallel (not $transaction) to avoid BEGIN/COMMIT round trips; join strategy
    // collapses the relation loads into a single query each (cross-region latency).
    const [data, total] = await Promise.all([
      this.prisma.match.findMany({
        where,
        include: MATCH_INCLUDE,
        relationLoadStrategy: 'join',
        orderBy: [{ matchNumber: 'asc' }, { kickoffAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.match.count({ where }),
    ]);

    return paginated(data, total, page, pageSize);
  }

  async findOne(idOrSlug: string): Promise<MatchDetailWithTeams> {
    // Aceita id (cuid) OU slug de SEO ("brasil-x-franca-2026-06-22") — a página de jogo
    // resolve pela URL bonita; links/redirects antigos por id continuam funcionando.
    const match = await this.prisma.match.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: MATCH_DETAIL_INCLUDE,
      relationLoadStrategy: 'join',
    });
    if (!match) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Partida não encontrada.',
      });
    }
    // Participating teams of the season (distinct across all groups) — feeds the
    // SportsEvent.superEvent `performer` in the page's structured data. Indexed,
    // name+crest only; one extra query on the detail load (shared by every match).
    const teams = await this.prisma.team.findMany({
      where: { groupTeams: { some: { group: { stage: { seasonId: match.seasonId } } } } },
      select: { name: true, logoUrl: true },
      orderBy: { name: 'asc' },
    });
    return { ...match, season: { ...match.season, teams } };
  }

  async create(dto: CreateMatchDto): Promise<MatchWithRelations> {
    const data = { ...dto };
    // Auto-assign the next fixture number within the season when not provided
    // (e.g. matches created from the structure editor) — keeps numbering
    // consistent with the seeded fixtures (1..N) instead of leaving it null.
    if (data.matchNumber == null) {
      const { _max } = await this.prisma.match.aggregate({
        where: { seasonId: dto.seasonId },
        _max: { matchNumber: true },
      });
      data.matchNumber = (_max.matchNumber ?? 0) + 1;
    }
    const created = await this.prisma.match.create({ data, include: MATCH_INCLUDE });
    try {
      await ensureMatchSlug(this.prisma, created.id);
    } catch {
      // slug é best-effort (SEO) — nunca falha a criação do jogo
    }
    return this.prisma.match.findUniqueOrThrow({ where: { id: created.id }, include: MATCH_INCLUDE });
  }

  async update(
    id: string,
    dto: UpdateMatchDto,
    actorUserId?: string,
  ): Promise<MatchWithRelations> {
    const before = await this.findOne(id);
    const updated = await this.prisma.match.update({
      where: { id },
      data: dto,
      include: MATCH_INCLUDE,
    });

    // Times/data podem ter mudado → recalcula o slug de SEO (best-effort).
    if (dto.homeTeamId !== undefined || dto.awayTeamId !== undefined || dto.kickoffAt !== undefined) {
      try {
        await ensureMatchSlug(this.prisma, id);
      } catch {
        // slug é best-effort — nunca falha o update do jogo
      }
    }

    // Audit sensitive live-control changes (status / score) when an actor is known.
    if (actorUserId) {
      const diff: Record<string, { before: unknown; after: unknown }> = {};
      if (dto.status !== undefined && before.status !== updated.status)
        diff.status = { before: before.status, after: updated.status };
      if (dto.homeScore !== undefined && before.homeScore !== updated.homeScore)
        diff.homeScore = { before: before.homeScore, after: updated.homeScore };
      if (dto.awayScore !== undefined && before.awayScore !== updated.awayScore)
        diff.awayScore = { before: before.awayScore, after: updated.awayScore };
      if (
        dto.predictionsOpen !== undefined &&
        before.predictionsOpen !== updated.predictionsOpen
      )
        diff.predictionsOpen = {
          before: before.predictionsOpen,
          after: updated.predictionsOpen,
        };

      if (Object.keys(diff).length > 0) {
        await this.audit.record({
          actorUserId,
          action: 'MATCH_UPDATE',
          entityType: 'Match',
          entityId: id,
          diff,
        });
      }
    }
    this.events.emit(
      `match:${updated.id}`,
      `tournament:${updated.seasonId}`,
    );

    // A finished match (or a changed knockout score) may decide a group or feed a
    // bracket slot — re-resolve the season's ties. Best-effort; never blocks the update.
    const scoreTouched =
      dto.homeScore !== undefined ||
      dto.awayScore !== undefined ||
      dto.homePenalties !== undefined ||
      dto.awayPenalties !== undefined;
    if (updated.status === 'FINISHED' || (updated.tieId && scoreTouched)) {
      try {
        await this.resolver.resolveSeason(updated.seasonId);
      } catch {
        // resolution is advisory; a failure must not fail the match update
      }
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.match.delete({ where: { id } });
  }

  // ──────────────────────────────────────────── narração ao vivo (notas do admin)

  /** Comentários do admin de uma partida, em ordem cronológica (chat). */
  async listNotes(matchId: string): Promise<MatchNote[]> {
    return this.prisma.matchNote.findMany({ where: { matchId }, orderBy: { createdAt: 'asc' } });
  }

  /** Narração HUMANA da ESPN ingerida (MatchCommentary), pro admin inspecionar e
   * aproveitar como matéria-prima. Em ordem cronológica; resolve o lado (home/away). */
  async listCommentary(matchId: string): Promise<
    Array<{ id: string; minute: string | null; period: number; type: string | null; side: 'home' | 'away' | null; text: string }>
  > {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { homeTeamId: true, awayTeamId: true },
    });
    if (!match) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Partida não encontrada.' });
    const rows = await this.prisma.matchCommentary.findMany({
      where: { matchId },
      orderBy: [{ clockValue: 'asc' }, { sequence: 'asc' }],
      select: { id: true, minute: true, period: true, type: true, teamId: true, text: true },
    });
    return rows.map((r) => ({
      id: r.id,
      minute: r.minute,
      period: r.period,
      type: r.type,
      side: r.teamId === match.homeTeamId ? 'home' : r.teamId === match.awayTeamId ? 'away' : null,
      text: r.text,
    }));
  }

  async addNote(matchId: string, text: string, minute: string | null, authorId: string): Promise<MatchNote> {
    const exists = await this.prisma.match.findUnique({ where: { id: matchId }, select: { id: true } });
    if (!exists) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Partida não encontrada.' });
    return this.prisma.matchNote.create({
      data: { matchId, text: text.trim(), minute: minute?.trim() || null, authorId },
    });
  }

  /** Edita um comentário (texto/tempo) sem alterar createdAt — a ordem no chat é preservada. */
  async updateNote(matchId: string, noteId: string, text: string, minute: string | null): Promise<MatchNote> {
    const note = await this.prisma.matchNote.findFirst({ where: { id: noteId, matchId }, select: { id: true } });
    if (!note) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Comentário não encontrado.' });
    return this.prisma.matchNote.update({
      where: { id: noteId },
      data: { text: text.trim(), minute: minute?.trim() || null },
    });
  }

  async removeNote(matchId: string, noteId: string): Promise<void> {
    await this.prisma.matchNote.deleteMany({ where: { id: noteId, matchId } });
  }
}
