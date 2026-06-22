import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { CategoriesService } from './categories.service';

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
  updatedAt: string;
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
  /** Caminho raiz→folha da categoria (Futebol > Copa do Mundo > 2026), p/ breadcrumb. */
  categoryPath: TermRef[];
}

/** Pacote SEO/GEO manual da página de um termo (categoria/tag). */
export interface TermSeo {
  metaTitle?: string;
  metaDescription?: string;
  heading?: string;
  intro?: string;
  faq?: { question: string; answer: string }[];
}

/** Cabeçalho de uma página de categoria/tag (nome + descrição + total). */
export interface TermPage extends TermRef {
  description: string | null;
  total: number;
  /** Metadados SEO/GEO editados à mão pelo admin (manchete/meta/intro/FAQ da página). */
  seo: TermSeo | null;
  /** Listagem de categorias: slug do pai na árvore (p/ montar o menu hierárquico). */
  parentSlug?: string | null;
  /** Categoria: caminho raiz→nó p/ breadcrumb (Futebol > Copa do Mundo > 2026). */
  path?: TermRef[];
}

type CardRow = {
  slug: string;
  title: string;
  dek: string | null;
  seo: Prisma.JsonValue | null;
  publishedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  category: { name: string; slug: string } | null;
  tags?: { name: string; slug: string }[];
  sourceItem?: { feed: { name: string } | null } | null;
};

const CARD_SELECT = {
  slug: true, title: true, dek: true, seo: true,
  publishedAt: true, updatedAt: true, createdAt: true,
  category: { select: { name: true, slug: true } },
  tags: { select: { name: true, slug: true }, orderBy: { name: 'asc' as const } },
  sourceItem: { select: { feed: { select: { name: true } } } },
};

/**
 * Public (logged-out) read side — the organic-traffic surface. Lê POSTS publicados
 * (status=PUBLISHED) do CMS; rascunhos/arquivados ficam privados. NewsItem (esteira)
 * nunca é exposto: só vira público quando promovido a Post e publicado.
 */
@Injectable()
export class PublicNewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  private toCard(it: CardRow): NewsCard {
    const seo = (it.seo as Seo | null) ?? {};
    const category: TermRef | null = it.category ? { name: it.category.name, slug: it.category.slug } : null;
    const tags: TermRef[] = (it.tags ?? []).map((t) => ({ name: t.name, slug: t.slug }));
    return {
      slug: it.slug,
      title: it.title,
      dek: it.dek ?? '',
      category,
      tags,
      imageAlt: seo.imageAlt ?? '',
      publishedAt: (it.publishedAt ?? it.createdAt).toISOString(),
      updatedAt: it.updatedAt.toISOString(),
      source: it.sourceItem?.feed?.name ?? null,
    };
  }

  /** Lista de matérias publicadas, opcionalmente filtrada por categoria/tag (slug da entidade). */
  async list(
    page: number,
    pageSize: number,
    filter: { categorySlug?: string; tagSlug?: string } = {},
  ): Promise<Paginated<NewsCard>> {
    const where: Prisma.PostWhereInput = {
      status: 'PUBLISHED',
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
      this.prisma.post.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: CARD_SELECT,
      }),
      this.prisma.post.count({ where }),
    ]);
    return paginated(rows.map((r) => this.toCard(r)), total, page, pageSize);
  }

  async getBySlug(slug: string): Promise<NewsArticle> {
    const it = await this.prisma.post.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { ...CARD_SELECT, body: true, updatedAt: true, category: { select: { id: true, name: true, slug: true } } },
    });
    if (!it) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Matéria não encontrada.' });
    const seo = (it.seo as Seo | null) ?? {};
    // Caminho completo da categoria (ancestrais → folha) p/ o breadcrumb do artigo.
    const categoryPath: TermRef[] = it.category
      ? (await this.categories.pathOf(it.category.id)).map((x) => ({ name: x.name, slug: x.slug }))
      : [];
    return {
      ...this.toCard(it),
      title: it.title,
      body: it.body,
      metaTitle: seo.metaTitle || it.title,
      metaDescription: seo.metaDescription ?? '',
      focusKeyword: seo.focusKeyword ?? '',
      keywords: seo.keywords ?? [],
      keyTakeaways: seo.keyTakeaways ?? [],
      faq: seo.faq ?? [],
      updatedAt: it.updatedAt.toISOString(),
      categoryPath,
    };
  }

  // ───────────────────────────────────────────── categorias/tags (público)

  /**
   * Categorias com matéria publicada (própria OU em descendente) — p/ hub + sitemap.
   * A contagem da pai inclui as filhas (roll-up), pois a página da pai mostra tudo abaixo.
   */
  async listCategories(): Promise<TermPage[]> {
    const grouped = await this.prisma.post.groupBy({
      by: ['categoryId'],
      where: { status: 'PUBLISHED', categoryId: { not: null } },
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
      .map((c) => ({
        name: c.name, slug: c.slug, description: c.description, total: total.get(c.id)!, seo: null,
        // slug do pai (não o id) p/ o front montar a árvore do menu sem expor ids.
        parentSlug: c.parentId ? (byId.get(c.parentId)?.slug ?? null) : null,
      }));
  }

  async listTags(): Promise<TermPage[]> {
    const tags = await this.prisma.tag.findMany({
      where: { posts: { some: { status: 'PUBLISHED' } } },
      orderBy: { name: 'asc' },
      select: {
        name: true, slug: true, description: true,
        _count: { select: { posts: { where: { status: 'PUBLISHED' } } } },
      },
    });
    return tags.map((t) => ({ name: t.name, slug: t.slug, description: t.description, total: t._count.posts, seo: null }));
  }

  async getCategory(slug: string): Promise<TermPage> {
    const c = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, description: true, seo: true },
    });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Categoria não encontrada.' });
    // total = matérias da categoria E descendentes (a página da pai mostra tudo abaixo).
    const ids = await this.categories.descendantIds(c.id);
    const total = await this.prisma.post.count({
      where: { status: 'PUBLISHED', categoryId: { in: ids } },
    });
    // 404 quando não há matéria (própria/descendente): evita página vazia (soft-404).
    if (total === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Categoria não encontrada.' });
    const chain = await this.categories.pathOf(c.id);
    return {
      name: c.name, slug: c.slug, description: c.description, total,
      seo: (c.seo as TermSeo | null) ?? null,
      path: chain.map((x) => ({ name: x.name, slug: x.slug })),
    };
  }

  async getTag(slug: string): Promise<TermPage> {
    const t = await this.prisma.tag.findUnique({
      where: { slug },
      select: {
        name: true, slug: true, description: true, seo: true,
        _count: { select: { posts: { where: { status: 'PUBLISHED' } } } },
      },
    });
    if (!t || t._count.posts === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tag não encontrada.' });
    }
    return { name: t.name, slug: t.slug, description: t.description, total: t._count.posts, seo: (t.seo as TermSeo | null) ?? null };
  }
}
