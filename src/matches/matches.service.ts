import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryMatchesDto): Promise<Paginated<MatchWithRelations>> {
    const { page, pageSize, tournamentId, status, groupName } = query;
    const where: Prisma.MatchWhereInput = {
      ...(tournamentId && { tournamentId }),
      ...(status && { status }),
      ...(groupName && { groupName }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        include: MATCH_INCLUDE,
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

  async update(id: string, dto: UpdateMatchDto): Promise<MatchWithRelations> {
    await this.findOne(id);
    return this.prisma.match.update({
      where: { id },
      data: dto,
      include: MATCH_INCLUDE,
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.match.delete({ where: { id } });
  }
}
