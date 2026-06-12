import { Controller, Get, Param, Query } from '@nestjs/common';
import { Team } from '@prisma/client';
import { Paginated } from '../common/pagination';
import { QueryTeamsDto } from './dto/query-teams.dto';
import { TeamsService } from './teams.service';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  findAll(@Query() query: QueryTeamsDto): Promise<Paginated<Team>> {
    return this.teams.findAll(query);
  }

  /** Distinct countries/continents/types with counts — powers the admin filters. */
  @Get('facets')
  facets(): ReturnType<TeamsService['facets']> {
    return this.teams.facets();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Team> {
    return this.teams.findOne(id);
  }
}
