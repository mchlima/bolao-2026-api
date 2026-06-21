import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';

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

export interface NewsCard {
  slug: string;
  title: string;
  dek: string;
  category: string;
  tags: string[];
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

/**
 * Public (logged-out) read side of approved content — the organic-traffic surface.
 * Only APPROVED items with a slug are ever exposed; drafts/rejected stay private.
 */
@Injectable()
export class PublicNewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** When the article went public: review time, else original publish/creation. */
  private publishedAt(it: { reviewedAt: Date | null; publishedAt: Date | null; createdAt: Date }): Date {
    return it.reviewedAt ?? it.publishedAt ?? it.createdAt;
  }

  private toCard(it: {
    slug: string | null;
    seo: Prisma.JsonValue | null;
    generatedText: string | null;
    reviewedAt: Date | null;
    publishedAt: Date | null;
    createdAt: Date;
    feed: { name: string } | null;
    tags?: { name: string }[];
  }): NewsCard {
    const seo = (it.seo as Seo | null) ?? {};
    const { title } = splitArticle(it.generatedText);
    // Tags canônicas (entidades vinculadas na publicação); fallback p/ seo.tags em itens antigos.
    const linked = (it.tags ?? []).map((t) => t.name);
    return {
      slug: it.slug ?? '',
      title,
      dek: seo.dek ?? '',
      category: seo.category ?? '',
      tags: linked.length ? linked : (seo.tags ?? []),
      imageAlt: seo.imageAlt ?? '',
      publishedAt: this.publishedAt(it).toISOString(),
      source: it.feed?.name ?? null,
    };
  }

  async list(page: number, pageSize: number, category?: string): Promise<Paginated<NewsCard>> {
    const where: Prisma.NewsItemWhereInput = {
      status: 'APPROVED',
      slug: { not: null },
      ...(category ? { seo: { path: ['category'], equals: category } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.newsItem.findMany({
        where,
        orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          slug: true, seo: true, generatedText: true,
          reviewedAt: true, publishedAt: true, createdAt: true,
          feed: { select: { name: true } },
          tags: { select: { name: true }, orderBy: { name: 'asc' } },
        },
      }),
      this.prisma.newsItem.count({ where }),
    ]);
    return paginated(rows.map((r) => this.toCard(r)), total, page, pageSize);
  }

  async getBySlug(slug: string): Promise<NewsArticle> {
    const it = await this.prisma.newsItem.findFirst({
      where: { slug, status: 'APPROVED' },
      select: {
        slug: true, seo: true, generatedText: true,
        reviewedAt: true, publishedAt: true, createdAt: true, updatedAt: true,
        feed: { select: { name: true } },
        tags: { select: { name: true }, orderBy: { name: 'asc' } },
      },
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
}
