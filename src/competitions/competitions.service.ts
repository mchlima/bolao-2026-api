import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Competition, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { mergeExternalIds } from '../common/external-ids';
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
    const sportId = dto.sportId ?? (await this.defaultSportId());
    await this.assertSlugFree(sportId, dto.slug);
    // espnLeagueSlug is an API convenience; it's stored under externalIds.espn.slug.
    const { espnLeagueSlug, ...rest } = dto;
    return this.prisma.competition.create({
      data: {
        ...rest,
        sportId, // explicit value wins over rest.sportId (resolved/default above)
        ...(espnLeagueSlug
          ? { externalIds: { espn: { slug: espnLeagueSlug } } }
          : {}),
      },
    });
  }

  async update(id: string, dto: UpdateCompetitionDto): Promise<Competition> {
    const existing = await this.findOne(id);
    const sportId = dto.sportId ?? existing.sportId;
    if (dto.slug) await this.assertSlugFree(sportId, dto.slug, id);
    const { espnLeagueSlug, ...rest } = dto;
    const data: Prisma.CompetitionUpdateInput = { ...rest };
    if (espnLeagueSlug !== undefined) {
      // Merge so other providers' refs (e.g. ge) are preserved.
      data.externalIds = mergeExternalIds(existing.externalIds, 'espn', {
        slug: espnLeagueSlug || undefined,
      });
    }
    return this.prisma.competition.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.competition.delete({ where: { id } });
  }

  /** Default sport for competitions created without an explicit one (Futebol). */
  private async defaultSportId(): Promise<string> {
    const sport = await this.prisma.sport.findFirstOrThrow({
      where: { slug: 'futebol' },
    });
    return sport.id;
  }

  // Slug is unique PER SPORT, so the check is scoped to the competition's sport.
  private async assertSlugFree(
    sportId: string,
    slug: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.prisma.competition.findFirst({
      where: { sportId, slug },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: 'Já existe uma competição com esse slug.',
      });
    }
  }
}
