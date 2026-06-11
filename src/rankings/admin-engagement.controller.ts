import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EngagementResponse, RankingsService } from './rankings.service';

@Controller('admin/matches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminEngagementController {
  constructor(private readonly rankings: RankingsService) {}

  /** Prediction distribution (GROUP BY score) for a match. */
  @Get(':id/engagement')
  engagement(@Param('id') id: string): Promise<EngagementResponse> {
    return this.rankings.engagement(id);
  }
}
