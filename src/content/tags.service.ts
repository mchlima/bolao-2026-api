import { Injectable } from '@nestjs/common';
import { Tag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { slugify } from './slug.util';

/**
 * Tags são ENTIDADES. A geração só sugere nomes (seo.tags, strings); aqui eles viram
 * registros canônicos: resolve() VALIDA se a tag já existe (por slug) e só CRIA se não —
 * nunca duplica "Brasil"/"brasil"/"BRASIL". Usado na publicação (e ao editar publicado).
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

  async list(): Promise<Tag[]> {
    return this.prisma.tag.findMany({ orderBy: { name: 'asc' } });
  }
}
