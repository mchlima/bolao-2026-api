import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { SafeUser } from '../users/user.types';
import {
  MatchRankingResponse,
  RankingResponse,
  RankingsService,
} from './rankings.service';

@Controller()
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  // The tournament leaderboard exposes participants' names + scores, so it is
  // members-only — authentication required (no anonymous browsing).
  @Get('seasons/:id/ranking')
  @UseGuards(JwtAuthGuard)
  tournament(
    @Param('id') id: string,
    @CurrentUser() user: SafeUser,
  ): Promise<RankingResponse> {
    return this.rankings.tournamentRanking(id, user.id);
  }

  // Per-match ranking: optional auth (a valid token adds the caller's own row).
  @Get('matches/:id/ranking')
  @UseGuards(OptionalJwtAuthGuard)
  match(
    @Param('id') id: string,
    @CurrentUser() user?: SafeUser,
  ): Promise<MatchRankingResponse> {
    return this.rankings.matchRanking(id, user?.id);
  }
}
