import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SafeUser } from '../users/user.types';
import {
  DashboardOverview,
  DashboardService,
  OnlinePresence,
  PredictionsSeries,
  SpendSeries,
} from './dashboard.service';

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(): Promise<DashboardOverview> {
    return this.dashboard.overview();
  }

  @Get('online')
  online(): Promise<OnlinePresence> {
    return this.dashboard.online();
  }

  // Série de palpites no tempo (gráfico da dashboard). from/to = 'YYYY-MM-DD'
  // (fuso SP, inclusivo); granularity = day|week|month. Sem params → mês atual.
  @Get('predictions-series')
  predictionsSeries(
    @CurrentUser() admin: SafeUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ): Promise<PredictionsSeries> {
    return this.dashboard.predictionsSeries(from, to, granularity, admin.timezone);
  }

  // Série de gasto diário com geração de conteúdo (US$). from/to = 'YYYY-MM-DD'
  // (inclusivo). Sem params → mês atual.
  @Get('spend-series')
  spendSeries(
    @CurrentUser() admin: SafeUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ): Promise<SpendSeries> {
    return this.dashboard.spendSeries(from, to, admin.timezone, granularity);
  }
}
