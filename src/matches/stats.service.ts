import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface StatRow {
  key: string;
  label: string;
  home: string | null;
  away: string | null;
}
export interface MatchStats {
  available: boolean;
  rows: StatRow[];
}

/**
 * Serves a match's team statistics from OUR database (persisted by the robot's
 * MatchSummaryService from the ESPN boxscore). One row per stat with the home
 * and away values, in the curated display order. Empty until ingested.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async forMatch(id: string): Promise<MatchStats> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: {
        homeTeamId: true,
        awayTeamId: true,
        stats: {
          orderBy: { order: 'asc' },
          select: { teamId: true, key: true, value: true, label: true, order: true },
        },
      },
    });
    if (!match) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Partida não encontrada.' });
    }
    if (!match.stats.length) return { available: false, rows: [] };

    const byKey = new Map<string, { key: string; label: string; order: number; home: string | null; away: string | null }>();
    for (const s of match.stats) {
      const r = byKey.get(s.key) ?? { key: s.key, label: s.label, order: s.order, home: null, away: null };
      if (s.teamId === match.homeTeamId) r.home = s.value;
      else if (s.teamId === match.awayTeamId) r.away = s.value;
      byKey.set(s.key, r);
    }
    const rows = [...byKey.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ key, label, home, away }) => ({ key, label, home, away }));
    return { available: true, rows };
  }
}
