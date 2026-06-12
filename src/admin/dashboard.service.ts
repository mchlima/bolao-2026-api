import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardOverview {
  users: { total: number; active: number; admins: number };
  tournaments: number;
  teams: number;
  stadiums: number;
  matches: { total: number; byStatus: Record<string, number> };
  predictions: number;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<DashboardOverview> {
    const [
      users,
      active,
      admins,
      tournaments,
      teams,
      stadiums,
      matches,
      predictions,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { role: 'ADMIN' } }),
      this.prisma.tournament.count(),
      this.prisma.team.count(),
      this.prisma.stadium.count(),
      this.prisma.match.count(),
      this.prisma.prediction.count(),
    ]);

    const byStatusRows = await this.prisma.match.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const row of byStatusRows) byStatus[row.status] = row._count._all;

    return {
      users: { total: users, active, admins },
      tournaments,
      teams,
      stadiums,
      matches: { total: matches, byStatus },
      predictions,
    };
  }
}
