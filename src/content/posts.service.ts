import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NewsItem, Post, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { slugify } from './slug.util';
import { TagsService } from './tags.service';
import { CategoriesService } from './categories.service';
import { IndexNowService } from './indexnow.service';
import { CoverImageService } from './cover-image.service';
import { CreatePostDto, ListPostsQueryDto, UpdatePostDto } from './dto/post.dto';

/** Valores editáveis de um post (versão de trabalho). draft = este shape em JSON. */
interface PostWorking {
  title: string;
  slug: string;
  dek: string | null;
  body: string;
  seo: Prisma.JsonValue | null;
  categoryId: string | null;
  tagIds: string[];
}

interface TermRef {
  id: string;
  name: string;
  slug: string;
}

/** Linha da listagem do CMS. */
export interface PostListRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  featured: boolean;
  coverUrl: string | null;
  publishedAt: string | null;
  hasPendingChanges: boolean;
  category: { name: string; slug: string } | null;
  tagCount: number;
  fromEngine: boolean;
  createdAt: string;
  updatedAt: string;
}

/** View do editor: campos DE TRABALHO (draft ?? colunas) + estado de publicação. */
export interface PostView {
  id: string;
  status: string;
  featured: boolean;
  coverUrl: string | null;
  title: string;
  slug: string;
  dek: string | null;
  body: string;
  seo: Prisma.JsonValue | null;
  categoryId: string | null;
  tags: TermRef[];
  /** Slug atualmente no ar (coluna). Só relevante quando PUBLISHED. */
  publishedSlug: string | null;
  hasPendingChanges: boolean;
  publishedAt: string | null;
  fromEngine: boolean;
  createdAt: string;
  updatedAt: string;
}

type PostRow = Post & { tags: { id: string }[] };

/** generatedText = "manchete\n\ncorpo" → title + body. */
function splitArticle(text: string | null): { title: string; body: string } {
  const lines = (text ?? '').split('\n');
  return { title: (lines[0] ?? '').trim(), body: lines.slice(1).join('\n').trim() };
}

/** Mantém só o pacote SEO do artigo (metaTitle/…); o resto vira coluna/relação. */
function pickArticleSeo(seo: Prisma.JsonValue | null | undefined): Prisma.InputJsonValue | null {
  const s = (seo as Record<string, unknown> | null) ?? {};
  const out: Record<string, unknown> = {};
  for (const k of ['metaTitle', 'metaDescription', 'focusKeyword', 'keywords', 'keyTakeaways', 'faq', 'imageAlt']) {
    if (s[k] != null) out[k] = s[k];
  }
  return Object.keys(out).length ? (out as Prisma.InputJsonValue) : null;
}

/**
 * CMS de posts (o conteúdo que o admin gere de fato). Isolamento rascunho/publicado
 * via overlay `draft`: editar um post PUBLISHED grava só no draft — a cópia no ar não
 * muda até Publicar. Posts nascem de uma promoção da Revisão OU manualmente no CMS.
 */
