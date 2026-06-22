import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Competition, Prisma, Season, SeasonStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { slugify } from '../content/slug.util';
import { mergeExternalIds } from '../common/external-ids';
import { CreateCompetitionDto } from './dto/create-competition.dto';
import { QueryCompetitionsDto } from './dto/query-competitions.dto';
import { UpdateCompetitionDto } from './dto/update-competition.dto';

/** The current public-facing edition of a competition (for nav/hub deep links). */
export type ActiveSeason = Pick<
  Season,
  'id' | 'slug' | 'name' | 'seasonLabel' | 'status' | 'logoUrl'
>;

/**
 * Slug público de URL da competição (rotas /futebol/campeonato/:slug). Deriva do
 * nome dropando "FIFA" (como o slug de Season), ex.: "Copa do Mundo FIFA" →
 * "copa-do-mundo", "Brasileirão Série A" → "brasileirao-serie-a". Usado como
 * fallback quando `Competition.urlSlug` (persistido na migração) ainda é null.
 */
export function competitionUrlSlug(name: string): string {
  return slugify(name.replace(/\bFIFA\b/gi, '')) || 'campeonato';
}

@Injectable()
export class CompetitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryCompetitionsDto,
  ): Promise<
    Paginated<
      Competition & {
        urlSlug: string;
        seasonCount: number;
        sport: { id: string; slug: string; name: string };
        activeSeason: ActiveSeason | null;
      }
    >
  > {
    const { page, pageSize, search, type, sportId } = query;
    const where: Prisma.CompetitionWhereInput = {
      ...(type && { type }),
      ...(sportId && { sportId }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.competition.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { seasons: true } },
          sport: { select: { id: true, slug: true, name: true } },
        },
      }),
      this.prisma.competition.count({ where }),
    ]);

    const activeByCompetition = await this.resolveActiveSeasons(
      data.map((c) => c.id),
    );

    const shaped = data.map(({ _count, ...c }) => ({
      ...c,
      urlSlug: c.urlSlug ?? competitionUrlSlug(c.name),
      seasonCount: _count.seasons,
      activeSeason: activeByCompetition.get(c.id) ?? null,
    }));
    return paginated(shaped, total, page, pageSize);
  }

  /**
   * Resolve uma competição pelo slug PÚBLICO de URL (stored ou derivado) e devolve
   * com a temporada vigente — base da rota /futebol/campeonato/:slug, onde o front
   * pega `activeSeason.id` pra carregar agenda/tabela daquela season.
   */
  async findByUrlSlug(
    urlSlug: string,
  ): Promise<(Competition & { urlSlug: string; activeSeason: ActiveSeason | null }) | null> {
    const all = await this.prisma.competition.findMany();
    const match = all.find((c) => (c.urlSlug ?? competitionUrlSlug(c.name)) === urlSlug);
    if (!match) return null;
    const active = (await this.resolveActiveSeasons([match.id])).get(match.id) ?? null;
    return { ...match, urlSlug: match.urlSlug ?? competitionUrlSlug(match.name), activeSeason: active };
  }

  /**
   * Resolve the "active" public season for each competition, used by the nav and
   * the /futebol hub to deep-link a championship to its current edition.
   * Priority: ONGOING → next UPCOMING → most recent FINISHED. DRAFT and
   * slug-less seasons are excluded (the public hub route is keyed by slug).
   */
  private async resolveActiveSeasons(
    competitionIds: string[],
  ): Promise<Map<string, ActiveSeason>> {
    const out = new Map<string, ActiveSeason>();
    if (!competitionIds.length) return out;

    const seasons = await this.prisma.season.findMany({
      where: {
        competitionId: { in: competitionIds },
        slug: { not: null },
        status: { in: [SeasonStatus.ONGOING, SeasonStatus.UPCOMING, SeasonStatus.FINISHED] },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        seasonLabel: true,
        status: true,
        logoUrl: true,
        startDate: true,
        competitionId: true,
      },
    });

    // Lower rank wins. Within a rank: UPCOMING sorts by SOONEST start, the others
    // by MOST RECENT start (a tie keeps the latest edition / the live one).
    const rank: Record<SeasonStatus, number> = {
      [SeasonStatus.ONGOING]: 0,
      [SeasonStatus.UPCOMING]: 1,
      [SeasonStatus.FINISHED]: 2,
      [SeasonStatus.DRAFT]: 9,
    };
    const ms = (d: Date | null) => (d ? d.getTime() : 0);

    const byComp = new Map<string, typeof seasons>();
    for (const s of seasons) {
      const list = byComp.get(s.competitionId) ?? [];
      list.push(s);
      byComp.set(s.competitionId, list);
    }

    for (const [compId, list] of byComp) {
      list.sort((a, b) => {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        if (a.status === SeasonStatus.UPCOMING) return ms(a.startDate) - ms(b.startDate);
        return ms(b.startDate) - ms(a.startDate);
      });
      const best = list[0];
      out.set(compId, {
        id: best.id,
        slug: best.slug,
        name: best.name,
        seasonLabel: best.seasonLabel,
        status: best.status,
        logoUrl: best.logoUrl,
      });
    }
    return out;
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
