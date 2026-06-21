import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { slugify } from './slug.util';
import { CategoriesService } from './categories.service';

/** generatedText = "manchete\n\ncorpo" → split into title + body. */
function splitArticle(text: string | null): { title: string; body: string } {
  const lines = (text ?? '').split('\n');
  return { title: (lines[0] ?? '').trim(), body: lines.slice(1).join('\n').trim() };
}

interface Seo {
  dek?: string;
  metaTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  keywords?: string[];
  category?: string;
  tags?: string[];
  keyTakeaways?: string[];
  faq?: { question: string; answer: string }[];
  imageAlt?: string;
}

/** Entidade leve (nome + slug) usada nos links de categoria/tag. */
export interface TermRef {
  name: string;
  slug: string;
}

export interface NewsCard {
  slug: string;
  title: string;
  dek: string;
  category: TermRef | null;
  tags: TermRef[];
  imageAlt: string;
  publishedAt: string;
  source: string | null;
}

export interface NewsArticle extends NewsCard {
  body: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  keywords: string[];
  keyTakeaways: string[];
  faq: { question: string; answer: string }[];
  updatedAt: string;
}

/** Cabeçalho de uma página de categoria/tag (nome + descrição + total). */
export interface TermPage extends TermRef {
  description: string | null;
  total: number;
  /** Categoria: caminho raiz→nó p/ breadcrumb (Futebol > Copa do Mundo > 2026). */
  path?: TermRef[];
}

type CardRow = {
  slug: string | null;
  seo: Prisma.JsonValue | null;
  generatedText: string | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  feed: { name: string } | null;
  category: { name: string; slug: string } | null;
  tags?: { name: string; slug: string }[];
};

const CARD_SELECT = {
  slug: true, seo: true, generatedText: true,
  reviewedAt: true, publishedAt: true, createdAt: true,
  feed: { select: { name: true } },
  category: { select: { name: true, slug: true } },
  tags: { select: { name: true, slug: true }, orderBy: { name: 'asc' as const } },
};

/**
 * Public (logged-out) read side of approved content — the organic-traffic surface.
 * Only APPROVED items with a slug are ever exposed; drafts/rejected stay private.
 */
