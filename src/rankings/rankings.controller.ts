import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { SafeUser } from '../users/user.types';
import {
  MatchRankingResponse,
  RankingResponse,
  RankingsService,
} from './rankings.service';

// Public rankings — if a valid token is present, the response includes the
// caller's own position (even outside the top 100).
@Controller()
@UseGuards(OptionalJwtAuthGuard)
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  @Get('tournaments/:id/ranking')
  tournament(
    @Param('id') id: string,
    @CurrentUser() user?: SafeUser,
  ): Promise<RankingResponse> {
    return this.rankings.tournamentRanking(id, user?.id);
  }

  @Get('matches/:id/ranking')
  match(
    @Param('id') id: string,
    @CurrentUser() user?: SafeUser,
  ): Promise<MatchRankingResponse> {
    return this.rankings.matchRanking(id, user?.id);
  }
}
