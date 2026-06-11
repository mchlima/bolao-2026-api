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
    const { page, pageSize, search, type, continent } = query;
    const where: Prisma.TeamWhereInput = {
      ...(type && { type }),
      ...(continent && { continent }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { shortName: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.team.count({ where }),
    ]);

    return paginated(data, total, page, pageSize);
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
