import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Stadium } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Paginated, paginated } from '../common/pagination';
import { CreateStadiumDto } from './dto/create-stadium.dto';
import { UpdateStadiumDto } from './dto/update-stadium.dto';

@Injectable()
export class StadiumsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto): Promise<Paginated<Stadium>> {
    const { page, pageSize, search } = query;
    const where: Prisma.StadiumWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
            { country: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.stadium.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stadium.count({ where }),
    ]);

    return paginated(data, total, page, pageSize);
  }

  async findOne(id: string): Promise<Stadium> {
    const stadium = await this.prisma.stadium.findUnique({ where: { id } });
    if (!stadium) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Estádio não encontrado.',
      });
    }
    return stadium;
  }

  create(dto: CreateStadiumDto): Promise<Stadium> {
    return this.prisma.stadium.create({ data: dto });
  }

  async update(id: string, dto: UpdateStadiumDto): Promise<Stadium> {
    await this.findOne(id);
    return this.prisma.stadium.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.stadium.delete({ where: { id } });
  }
}
