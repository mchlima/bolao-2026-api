import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../users/user.types';
import { UpsertPredictionDto } from './dto/upsert-prediction.dto';
import { PredictionsService, PredictionView } from './predictions.service';

@Controller('predictions')
@UseGuards(JwtAuthGuard)
export class PredictionsController {
  constructor(private readonly predictions: PredictionsService) {}

  /** Create or update the current user's prediction for a match. */
  @Post()
  upsert(
    @CurrentUser() user: SafeUser,
    @Body() dto: UpsertPredictionDto,
  ): Promise<PredictionView> {
    return this.predictions.upsert(user.id, dto);
  }

  /** The current user's predictions, optionally filtered by tournament. */
  @Get('me')
  mine(
    @CurrentUser() user: SafeUser,
    @Query('tournamentId') tournamentId?: string,
  ): Promise<PredictionView[]> {
    return this.predictions.findMine(user.id, tournamentId);
  }
}