@Injectable()
export class PublicNewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  private publishedAt(it: { reviewedAt: Date | null; publishedAt: Date | null; createdAt: Date }): Date {
    return it.reviewedAt ?? it.publishedAt ?? it.createdAt;
  }

  private toCard(it: CardRow): NewsCard {
    const seo = (it.seo as Seo | null) ?? {};
    const { title } = splitArticle(it.generatedText);
    // Categoria/tags canônicas (entidades vinculadas na publicação); fallback p/ seo.* em itens antigos.
    const category: TermRef | null = it.category
      ? { name: it.category.name, slug: it.category.slug }
      : seo.category
        ? { name: seo.category, slug: slugify(seo.category) }
        : null;
    const linked = it.tags ?? [];
    const tags: TermRef[] = linked.length
      ? linked.map((t) => ({ name: t.name, slug: t.slug }))
      : (seo.tags ?? []).map((t) => ({ name: t, slug: slugify(t) }));
    return {
      slug: it.slug ?? '',
      title,
      dek: seo.dek ?? '',
      category,
      tags,
      imageAlt: seo.imageAlt ?? '',
      publishedAt: this.publishedAt(it).toISOString(),
      source: it.feed?.name ?? null,
    };
  }

  /** Lista de matérias publicadas, opcionalmente filtrada por categoria/tag (slug da entidade). */
  async list(
    page: number,
    pageSize: number,
    filter: { categorySlug?: string; tagSlug?: string } = {},
  ): Promise<Paginated<NewsCard>> {
    const where: Prisma.NewsItemWhereInput = {
      status: 'APPROVED',
      slug: { not: null },
      ...(filter.tagSlug ? { tags: { some: { slug: filter.tagSlug } } } : {}),
    };
    // Categoria: inclui a categoria E suas descendentes (página da pai mostra tudo abaixo).
    if (filter.categorySlug) {
      const cat = await this.prisma.category.findUnique({
        where: { slug: filter.categorySlug }, select: { id: true },
      });
      where.categoryId = { in: cat ? await this.categories.descendantIds(cat.id) : ['__none__'] };
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.newsItem.findMany({
        where,
        orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: CARD_SELECT,
      }),
      this.prisma.newsItem.count({ where }),
    ]);
    return paginated(rows.map((r) => this.toCard(r)), total, page, pageSize);
  }

  async getBySlug(slug: string): Promise<NewsArticle> {
    const it = await this.prisma.newsItem.findFirst({
      where: { slug, status: 'APPROVED' },
      select: { ...CARD_SELECT, updatedAt: true },
    });
    if (!it) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Matéria não encontrada.' });
    const seo = (it.seo as Seo | null) ?? {};
    const { title, body } = splitArticle(it.generatedText);
    return {
      ...this.toCard(it),
      title,
      body,
      metaTitle: seo.metaTitle || title,
      metaDescription: seo.metaDescription ?? '',
      focusKeyword: seo.focusKeyword ?? '',
      keywords: seo.keywords ?? [],
      keyTakeaways: seo.keyTakeaways ?? [],
      faq: seo.faq ?? [],
      updatedAt: it.updatedAt.toISOString(),
    };
  }

  // ───────────────────────────────────────────── categorias/tags (público)

  /**
   * Categorias com matéria publicada (própria OU em descendente) — p/ hub + sitemap.
   * A contagem da pai inclui as filhas (roll-up), pois a página da pai mostra tudo abaixo.
   */
  async listCategories(): Promise<TermPage[]> {
    const grouped = await this.prisma.newsItem.groupBy({
      by: ['categoryId'],
      where: { status: 'APPROVED', slug: { not: null }, categoryId: { not: null } },
      _count: { _all: true },
    });
    const direct = new Map<string, number>();
    for (const g of grouped) if (g.categoryId) direct.set(g.categoryId, g._count._all);
    if (!direct.size) return [];
    const cats = await this.prisma.category.findMany({
      select: { id: true, name: true, slug: true, description: true, parentId: true },
    });
    const byId = new Map(cats.map((c) => [c.id, c]));
    const total = new Map<string, number>();
    for (const c of cats) {
      const n = direct.get(c.id) ?? 0;
      if (!n) continue;
      let cur: typeof c | undefined = c;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        total.set(cur.id, (total.get(cur.id) ?? 0) + n);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return cats
      .filter((c) => total.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map((c) => ({ name: c.name, slug: c.slug, description: c.description, total: total.get(c.id)! }));
  }

  async listTags(): Promise<TermPage[]> {
    const tags = await this.prisma.tag.findMany({
      where: { items: { some: { status: 'APPROVED', slug: { not: null } } } },
      orderBy: { name: 'asc' },
      select: {
        name: true, slug: true, description: true,
        _count: { select: { items: { where: { status: 'APPROVED', slug: { not: null } } } } },
      },
    });
    return tags.map((t) => ({ name: t.name, slug: t.slug, description: t.description, total: t._count.items }));
  }

  async getCategory(slug: string): Promise<TermPage> {
    const c = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, description: true },
    });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Categoria não encontrada.' });
    // total = matérias da categoria E descendentes (a página da pai mostra tudo abaixo).
    const ids = await this.categories.descendantIds(c.id);
    const total = await this.prisma.newsItem.count({
      where: { status: 'APPROVED', slug: { not: null }, categoryId: { in: ids } },
    });
    // 404 quando não há matéria (própria/descendente): evita página vazia (soft-404).
    if (total === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Categoria não encontrada.' });
    const chain = await this.categories.pathOf(c.id);
    return {
      name: c.name, slug: c.slug, description: c.description, total,
      path: chain.map((x) => ({ name: x.name, slug: x.slug })),
    };
  }

  async getTag(slug: string): Promise<TermPage> {
    const t = await this.prisma.tag.findUnique({
      where: { slug },
      select: {
        name: true, slug: true, description: true,
        _count: { select: { items: { where: { status: 'APPROVED', slug: { not: null } } } } },
      },
    });
    if (!t || t._count.items === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tag não encontrada.' });
    }
    return { name: t.name, slug: t.slug, description: t.description, total: t._count.items };
  }
}
