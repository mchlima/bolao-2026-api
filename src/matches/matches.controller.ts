import { Controller, Get, Param, Query } from '@nestjs/common';
import { Paginated } from '../common/pagination';
import { QueryMatchesDto } from './dto/query-matches.dto';
import { MatchesService, MatchWithRelations } from './matches.service';
import { LineupService, MatchLineup } from './lineup.service';

@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly lineups: LineupService,
  ) {}

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

  // Live lineups from the ESPN summary feed (empty until ~1h before kickoff).
  @Get(':id/lineup')
  lineup(@Param('id') id: string): Promise<MatchLineup> {
    return this.lineups.forMatch(id);
  }
}
