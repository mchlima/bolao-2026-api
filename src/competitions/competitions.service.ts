import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Competition, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { CreateCompetitionDto } from './dto/create-competition.dto';
import { QueryCompetitionsDto } from './dto/query-competitions.dto';
import { UpdateCompetitionDto } from './dto/update-competition.dto';

@Injectable()
export class CompetitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryCompetitionsDto,
  ): Promise<Paginated<Competition & { seasonCount: number }>> {
    const { page, pageSize, search, type } = query;
    const where: Prisma.CompetitionWhereInput = {
      ...(type && { type }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.competition.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { seasons: true } } },
      }),
      this.prisma.competition.count({ where }),
    ]);

    const shaped = data.map(({ _count, ...c }) => ({
      ...c,
      seasonCount: _count.seasons,
    }));
    return paginated(shaped, total, page, pageSize);
  }

  async findOne(id: string): Promise<Competition> {
    const competition = await this.prisma.competition.findUnique({
      where: { id },
    });
    if (!competition) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Competição não encontrada.',
      });
    }
    return competition;
  }

  async create(dto: CreateCompetitionDto): Promise<Competition> {
    await this.assertSlugFree(dto.slug);
    return this.prisma.competition.create({ data: dto });
  }

  async update(id: string, dto: UpdateCompetitionDto): Promise<Competition> {
    await this.findOne(id);
    if (dto.slug) await this.assertSlugFree(dto.slug, id);
    return this.prisma.competition.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.competition.delete({ where: { id } });
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.competition.findUnique({
      where: { slug },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: 'Já existe uma competição com esse slug.',
      });
    }
  }
}
