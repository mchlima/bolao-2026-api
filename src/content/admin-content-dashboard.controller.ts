import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ContentConfig, ContentSettingsService, DayUsage } from './content-settings.service';

export interface ContentDashboard {
  config: ContentConfig;
  today: DayUsage;
  status: Record<string, number>;
  sources: { total: number; active: number; withError: number };
  tonesActive: number;
  lastIngestAt: string | null;
}

@Controller('admin/content/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminContentDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentSettingsService,
  ) {}

  @Get()
  async get(): Promise<ContentDashboard> {
    const [config, today, grouped, feeds, tonesActive] = await Promise.all([
      this.settings.getConfig(),
      this.settings.getTodayUsage(),
      this.prisma.newsItem.groupBy({ by: ['status'], _count: true }),
      this.prisma.newsFeed.findMany({ select: { isActive: true, lastStatus: true, lastFetchedAt: true } }),
      this.prisma.newsTone.count({ where: { isActive: true } }),
    ]);

    const status: Record<string, number> = {};
    for (const g of grouped) status[g.status] = g._count;

    const lastIngest = feeds
      .map((f) => f.lastFetchedAt?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);

    return {
      config,
      today,
      status,
      sources: {
        total: feeds.length,
        active: feeds.filter((f) => f.isActive).length,
        withError: feeds.filter((f) => f.lastStatus === 'ERROR').length,
      },
      tonesActive,
      lastIngestAt: lastIngest ? new Date(lastIngest).toISOString() : null,
    };
  }
}
