import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../users/user.types';
import { StandingsService } from './standings.service';
import type { MyStandingsResponse } from './standings.types';

@Controller('me/standings')
@UseGuards(JwtAuthGuard)
export class StandingsController {
  constructor(private readonly standings: StandingsService) {}

  /** The current user's standing in every tournament/pool they play. */
  @Get()
  mine(@CurrentUser() user: SafeUser): Promise<MyStandingsResponse> {
    return this.standings.forUser(user.id);
  }
}
