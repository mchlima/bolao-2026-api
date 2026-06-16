import { Controller, Get, Param, Query } from '@nestjs/common';
import { Paginated } from '../common/pagination';
import { QueryMatchesDto } from './dto/query-matches.dto';
import { MatchesService, MatchWithRelations } from './matches.service';
import { LineupService, MatchLineup } from './lineup.service';
import { TimelineService, MatchTimeline } from './timeline.service';

@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly lineups: LineupService,
    private readonly timeline: TimelineService,
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

  // Live lineups, served from our DB (robot-ingested; empty until ~1h pre-kickoff).
  @Get(':id/lineup')
  lineup(@Param('id') id: string): Promise<MatchLineup> {
    return this.lineups.forMatch(id);
  }

  // Event timeline (goals/cards/subs), served from our DB, grouped by period.
  @Get(':id/events')
  events(@Param('id') id: string): Promise<MatchTimeline> {
    return this.timeline.forMatch(id);
  }
}
