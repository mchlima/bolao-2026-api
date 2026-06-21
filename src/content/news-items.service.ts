import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NewsItem, Post, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { ContentProcessService } from './content-process.service';
import { ListItemsQueryDto, ReprocessItemDto, UpdateItemSeoDto, UpdateItemTaxonomyDto } from './dto/news-item.dto';
import { PostsService } from './posts.service';

@Injectable()
export class NewsItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly process: ContentProcessService,
    private readonly posts: PostsService,
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
        category: { select: { id: true, name: true, slug: true } },
        tags: { select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } },
        revisions: { orderBy: { attempt: 'desc' } },
        duplicateOf: { select: { id: true, sourceTitle: true } },
        duplicates: { select: { id: true, sourceTitle: true, feed: { select: { name: true } } } },
      },
    });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item não encontrado.' });
    return item;
  }

  /**
   * Promove um item da Revisão pro CMS: cria um Post (rascunho, ou já publicado se
   * publish=true) e marca o item como PROMOTED. O item NUNCA vira público sozinho —
   * o público lê Post. Devolve o Post criado (a UI navega pro editor do CMS).
   */
  async promote(id: string, adminId: string, publish: boolean): Promise<Post> {
    const item = await this.getOne(id);
    if (item.status !== 'PENDING_REVIEW') {
      throw new BadRequestException({ code: 'INVALID_STATE', message: 'Só dá para promover itens em revisão.' });
    }
    const post = await this.posts.createFromItem(item, adminId, publish);
    await this.prisma.newsItem.update({
      where: { id },
      data: { status: 'PROMOTED', reviewedById: adminId, reviewedAt: new Date() },
    });
    return post;
  }

  /** Admin seleciona categoria + tags (entidades) na revisão — sobrepõe os sugeridos. */
  async updateTaxonomy(id: string, dto: UpdateItemTaxonomyDto): Promise<NewsItem> {
    await this.getOne(id);
    const data: Prisma.NewsItemUpdateInput = {};
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId ? { connect: { id: dto.categoryId } } : { disconnect: true };
    }
    if (dto.tagIds !== undefined) {
      data.tags = { set: dto.tagIds.map((tid) => ({ id: tid })) };
    }
    await this.prisma.newsItem.update({ where: { id }, data });
    return this.getOne(id);
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
    // seo guarda só os METADADOS (strings sugeridas). O VÍNCULO de categoria/tags-entidade
    // é feito pelo endpoint dedicado updateTaxonomy (seleção do admin) / pelo approve.
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
