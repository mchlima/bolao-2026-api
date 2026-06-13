import { Controller, Get, Param, Query } from '@nestjs/common';
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

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Competition> {
    return this.competitions.findOne(id);
  }
}
