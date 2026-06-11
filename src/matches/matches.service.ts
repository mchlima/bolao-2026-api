import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { Paginated, paginated } from '../common/pagination';
import { CreateMatchDto } from './dto/create-match.dto';
import { QueryMatchesDto } from './dto/query-matches.dto';
import { UpdateMatchDto } from './dto/update-match.dto';

// Relations returned with every match (teams carry flag/logo data for the UI).
const MATCH_INCLUDE = {
  homeTeam: true,
  awayTeam: true,
  stadium: true,
  tournament: { select: { id: true, name: true, status: true } },
} satisfies Prisma.MatchInclude;

export type MatchWithRelations = Prisma.MatchGetPayload<{
  include: typeof MATCH_INCLUDE;
}>;

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  async findAll(query: QueryMatchesDto): Promise<Paginated<MatchWithRelations>> {
    const { page, pageSize, tournamentId, status, groupName } = query;
    const where: Prisma.MatchWhereInput = {
      ...(tournamentId && { tournamentId }),
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

  async findOne(id: string): Promise<MatchWithRelations> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: MATCH_INCLUDE,
      relationLoadStrategy: 'join',
    });
    if (!match) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Partida não encontrada.',
      });
    }
    return match;
  }

  create(dto: CreateMatchDto): Promise<MatchWithRelations> {
    return this.prisma.match.create({ data: dto, include: MATCH_INCLUDE });
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
    this.events.emit(`match:${updated.id}`, `tournament:${updated.tournamentId}`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.match.delete({ where: { id } });
  }
}
