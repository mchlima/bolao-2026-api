import { Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import { Team } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../users/user.types';
import { FollowsService } from './follows.service';

@Controller('me/teams')
@UseGuards(JwtAuthGuard)
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Get()
  list(@CurrentUser() user: SafeUser): Promise<Team[]> {
    return this.follows.list(user.id);
  }

  @Put(':teamId')
  @HttpCode(204)
  follow(@CurrentUser() user: SafeUser, @Param('teamId') teamId: string): Promise<void> {
    return this.follows.follow(user.id, teamId);
  }

  @Delete(':teamId')
  @HttpCode(204)
  unfollow(@CurrentUser() user: SafeUser, @Param('teamId') teamId: string): Promise<void> {
    return this.follows.unfollow(user.id, teamId);
  }
}
