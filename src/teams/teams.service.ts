import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Team } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { CreateTeamDto } from './dto/create-team.dto';
import { QueryTeamsDto } from './dto/query-teams.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryTeamsDto): Promise<Paginated<Team>> {
    const { page, pageSize, search, type, continent, country, sort, hasLogo } =
      query;
    const where: Prisma.TeamWhereInput = {
      ...(type && { type }),
      ...(continent && { continent }),
      ...(country && { country }),
      ...(hasLogo === 'true' && { logoUrl: { not: null } }),
      ...(hasLogo === 'false' && { logoUrl: null }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { shortName: { contains: search, mode: 'insensitive' } },
          { espnAbbr: { contains: search, mode: 'insensitive' } },
          { country: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const orderBy: Prisma.TeamOrderByWithRelationInput[] =
      sort === 'recent'
        ? [{ updatedAt: 'desc' }]
        : sort === 'country'
          ? [{ country: 'asc' }, { name: 'asc' }]
          : [{ name: 'asc' }];

    const [data, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.team.count({ where }),
    ]);

    return paginated(data, total, page, pageSize);
  }

  /** Distinct values + counts for the admin filter UI. */
  async facets(): Promise<{
    total: number;
    types: { value: string; count: number }[];
    continents: { value: string; count: number }[];
    countries: { value: string; count: number }[];
    withLogo: number;
    withoutLogo: number;
  }> {
    const [total, byType, byContinent, byCountry, withLogo] = await Promise.all([
      this.prisma.team.count(),
      this.prisma.team.groupBy({ by: ['type'], _count: { _all: true } }),
      this.prisma.team.groupBy({
        by: ['continent'],
        where: { continent: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.team.groupBy({
        by: ['country'],
        where: { country: { not: null } },
        _count: { _all: true },
        orderBy: { country: 'asc' },
      }),
      this.prisma.team.count({ where: { logoUrl: { not: null } } }),
    ]);
    return {
      total,
      types: byType.map((t) => ({ value: t.type, count: t._count._all })),
      continents: byContinent
        .map((c) => ({ value: c.continent as string, count: c._count._all }))
        .sort((a, b) => b.count - a.count),
      countries: byCountry.map((c) => ({
        value: c.country as string,
        count: c._count._all,
      })),
      withLogo,
      withoutLogo: total - withLogo,
    };
  }

  async findOne(id: string): Promise<Team> {
    const team = await this.prisma.team.findUnique({ where: { id } });
    if (!team) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Time não encontrado.',
      });
    }
    return team;
  }

  create(dto: CreateTeamDto): Promise<Team> {
    return this.prisma.team.create({ data: dto });
  }

  async update(id: string, dto: UpdateTeamDto): Promise<Team> {
    await this.findOne(id);
    return this.prisma.team.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.team.delete({ where: { id } });
  }
}
