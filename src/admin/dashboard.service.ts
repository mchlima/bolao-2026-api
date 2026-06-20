import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

export interface DashboardOverview {
  users: { total: number; active: number; admins: number };
  tournaments: number;
  teams: number;
  stadiums: number;
  matches: { total: number; byStatus: Record<string, number> };
  predictions: number;
}

export interface OnlinePresence {
  total: number; // pessoas distintas online (logado conta 1 entre abas/dispositivos)
  others: number; // não identificados: dispositivos anônimos + ids sem usuário real
  users: {
    id: string;
    name: string;
    avatarUrl: string | null;
    devices: number;
    since: string;
  }[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Live presence from the SSE bus: distinct people online + the ones we could
   * identify (by name). Anonymous devices and ids without a real user fold into
   * `others` so the front doesn't have to derive it by subtraction. */
  async online(): Promise<OnlinePresence> {
    const presence = this.events.presence();
    const ids = presence.users.map((u) => u.userId);
    const rows = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, avatarUrl: true },
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    let unresolved = 0;
    const users = presence.users
      .map((u) => {
        const row = byId.get(u.userId);
        if (!row) {
          unresolved += 1; // id sem usuário real → conta como 1 "não identificado"
          return null;
        }
        return {
          id: row.id,
          name: row.name,
          avatarUrl: row.avatarUrl,
          devices: u.devices,
          since: u.since.toISOString(),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .sort((a, b) => a.since.localeCompare(b.since));
    return { total: presence.total, others: presence.anon + unresolved, users };
  }

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
      this.prisma.season.count(),
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
