import { Controller, Get, Param, Query } from '@nestjs/common';
import { Paginated } from '../common/pagination';
import { QueryMatchesDto } from './dto/query-matches.dto';
import { MatchesService, MatchWithRelations } from './matches.service';

@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  findAll(
    @Query() query: QueryMatchesDto,
  ): Promise<Paginated<MatchWithRelations>> {
    return this.matches.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<MatchWithRelations> {
    return this.matches.findOne(id);
  }
}
