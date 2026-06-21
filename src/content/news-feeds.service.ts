import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NewsFeed, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { ContentIngestService, FeedPreview, FetchResult } from './content-ingest.service';
import { CreateNewsFeedDto, UpdateNewsFeedDto } from './dto/news-feed.dto';

@Injectable()
export class NewsFeedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: ContentIngestService,
  ) {}

  async list(page: number, pageSize: number, search?: string): Promise<Paginated<NewsFeed>> {
    const where: Prisma.NewsFeedWhereInput = search
      ? { name: { contains: search, mode: 'insensitive' } }
      : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.newsFeed.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { items: true } }, defaultTone: { select: { id: true, name: true } } },
      }),
      this.prisma.newsFeed.count({ where }),
    ]);
    return paginated(data, total, page, pageSize);
  }

  async getOne(id: string): Promise<NewsFeed> {
    const feed = await this.prisma.newsFeed.findUnique({
      where: { id },
      include: { _count: { select: { items: true } }, defaultTone: { select: { id: true, name: true } } },
    });
    if (!feed) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Feed não encontrado.' });
    return feed;
  }

  async create(dto: CreateNewsFeedDto): Promise<NewsFeed> {
    await this.assertToneExists(dto.defaultToneId);
    try {
      return await this.prisma.newsFeed.create({
        data: {
          name: dto.name.trim(),
          url: dto.url.trim(),
          ...(dto.type && { type: dto.type }),
          ...(dto.config !== undefined && { config: dto.config as Prisma.InputJsonValue }),
          ...(dto.sport?.trim() && { sport: dto.sport.trim() }),
          ...(dto.focus !== undefined && { focus: dto.focus?.trim() || null }),
          ...(dto.defaultToneId && { defaultToneId: dto.defaultToneId }),
          ...(dto.fetchIntervalMin !== undefined && { fetchIntervalMin: dto.fetchIntervalMin }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  async update(id: string, dto: UpdateNewsFeedDto): Promise<NewsFeed> {
    await this.getOne(id);
    if (dto.defaultToneId) await this.assertToneExists(dto.defaultToneId);
    const data: Prisma.NewsFeedUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.url !== undefined && { url: dto.url.trim() }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.config !== undefined && {
        config: (dto.config ?? Prisma.DbNull) as Prisma.InputJsonValue,
      }),
      ...(dto.sport !== undefined && { sport: dto.sport.trim() }),
      ...(dto.focus !== undefined && { focus: dto.focus?.trim() || null }),
      ...(dto.fetchIntervalMin !== undefined && { fetchIntervalMin: dto.fetchIntervalMin }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    if (dto.defaultToneId !== undefined) {
      data.defaultTone = dto.defaultToneId
        ? { connect: { id: dto.defaultToneId } }
        : { disconnect: true };
    }
    try {
      return await this.prisma.newsFeed.update({ where: { id }, data });
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  async remove(id: string): Promise<void> {
    await this.getOne(id);
    await this.prisma.newsFeed.delete({ where: { id } });
  }

  /** Trigger an immediate fetch; returns inserted/found/stale counts. */
  async fetchNow(id: string): Promise<FetchResult> {
    await this.getOne(id);
    return this.ingest.fetchFeed(id);
  }

  /** Validate/preview an RSS URL before saving (admin "testar"). */
  async preview(url: string): Promise<FeedPreview> {
    try {
      return await this.ingest.preview(url);
    } catch (e) {
      throw new BadRequestException({
        code: 'INVALID_FEED',
        message: `Não consegui ler esse RSS: ${(e as Error).message}`,
      });
    }
  }

  private async assertToneExists(toneId?: string | null): Promise<void> {
    if (!toneId) return;
    const tone = await this.prisma.newsTone.findUnique({ where: { id: toneId } });
    if (!tone) {
      throw new BadRequestException({ code: 'TONE_NOT_FOUND', message: 'Tom padrão não existe.' });
    }
  }

  private mapUnique(e: unknown): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException({ code: 'DUPLICATE_URL', message: 'Já existe um feed com essa URL.' });
    }
    return e as Error;
  }
}
