import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  DashboardOverview,
  DashboardService,
  OnlinePresence,
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
}
