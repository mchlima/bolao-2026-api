import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Season } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { CreateSeasonDto } from './dto/create-season.dto';
import { QuerySeasonsDto } from './dto/query-seasons.dto';
import { UpdateSeasonDto } from './dto/update-season.dto';

@Injectable()
export class SeasonsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QuerySeasonsDto,
  ): Promise<Paginated<Season & { matchCount: number }>> {
    const { page, pageSize, search, status, competitionId } = query;
    const where: Prisma.SeasonWhereInput = {
      ...(status && { status }),
      ...(competitionId && { competitionId }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.season.findMany({
        where,
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          competition: true,
          _count: { select: { matches: true } },
        },
      }),
      this.prisma.season.count({ where }),
    ]);

    const shaped = data.map(({ _count, ...s }) => ({
      ...s,
      matchCount: _count.matches,
    }));
    return paginated(shaped, total, page, pageSize);
  }

  async findOne(id: string): Promise<Season> {
    const season = await this.prisma.season.findUnique({
      where: { id },
      include: { competition: true },
    });
    if (!season) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Torneio não encontrado.',
      });
    }
    return season;
  }

  create(dto: CreateSeasonDto): Promise<Season> {
    return this.prisma.season.create({ data: dto });
  }

  async update(id: string, dto: UpdateSeasonDto): Promise<Season> {
    await this.findOne(id);
    return this.prisma.season.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.season.delete({ where: { id } });
  }
}
