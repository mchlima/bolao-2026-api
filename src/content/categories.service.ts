import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Category, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { slugify } from './slug.util';
import { CreateTaxonomyDto, UpdateTaxonomyDto } from './dto/news-taxonomy.dto';

/**
 * Categoria é ENTIDADE (1 artigo → 1 categoria). A geração sugere o nome em seo.category;
 * ao PUBLICAR, resolve() valida por slug (find-or-create) — nunca duplica. CRUD no admin +
 * página pública. Mesma higiene da tag: só matéria publicada cria/usa a entidade.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nome → entidade Categoria (find-or-create por slug); null se vazio. */
  async resolve(name: string | null | undefined): Promise<Category | null> {
    const n = (name ?? '').trim();
    if (!n) return null;
    const slug = slugify(n);
    if (!slug) return null;
    return this.prisma.category.upsert({
      where: { slug },
      create: { slug, name: n },
      update: {},
    });
  }

  // ─────────────────────────────────────────────────────────── CRUD (admin)

  async list(page: number, pageSize: number, q?: string): Promise<Paginated<Category>> {
    const where: Prisma.CategoryWhereInput = q?.trim()
      ? { name: { contains: q.trim(), mode: 'insensitive' } }
      : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.category.count({ where }),
    ]);
    return paginated(data, total, page, pageSize);
  }

  async getOne(id: string): Promise<Category> {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Categoria não encontrada.' });
    return cat;
  }

  async create(dto: CreateTaxonomyDto): Promise<Category> {
    const slug = await this.uniqueSlug(slugify(dto.slug?.trim() || dto.name));
    return this.prisma.category.create({
      data: { name: dto.name.trim(), slug, description: dto.description?.trim() || null },
    });
  }

  async update(id: string, dto: UpdateTaxonomyDto): Promise<Category> {
    await this.getOne(id);
    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.getOne(id);
    // onDelete: SetNull no schema → os artigos ficam sem categoria (não apaga matéria).
    await this.prisma.category.delete({ where: { id } });
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = base || 'categoria';
    let slug = root;
    for (let i = 2; i < 60; i++) {
      const exists = await this.prisma.category.findUnique({ where: { slug } });
      if (!exists) return slug;
      slug = `${root}-${i}`;
    }
    throw new BadRequestException({ code: 'SLUG_CLASH', message: 'Não consegui gerar um slug único.' });
  }
}
