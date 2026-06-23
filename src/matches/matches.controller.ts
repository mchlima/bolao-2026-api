import { Controller, Get, Param, Query } from '@nestjs/common';
import { Paginated } from '../common/pagination';
import { QueryMatchesDto } from './dto/query-matches.dto';
import { MatchesService, MatchWithRelations, MatchDetail } from './matches.service';
import { LineupService, MatchLineup } from './lineup.service';
import { TimelineService, MatchTimeline } from './timeline.service';
import { StatsService, MatchStats } from './stats.service';
import { MatchPreviewService } from './match-preview.service';
import { MatchPreview } from './match-preview.types';

@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly lineups: LineupService,
    private readonly timeline: TimelineService,
    private readonly stats: StatsService,
    private readonly preview: MatchPreviewService,
  ) {}

  @Get()
  findAll(
    @Query() query: QueryMatchesDto,
  ): Promise<Paginated<MatchWithRelations>> {
    return this.matches.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<MatchDetail> {
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

  // Team statistics (possession/shots/…), served from our DB.
  @Get(':id/stats')
  statsFor(@Param('id') id: string): Promise<MatchStats> {
    return this.stats.forMatch(id);
  }

  // Prévia do jogo (forma/H2H/tabela/artilheiros), do nosso banco. O front busca
  // só enquanto o jogo está agendado; aceita id ou slug como as demais rotas.
  @Get(':id/preview')
  previewFor(@Param('id') id: string): Promise<MatchPreview> {
    return this.preview.forMatch(id);
  }
}
