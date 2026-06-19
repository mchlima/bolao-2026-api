import { Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../users/user.types';
import { FollowsService, type FollowedUpcomingMatch } from './follows.service';

// Per-match notification opt-in: a user can follow a single match (reminders +
// final score) regardless of whether they follow either team. The reminder job
// unions these with team followers.
@Controller('me/matches')
@UseGuards(JwtAuthGuard)
export class MatchFollowsController {
  constructor(private readonly follows: FollowsService) {}

  /** Ids of the matches the user opted into explicitly. */
  @Get()
  list(@CurrentUser() user: SafeUser): Promise<string[]> {
    return this.follows.listMatchIds(user.id);
  }

  /** Upcoming matches the user follows (match or team) — for the home "Seus jogos". */
  @Get('upcoming')
  upcoming(@CurrentUser() user: SafeUser): Promise<FollowedUpcomingMatch[]> {
    return this.follows.listUpcoming(user.id);
  }

  @Put(':matchId')
  @HttpCode(204)
  follow(@CurrentUser() user: SafeUser, @Param('matchId') matchId: string): Promise<void> {
    return this.follows.followMatch(user.id, matchId);
  }

  @Delete(':matchId')
  @HttpCode(204)
  unfollow(@CurrentUser() user: SafeUser, @Param('matchId') matchId: string): Promise<void> {
    return this.follows.unfollowMatch(user.id, matchId);
  }
}
