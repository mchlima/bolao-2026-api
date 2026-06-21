import { Injectable, NotFoundException } from '@nestjs/common';
import { NewsTone, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { CreateNewsToneDto, UpdateNewsToneDto } from './dto/news-tone.dto';

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'tom'
  );
}

@Injectable()
export class NewsTonesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, pageSize: number): Promise<Paginated<NewsTone>> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.newsTone.findMany({
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.newsTone.count(),
    ]);
    return paginated(data, total, page, pageSize);
  }

  async getOne(id: string): Promise<NewsTone> {
    const tone = await this.prisma.newsTone.findUnique({ where: { id } });
    if (!tone) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tom não encontrado.' });
    return tone;
  }

  async create(dto: CreateNewsToneDto): Promise<NewsTone> {
    const slug = await this.uniqueSlug(slugify(dto.slug?.trim() || dto.name));
    return this.prisma.newsTone.create({
      data: {
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim() || null,
        promptText: dto.promptText.trim(),
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateNewsToneDto): Promise<NewsTone> {
    const tone = await this.getOne(id);
    const data: Prisma.NewsToneUpdateInput = {
      ...(dto.name != null && { name: dto.name.trim() }),
      ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    // Editing the voice bumps the version; items already generated keep their snapshot.
    if (dto.promptText !== undefined && dto.promptText.trim() !== tone.promptText) {
      data.promptText = dto.promptText.trim();
      data.version = { increment: 1 };
    }
    return this.prisma.newsTone.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.getOne(id);
    // Feeds/items referencing this tone are SetNull'd by the schema.
    await this.prisma.newsTone.delete({ where: { id } });
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    for (let i = 2; i < 50; i++) {
      const exists = await this.prisma.newsTone.findUnique({ where: { slug } });
      if (!exists) return slug;
      slug = `${base}-${i}`;
    }
    return `${base}-${base.length}`;
  }
}
