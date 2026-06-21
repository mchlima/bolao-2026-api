import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Category, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { slugify } from './slug.util';
import { cleanTermSeo } from './term-seo.util';
import { CreateTaxonomyDto, UpdateTaxonomyDto } from './dto/news-taxonomy.dto';

export const MAX_CATEGORY_DEPTH = 3;

/** Nó da árvore (lista achatada em ordem DFS) p/ admin + seletor da revisão. */
export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  depth: number; // 1 = raiz
  pathLabel: string[]; // nomes dos ancestrais + ele (ex.: ["Futebol","Copa do Mundo","2026"])
  items: number;
  seo: Prisma.JsonValue | null; // pacote SEO/GEO manual (p/ o modal de edição do admin)
}

/**
 * Categoria é ENTIDADE HIERÁRQUICA (até 3 níveis: Futebol > Copa do Mundo > 2026). 1 artigo →
 * 1 categoria. A geração sugere o nome (seo.category); ao publicar, resolve() valida por slug
 * (find-or-create como RAIZ) — o admin organiza a árvore depois. CRUD no admin + página pública.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nome → entidade Categoria (find-or-create por slug, como nó raiz); null se vazio. */
  async resolve(name: string | null | undefined): Promise<Category | null> {
    const n = (name ?? '').trim();
    if (!n) return null;
    const slug = slugify(n);
    if (!slug) return null;
    return this.prisma.category.upsert({ where: { slug }, create: { slug, name: n }, update: {} });
  }

  // ─────────────────────────────────────────────────────────── árvore + CRUD

  /** Todas as categorias em ordem DFS, com profundidade, caminho e contagem. */
  async tree(): Promise<CategoryNode[]> {
    const all = await this.prisma.category.findMany({
      include: { _count: { select: { items: true } } },
    });
    const byParent = new Map<string | null, typeof all>();
    for (const c of all) {
      const arr = byParent.get(c.parentId) ?? [];
      arr.push(c);
      byParent.set(c.parentId, arr);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const out: CategoryNode[] = [];
    const walk = (parentId: string | null, depth: number, prefix: string[]) => {
      for (const c of byParent.get(parentId) ?? []) {
        const pathLabel = [...prefix, c.name];
        out.push({
          id: c.id, name: c.name, slug: c.slug, description: c.description,
          parentId: c.parentId, depth, pathLabel, items: c._count.items, seo: c.seo,
        });
        walk(c.id, depth + 1, pathLabel);
      }
    };
    walk(null, 1, []);
    return out;
  }

  async getOne(id: string): Promise<Category> {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Categoria não encontrada.' });
    return cat;
  }

  async create(dto: CreateTaxonomyDto): Promise<Category> {
    await this.assertParentDepth(dto.parentId ?? null);
    const slug = await this.uniqueSlug(slugify(dto.slug?.trim() || dto.name));
    return this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim() || null,
        parentId: dto.parentId ?? null,
        ...(dto.seo !== undefined && { seo: cleanTermSeo(dto.seo) ?? Prisma.DbNull }),
      },
    });
  }

  async update(id: string, dto: UpdateTaxonomyDto): Promise<Category> {
    await this.getOne(id);
    if (dto.parentId !== undefined) await this.assertMove(id, dto.parentId);
    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name.trim() }),
        // description pode chegar null (limpar) — guarda contra null.trim().
        ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
        // seo: undefined = não mexe; {}/null/vazio = limpa (DbNull); senão grava saneado.
        ...(dto.seo !== undefined && { seo: cleanTermSeo(dto.seo) ?? Prisma.DbNull }),
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.getOne(id);
    // onDelete SetNull no schema: filhas viram raiz, artigos ficam sem categoria (não apaga nada).
    await this.prisma.category.delete({ where: { id } });
  }

  // ───────────────────────────────────────────── helpers de hierarquia

  /** Caminho raiz→nó (ancestrais + ele), para breadcrumb. */
  async pathOf(id: string): Promise<Category[]> {
    const chain: Category[] = [];
    let cur: string | null = id;
    for (let i = 0; i < MAX_CATEGORY_DEPTH + 1 && cur; i++) {
      const c: Category | null = await this.prisma.category.findUnique({ where: { id: cur } });
      if (!c) break;
      chain.unshift(c);
      cur = c.parentId;
    }
    return chain;
  }

  /** Ids do nó + todos os descendentes (até 3 níveis), p/ listar matérias de uma categoria-pai. */
  async descendantIds(id: string): Promise<string[]> {
    const ids = [id];
    let frontier = [id];
    for (let lvl = 0; lvl < MAX_CATEGORY_DEPTH; lvl++) {
      const kids = await this.prisma.category.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      if (!kids.length) break;
      frontier = kids.map((k) => k.id);
      ids.push(...frontier);
    }
    return ids;
  }

  /** Profundidade 1-based de um nó (raiz = 1). */
  private async depthOf(id: string): Promise<number> {
    return (await this.pathOf(id)).length;
  }

  /** Ao criar sob um pai: o pai precisa existir e ter profundidade < MAX (senão filho passa de 3). */
  private async assertParentDepth(parentId: string | null): Promise<void> {
    if (!parentId) return;
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException({ code: 'BAD_PARENT', message: 'Categoria-pai não encontrada.' });
    const d = await this.depthOf(parentId);
    if (d >= MAX_CATEGORY_DEPTH) {
      throw new BadRequestException({ code: 'TOO_DEEP', message: `Categoria pode ter no máximo ${MAX_CATEGORY_DEPTH} níveis.` });
    }
  }

  /** Ao mover um nó: pai válido, sem ciclo, e a subárvore não pode passar de MAX níveis. */
  private async assertMove(id: string, parentId: string | null): Promise<void> {
    if (!parentId) return;
    if (parentId === id) throw new BadRequestException({ code: 'CYCLE', message: 'Uma categoria não pode ser pai dela mesma.' });
    await this.assertParentDepth(parentId);
    // o novo pai não pode estar na subárvore do nó (ciclo)
    const sub = await this.descendantIds(id);
    if (sub.includes(parentId)) {
      throw new BadRequestException({ code: 'CYCLE', message: 'Não dá para mover uma categoria para dentro de uma filha dela.' });
    }
    // profundidade do novo pai + altura da subárvore não pode passar de MAX
    const parentDepth = await this.depthOf(parentId);
    const height = await this.subtreeHeight(id);
    if (parentDepth + height > MAX_CATEGORY_DEPTH) {
      throw new BadRequestException({ code: 'TOO_DEEP', message: `O resultado passaria de ${MAX_CATEGORY_DEPTH} níveis.` });
    }
  }

  /** Altura da subárvore (1 = só o nó). */
  private async subtreeHeight(id: string): Promise<number> {
    let height = 1;
    let frontier = [id];
    for (let lvl = 0; lvl < MAX_CATEGORY_DEPTH; lvl++) {
      const kids = await this.prisma.category.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      if (!kids.length) break;
      height += 1;
      frontier = kids.map((k) => k.id);
    }
    return height;
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
