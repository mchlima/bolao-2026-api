import { Controller, Param, Post, Query, UseGuards } from '@nestjs/common';
import { NewsItem, UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MatchReportService } from './match-report.service';

@Controller('admin/matches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminMatchReportController {
  constructor(private readonly reports: MatchReportService) {}

  /** Gera a matéria do jogo agora (usa os comentários do admin como fatos). */
  @Post(':id/generate-report')
  generate(@Param('id') id: string, @Query('force') force?: string): Promise<NewsItem> {
    return this.reports.generateForMatch(id, force === 'true');
  }
}
