import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Tag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { slugify } from './slug.util';
import { cleanTermSeo } from './term-seo.util';
import { CreateTaxonomyDto, UpdateTaxonomyDto } from './dto/news-taxonomy.dto';

/**
 * Tags são ENTIDADES. A geração só sugere nomes (seo.tags, strings); aqui eles viram
 * registros canônicos: resolve() VALIDA se a tag já existe (por slug) e só CRIA se não —
 * nunca duplica "Brasil"/"brasil"/"BRASIL". Tem CRUD no admin + página pública.
 */
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nomes → entidades Tag (find-or-create por slug, deduplicado, ordem preservada). */
  async resolve(names: string[]): Promise<Tag[]> {
    const out: Tag[] = [];
    const seen = new Set<string>();
    for (const raw of names ?? []) {
      const name = (raw ?? '').trim();
      if (!name) continue;
      const slug = slugify(name);
      if (!slug || seen.has(slug)) continue; // vazio ou repetido na mesma lista
      seen.add(slug);
      // upsert por slug único = "valida se existe, cria se não" de forma atômica (race-safe).
      const tag = await this.prisma.tag.upsert({
        where: { slug },
        create: { slug, name },
        update: {}, // já existe: mantém a grafia de quem criou primeiro
      });
      out.push(tag);
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────── CRUD (admin)

  async list(page: number, pageSize: number, q?: string): Promise<Paginated<Tag>> {
    const where: Prisma.TagWhereInput = q?.trim()
      ? { name: { contains: q.trim(), mode: 'insensitive' } }
      : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.tag.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { posts: true } } },
      }),
      this.prisma.tag.count({ where }),
    ]);
    // _count.items mantém o contrato do admin, mas conta POSTS (o conteúdo real do CMS).
    const mapped = data.map((t) => ({ ...t, _count: { items: t._count.posts } }));
    return paginated(mapped, total, page, pageSize);
  }

  async getOne(id: string): Promise<Tag> {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tag não encontrada.' });
    return tag;
  }

  async create(dto: CreateTaxonomyDto): Promise<Tag> {
    const slug = await this.uniqueSlug(slugify(dto.slug?.trim() || dto.name));
    return this.prisma.tag.create({
      data: {
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim() || null,
        ...(dto.seo !== undefined && { seo: cleanTermSeo(dto.seo) ?? Prisma.DbNull }),
      },
    });
  }

  /** Renomeia/descreve — o slug é estável (não muda a URL pública). */
  async update(id: string, dto: UpdateTaxonomyDto): Promise<Tag> {
    await this.getOne(id);
    return this.prisma.tag.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name.trim() }),
        // description pode chegar null (limpar) — guarda contra null.trim().
        ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
        // seo: undefined = não mexe; {}/null/vazio = limpa (DbNull); senão grava saneado.
        ...(dto.seo !== undefined && { seo: cleanTermSeo(dto.seo) ?? Prisma.DbNull }),
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.getOne(id);
    // m2m implícito: apagar a tag remove os vínculos (join) automaticamente.
    await this.prisma.tag.delete({ where: { id } });
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = base || 'tag';
    let slug = root;
    for (let i = 2; i < 60; i++) {
      const exists = await this.prisma.tag.findUnique({ where: { slug } });
      if (!exists) return slug;
      slug = `${root}-${i}`;
    }
    throw new BadRequestException({ code: 'SLUG_CLASH', message: 'Não consegui gerar um slug único.' });
  }
}
