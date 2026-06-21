import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { slugify } from './slug.util';

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
  constructor(private readonly prisma: PrismaService) {}

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
      ...(filter.categorySlug ? { category: { slug: filter.categorySlug } } : {}),
      ...(filter.tagSlug ? { tags: { some: { slug: filter.tagSlug } } } : {}),
    };
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

  /** Categorias com ≥1 matéria publicada (p/ sitemap, índice). */
  async listCategories(): Promise<TermPage[]> {
    const cats = await this.prisma.category.findMany({
      where: { items: { some: { status: 'APPROVED', slug: { not: null } } } },
      orderBy: { name: 'asc' },
      select: {
        name: true, slug: true, description: true,
        _count: { select: { items: { where: { status: 'APPROVED', slug: { not: null } } } } },
      },
    });
    return cats.map((c) => ({ name: c.name, slug: c.slug, description: c.description, total: c._count.items }));
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
      select: {
        name: true, slug: true, description: true,
        _count: { select: { items: { where: { status: 'APPROVED', slug: { not: null } } } } },
      },
    });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Categoria não encontrada.' });
    return { name: c.name, slug: c.slug, description: c.description, total: c._count.items };
  }

  async getTag(slug: string): Promise<TermPage> {
    const t = await this.prisma.tag.findUnique({
      where: { slug },
      select: {
        name: true, slug: true, description: true,
        _count: { select: { items: { where: { status: 'APPROVED', slug: { not: null } } } } },
      },
    });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tag não encontrada.' });
    return { name: t.name, slug: t.slug, description: t.description, total: t._count.items };
  }
}
