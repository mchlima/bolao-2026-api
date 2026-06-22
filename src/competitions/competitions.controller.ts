import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Competition } from '@prisma/client';
import { Paginated } from '../common/pagination';
import { CompetitionsService } from './competitions.service';
import { QueryCompetitionsDto } from './dto/query-competitions.dto';

@Controller('competitions')
export class CompetitionsController {
  constructor(private readonly competitions: CompetitionsService) {}

  @Get()
  findAll(
    @Query() query: QueryCompetitionsDto,
  ): Promise<Paginated<Competition>> {
    return this.competitions.findAll(query);
  }

  // Resolve por slug PÚBLICO de URL (rota /futebol/campeonato/:slug). Declarado
  // ANTES de :id pra 'slug' não cair no param genérico.
  @Get('slug/:urlSlug')
  async findByUrlSlug(@Param('urlSlug') urlSlug: string) {
    const comp = await this.competitions.findByUrlSlug(urlSlug);
    if (!comp) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Competição não encontrada.',
      });
    }
    return comp;
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Competition> {
    return this.competitions.findOne(id);
  }
}