@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tags: TagsService,
    private readonly categories: CategoriesService,
    private readonly indexNow: IndexNowService,
    private readonly cover: CoverImageService,
  ) {}

  /** Avisa o IndexNow (Bing/Yandex) que uma matéria entrou no ar. Fire-and-forget. */
  private pingPublished(slug: string): void {
    void this.indexNow.submit([`/noticias/${slug}`, '/noticias']);
  }

  // ───────────────────────────────────────────────────────── helpers

  /** Valores de trabalho: o overlay draft quando existe, senão as colunas publicadas. */
  private working(post: PostRow): PostWorking {
    const d = post.draft as Partial<PostWorking> | null;
    if (d) {
      return {
        title: d.title ?? post.title,
        slug: d.slug ?? post.slug,
        dek: d.dek ?? null,
        body: d.body ?? post.body,
        seo: (d.seo as Prisma.JsonValue) ?? null,
        categoryId: d.categoryId ?? null,
        tagIds: d.tagIds ?? post.tags.map((t) => t.id),
      };
    }
    return {
      title: post.title,
      slug: post.slug,
      dek: post.dek,
      body: post.body,
      seo: post.seo,
      categoryId: post.categoryId,
      tagIds: post.tags.map((t) => t.id),
    };
  }

  /** Slug de post único (dedup contra posts.slug), reaproveitável no create/save/publish. */
  private async uniqueSlug(base: string, excludeId: string | null): Promise<string> {
    const root = slugify(base) || 'post';
    let slug = root;
    for (let i = 2; i < 60; i++) {
      const clash = await this.prisma.post.findFirst({
        where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return slug;
      slug = `${root}-${i}`;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  private async findRow(id: string): Promise<PostRow> {
    const post = await this.prisma.post.findUnique({ where: { id }, include: { tags: { select: { id: true } } } });
    if (!post) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Post não encontrado.' });
    return post;
  }

  private async toView(post: PostRow): Promise<PostView> {
    const w = this.working(post);
    const tags = w.tagIds.length
      ? await this.prisma.tag.findMany({ where: { id: { in: w.tagIds } }, select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } })
      : [];
    return {
      id: post.id,
      status: post.status,
      featured: post.featured,
      coverUrl: post.coverUrl,
      title: w.title,
      slug: w.slug,
      dek: w.dek,
      body: w.body,
      seo: w.seo,
      categoryId: w.categoryId,
      tags,
      publishedSlug: post.status === 'PUBLISHED' ? post.slug : null,
      hasPendingChanges: post.draft != null,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      fromEngine: post.sourceItemId != null,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  }

  // ───────────────────────────────────────────────────────── leitura (admin)

  async list(q: ListPostsQueryDto): Promise<Paginated<PostListRow>> {
    const where: Prisma.PostWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.search?.trim() ? { title: { contains: q.search.trim(), mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { category: { select: { name: true, slug: true } }, _count: { select: { tags: true } } },
      }),
      this.prisma.post.count({ where }),
    ]);
    const data: PostListRow[] = rows.map((p) => {
      const d = p.draft as Partial<PostWorking> | null;
      return {
        id: p.id,
        title: d?.title ?? p.title,
        slug: p.slug,
        status: p.status,
        featured: p.featured,
        coverUrl: p.coverUrl,
        publishedAt: p.publishedAt?.toISOString() ?? null,
        hasPendingChanges: p.draft != null,
        category: p.category,
        tagCount: p._count.tags,
        fromEngine: p.sourceItemId != null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });
    return paginated(data, total, q.page, q.pageSize);
  }

  async getOne(id: string): Promise<PostView> {
    return this.toView(await this.findRow(id));
  }

  // ───────────────────────────────────────────────────────── escrita (admin)

  /** Cria um rascunho manual no CMS (autoria à mão, sem passar pela esteira). */
  async createManual(dto: CreatePostDto, adminId: string): Promise<PostView> {
    const slug = await this.uniqueSlug(dto.slug?.trim() || dto.title, null);
    const post = await this.prisma.post.create({
      data: {
        title: dto.title.trim(),
        slug,
        dek: dto.dek?.trim() || null,
        body: dto.body ?? '',
        seo: pickArticleSeo(dto.seo as Prisma.JsonValue) ?? Prisma.DbNull,
        status: 'DRAFT',
        categoryId: dto.categoryId ?? null,
        authorId: adminId,
        ...(dto.tagIds?.length ? { tags: { connect: dto.tagIds.map((tid) => ({ id: tid })) } } : {}),
      },
      include: { tags: { select: { id: true } } },
    });
    return this.toView(post);
  }

  /** Aplica o DTO sobre os valores de trabalho atuais. */
  private merge(cur: PostWorking, dto: UpdatePostDto): PostWorking {
    return {
      title: dto.title !== undefined ? dto.title.trim() : cur.title,
      slug: dto.slug !== undefined ? dto.slug.trim() : cur.slug,
      dek: dto.dek !== undefined ? dto.dek?.trim() || null : cur.dek,
      body: dto.body !== undefined ? dto.body : cur.body,
      seo: dto.seo !== undefined ? (pickArticleSeo(dto.seo as Prisma.JsonValue) as Prisma.JsonValue | null) : cur.seo,
      categoryId: dto.categoryId !== undefined ? dto.categoryId ?? null : cur.categoryId,
      tagIds: dto.tagIds !== undefined ? dto.tagIds : cur.tagIds,
    };
  }

  /**
   * Salva edições. PUBLISHED → grava no overlay `draft` (a cópia no ar não muda).
   * DRAFT/ARCHIVED → grava direto nas colunas (não há nada público a proteger).
   */
  async save(id: string, dto: UpdatePostDto): Promise<PostView> {
    const post = await this.findRow(id);
    const merged = this.merge(this.working(post), dto);
    if (!merged.title.trim()) {
      throw new BadRequestException({ code: 'NO_TITLE', message: 'O post precisa de um título.' });
    }
    if (post.status === 'PUBLISHED') {
      await this.prisma.post.update({
        where: { id },
        data: { draft: merged as unknown as Prisma.InputJsonValue },
      });
    } else {
      const slug = await this.uniqueSlug(merged.slug || merged.title, id);
      await this.prisma.post.update({
        where: { id },
        data: {
          title: merged.title,
          slug,
          dek: merged.dek,
          body: merged.body,
          seo: (merged.seo as Prisma.InputJsonValue) ?? Prisma.DbNull,
          categoryId: merged.categoryId,
          tags: { set: merged.tagIds.map((tid) => ({ id: tid })) },
          draft: Prisma.DbNull,
        },
      });
    }
    return this.getOne(id);
  }

  /** Publica: aplica o trabalho (draft) nas colunas, limpa o draft, marca PUBLISHED. */
  async publish(id: string, adminId: string): Promise<PostView> {
    const post = await this.findRow(id);
    const w = this.working(post);
    if (!w.title.trim() || !w.body.trim()) {
      throw new BadRequestException({ code: 'INCOMPLETE', message: 'Publique com título e corpo preenchidos.' });
    }
    const slug = await this.uniqueSlug(w.slug || w.title, id);
    await this.prisma.post.update({
      where: { id },
      data: {
        title: w.title,
        slug,
        dek: w.dek,
        body: w.body,
        seo: (w.seo as Prisma.InputJsonValue) ?? Prisma.DbNull,
        categoryId: w.categoryId,
        tags: { set: w.tagIds.map((tid) => ({ id: tid })) },
        status: 'PUBLISHED',
        publishedAt: post.publishedAt ?? new Date(),
        draft: Prisma.DbNull,
        authorId: post.authorId ?? adminId,
      },
    });
    this.pingPublished(slug);
    return this.getOne(id);
  }

  /** Tira do ar (mantém no CMS). */
  async archive(id: string): Promise<PostView> {
    const post = await this.findRow(id);
    if (post.status !== 'PUBLISHED') {
      throw new BadRequestException({ code: 'INVALID_STATE', message: 'Só dá para arquivar um post publicado.' });
    }
    await this.prisma.post.update({ where: { id }, data: { status: 'ARCHIVED' } });
    return this.getOne(id);
  }

  /** Descarta as alterações não publicadas (volta a servir a versão no ar). */
  async discardDraft(id: string): Promise<PostView> {
    await this.findRow(id);
    await this.prisma.post.update({ where: { id }, data: { draft: Prisma.DbNull } });
    return this.getOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findRow(id);
    await this.prisma.post.delete({ where: { id } });
  }

  /**
   * Liga/desliga o destaque editorial. Escreve a COLUNA direto (não passa pelo overlay
   * `draft`): destaque é colocação editorial, não conteúdo — vale na hora mesmo num
   * post publicado. O destaque sobe o post pro topo do público (manchete/hero).
   */
  async setFeatured(id: string, featured: boolean): Promise<PostView> {
    await this.findRow(id);
    await this.prisma.post.update({ where: { id }, data: { featured } });
    return this.getOne(id);
  }

  // ───────────────────────────────────────────── promoção da esteira → CMS

  /**
   * Cria um Post a partir de um NewsItem promovido na Revisão. publish=false → rascunho;
   * publish=true → já publica. Resolve taxonomia (seleção do admin ou sugestões do seo).
   * Chamado pelo NewsItemsService.promote (que valida estado e marca o item PROMOTED).
   */
  async createFromItem(
    item: NewsItem & { tags?: { id: string }[] },
    adminId: string,
    publish: boolean,
  ): Promise<Post> {
    if (await this.prisma.post.findUnique({ where: { sourceItemId: item.id }, select: { id: true } })) {
      throw new BadRequestException({ code: 'ALREADY_PROMOTED', message: 'Este item já virou um post.' });
    }
    const { title, body } = splitArticle(item.generatedText);
    const seo = (item.seo as Record<string, unknown> | null) ?? {};
    // Taxonomia: respeita a seleção do admin na revisão; senão auto-resolve dos nomes do seo.
    let categoryId = item.categoryId;
    if (!categoryId) {
      const cat = await this.categories.resolve(typeof seo.category === 'string' ? seo.category : '');
      categoryId = cat?.id ?? null;
    }
    let tagIds = (item.tags ?? []).map((t) => t.id);
    if (!tagIds.length) {
      const names = Array.isArray(seo.tags) ? (seo.tags.filter((x) => typeof x === 'string') as string[]) : [];
      tagIds = (await this.tags.resolve(names)).map((t) => t.id);
    }
    const slugBase = (typeof seo.slug === 'string' && seo.slug) || title || item.sourceTitle;
    const slug = await this.uniqueSlug(slugBase, null);
    const post = await this.prisma.post.create({
      data: {
        title: title || item.sourceTitle,
        slug,
        dek: typeof seo.dek === 'string' ? seo.dek : null,
        body,
        seo: pickArticleSeo(item.seo) ?? Prisma.DbNull,
        status: publish ? 'PUBLISHED' : 'DRAFT',
        publishedAt: publish ? new Date() : null,
        categoryId,
        sourceItemId: item.id,
        authorId: adminId,
        ...(tagIds.length ? { tags: { connect: tagIds.map((tid) => ({ id: tid })) } } : {}),
      },
    });
    // Capa de jogo (best-effort): matéria com matchId ganha capa gerada (escudos+placar).
    if (item.matchId) {
      const coverUrl = await this.cover.forMatch(item.matchId);
      if (coverUrl) {
        await this.prisma.post.update({ where: { id: post.id }, data: { coverUrl } });
        post.coverUrl = coverUrl;
      }
    }
    if (publish) this.pingPublished(slug);
    return post;
  }

  /** (Re)gera a capa de um post de jogo a partir do match vinculado (sourceItem.matchId). */
  async setCover(id: string): Promise<PostView> {
    const post = await this.prisma.post.findUnique({
      where: { id },
      select: { id: true, sourceItem: { select: { matchId: true } } },
    });
    if (!post) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Post não encontrado.' });
    const matchId = post.sourceItem?.matchId ?? null;
    if (!matchId) {
      throw new BadRequestException({ code: 'NO_MATCH', message: 'Este post não está vinculado a um jogo.' });
    }
    const coverUrl = await this.cover.forMatch(matchId);
    if (!coverUrl) {
      throw new BadRequestException({ code: 'COVER_FAILED', message: 'Não foi possível gerar a capa (escudos ou storage indisponível).' });
    }
    await this.prisma.post.update({ where: { id }, data: { coverUrl } });
    return this.getOne(id);
  }
}
