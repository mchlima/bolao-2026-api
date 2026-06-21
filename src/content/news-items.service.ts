import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NewsItem, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { ContentProcessService } from './content-process.service';
import { ListItemsQueryDto, ReprocessItemDto, UpdateItemSeoDto } from './dto/news-item.dto';

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'materia'
  );
}

@Injectable()
export class NewsItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly process: ContentProcessService,
  ) {}

  async list(q: ListItemsQueryDto): Promise<Paginated<NewsItem>> {
    const where: Prisma.NewsItemWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.feedId && { feedId: q.feedId }),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.newsItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          feed: { select: { id: true, name: true } },
          tone: { select: { id: true, name: true } },
          duplicateOf: { select: { id: true, sourceTitle: true } },
        },
      }),
      this.prisma.newsItem.count({ where }),
    ]);
    return paginated(data, total, q.page, q.pageSize);
  }

  async getOne(id: string): Promise<NewsItem> {
    const item = await this.prisma.newsItem.findUnique({
      where: { id },
      include: {
        feed: { select: { id: true, name: true } },
        tone: { select: { id: true, name: true } },
        revisions: { orderBy: { attempt: 'desc' } },
        duplicateOf: { select: { id: true, sourceTitle: true } },
        duplicates: { select: { id: true, sourceTitle: true, feed: { select: { name: true } } } },
      },
    });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item não encontrado.' });
    return item;
  }

  async approve(id: string, adminId: string): Promise<NewsItem> {
    const item = await this.getOne(id);
    if (item.status !== 'PENDING_REVIEW') {
      throw new BadRequestException({ code: 'INVALID_STATE', message: 'Só dá para aprovar itens em revisão.' });
    }
    // Aprovar = publicar no site. Promove um slug público estável (único) a partir do
    // slug do SEO, com a manchete como fallback. Reusa o existente em reaprovações.
    const slug = item.slug ?? (await this.publicSlug(id, item.seo, item.generatedText));
    return this.prisma.newsItem.update({
      where: { id },
      data: { status: 'APPROVED', slug, reviewedById: adminId, reviewedAt: new Date() },
    });
  }

  /** Unique public slug: seo.slug → manchete → fallback, deduped against news_items.slug. */
  private async publicSlug(
    id: string,
    seo: Prisma.JsonValue | null,
    generatedText: string | null,
  ): Promise<string> {
    const seoSlug = (seo as { slug?: unknown } | null)?.slug;
    const headline = (generatedText ?? '').split('\n')[0] ?? '';
    const base = slugify((typeof seoSlug === 'string' && seoSlug) || headline || 'materia');
    let slug = base;
    for (let i = 2; i < 60; i++) {
      const clash = await this.prisma.newsItem.findFirst({ where: { slug, id: { not: id } }, select: { id: true } });
      if (!clash) return slug;
      slug = `${base}-${i}`;
    }
    return `${base}-${id.slice(-6)}`;
  }

  async reject(id: string, adminId: string): Promise<NewsItem> {
    const item = await this.getOne(id);
    if (!['PENDING_REVIEW', 'FAILED', 'FILTERED'].includes(item.status)) {
      throw new BadRequestException({ code: 'INVALID_STATE', message: 'Este item não pode ser rejeitado.' });
    }
    return this.prisma.newsItem.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: adminId, reviewedAt: new Date() },
    });
  }

  /** Re-run generation with an editor steer (appends a revision). */
  async reprocess(id: string, dto: ReprocessItemDto): Promise<NewsItem> {
    await this.process.reprocess(id, dto.guidance?.trim() || null, dto.toneId ?? null, dto.force ?? false);
    return this.getOne(id);
  }

  /** Override the auto-filter / a rejection / a dedup suppression: generate from the existing facts. */
  async rescue(id: string, force = false): Promise<NewsItem> {
    const item = await this.getOne(id);
    if (!['FILTERED', 'REJECTED', 'DUPLICATE'].includes(item.status)) {
      throw new BadRequestException({ code: 'INVALID_STATE', message: 'Só faz sentido resgatar item filtrado, rejeitado ou duplicado.' });
    }
    if (!item.facts) {
      throw new BadRequestException({ code: 'NO_FACTS', message: 'Item sem fatos extraídos para gerar.' });
    }
    await this.process.reprocess(id, null, null, force);
    // Resgatado vira matéria própria — desfaz o vínculo de duplicata.
    if (item.duplicateOfId) {
      await this.prisma.newsItem.update({ where: { id }, data: { duplicateOfId: null } });
    }
    return this.getOne(id);
  }

  /** Editor polish of the SEO/GEO package: merge the sent fields onto the generated seo. */
  async updateSeo(id: string, dto: UpdateItemSeoDto): Promise<NewsItem> {
    const item = await this.getOne(id);
    const current = (item.seo as Record<string, unknown> | null) ?? {};
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const merged = { ...current, ...patch } as Prisma.InputJsonValue;
    return this.prisma.newsItem.update({ where: { id }, data: { seo: merged } });
  }

  async remove(id: string): Promise<void> {
    await this.getOne(id);
    await this.prisma.newsItem.delete({ where: { id } });
  }

  /** Plain-text/markdown export of the approved (or generated) article. */
  async export(id: string): Promise<{ filename: string; content: string }> {
    const item = await this.getOne(id);
    if (!item.generatedText) {
      throw new BadRequestException({ code: 'NO_TEXT', message: 'Item ainda não tem texto gerado.' });
    }
    const content = [
      item.generatedText.trim(),
      '',
      '---',
      `Fonte: ${item.sourceTitle} — ${item.sourceUrl}`,
    ].join('\n');
    return { filename: `materia-${id}.md`, content };
  }
}
