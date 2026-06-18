import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { SafeUser } from '../users/user.types';
import { AdminListPredictionsDto } from './dto/admin-list-predictions.dto';
import { AdminUpsertPredictionDto } from './dto/admin-upsert-prediction.dto';
import {
  AdminUserPredictionRow,
  PredictionsService,
  PredictionView,
} from './predictions.service';

@Controller('admin/predictions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPredictionsController {
  constructor(private readonly predictions: PredictionsService) {}

  /** One user's palpites across a season's matches (blanks included). */
  @Get()
  list(@Query() q: AdminListPredictionsDto): Promise<AdminUserPredictionRow[]> {
    return this.predictions.adminListForUser(q.userId, q.seasonId);
  }

  /** Set/replace a user's palpite for a match — no kickoff lock (admin only). */
  @Put(':userId/:matchId')
  upsert(
    @Param('userId') userId: string,
    @Param('matchId') matchId: string,
    @Body() dto: AdminUpsertPredictionDto,
    @CurrentUser() admin: SafeUser,
  ): Promise<PredictionView> {
    return this.predictions.adminUpsert(
      userId,
      { matchId, homeScore: dto.homeScore, awayScore: dto.awayScore },
      admin.id,
    );
  }
}
