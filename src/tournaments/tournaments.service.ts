import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Tournament } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { QueryTournamentsDto } from './dto/query-tournaments.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';

@Injectable()
export class TournamentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryTournamentsDto,
  ): Promise<Paginated<Tournament & { matchCount: number }>> {
    const { page, pageSize, search, status } = query;
    const where: Prisma.TournamentWhereInput = {
      ...(status && { status }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.tournament.findMany({
        where,
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { matches: true } } },
      }),
      this.prisma.tournament.count({ where }),
    ]);

    const shaped = data.map(({ _count, ...t }) => ({
      ...t,
      matchCount: _count.matches,
    }));
    return paginated(shaped, total, page, pageSize);
  }

  async findOne(id: string): Promise<Tournament> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });
    if (!tournament) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Torneio não encontrado.',
      });
    }
    return tournament;
  }

  create(dto: CreateTournamentDto): Promise<Tournament> {
    return this.prisma.tournament.create({ data: dto });
  }

  async update(id: string, dto: UpdateTournamentDto): Promise<Tournament> {
    await this.findOne(id);
    return this.prisma.tournament.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.tournament.delete({ where: { id } });
  }
}
