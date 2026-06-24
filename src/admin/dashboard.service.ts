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

export type SeriesGranularity = 'hour' | 'day' | 'week' | 'month';

export interface PredictionsSeries {
  granularity: SeriesGranularity;
  from: string; // 'YYYY-MM-DD' (inclusive, fuso de São Paulo)
  to: string; // 'YYYY-MM-DD' (inclusive)
  total: number; // soma dos palpites no período
  // bucket: 'YYYY-MM-DD' (dia/semana/mês) ou 'YYYY-MM-DD HH:00' (hora). Contínuo (lacunas = 0).
  points: { bucket: string; count: number }[];
}

export interface SpendSeries {
  from: string; // 'YYYY-MM-DD' (inclusivo)
  to: string; // 'YYYY-MM-DD' (inclusivo)
  total: number; // gasto total no período (US$)
  items: number; // itens (matérias) gerados no período
  // série diária contínua (dias sem gasto vêm com cost 0)
  points: { bucket: string; cost: number; items: number }[];
}

export interface OnlinePresence {
  total: number; // pessoas distintas online (logado conta 1 entre abas/dispositivos)
  devices: number; // dispositivos distintos online (uma pessoa pode ter vários)
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
    return {
      total: presence.total,
      devices: presence.devices,
      others: presence.anon + unresolved,
      users,
    };
  }

  /**
   * Palpites ao longo do tempo, agregados por dia/semana/mês no fuso de São Paulo
   * (createdAt é gravado em UTC). Intervalo [from, to] inclusivo em datas locais;
   * sem from/to assume o mês atual (dia 1 → hoje). A série é contínua: dias/semanas/
   * meses sem palpite vêm com count 0 pra o gráfico não ter buracos.
   */
  async predictionsSeries(
    fromRaw?: string,
    toRaw?: string,
    granularityRaw?: string,
  ): Promise<PredictionsSeries> {
    const TZ = 'America/Sao_Paulo';
    const granularity: SeriesGranularity =
      granularityRaw === 'hour' ||
      granularityRaw === 'week' ||
      granularityRaw === 'month'
        ? granularityRaw
        : 'day';
    const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
    const to = isDate(toRaw) ? toRaw : today;
    const from = isDate(fromRaw) ? fromRaw : `${to.slice(0, 8)}01`;

    const fmtMask = granularity === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD';
    const rows = await this.prisma.$queryRaw<{ bucket: string; count: number }[]>`
      WITH p AS (
        SELECT (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) AS local_ts
        FROM "predictions"
      )
      SELECT to_char(date_trunc(${granularity}, local_ts), ${fmtMask}) AS bucket,
             count(*)::int AS count
      FROM p
      WHERE local_ts >= ${from}::date
        AND local_ts < (${to}::date + interval '1 day')
      GROUP BY 1
      ORDER BY 1
    `;
    const counts = new Map(rows.map((r) => [r.bucket, Number(r.count)]));

    const points = this.bucketKeys(from, to, granularity).map((bucket) => ({
      bucket,
      count: counts.get(bucket) ?? 0,
    }));
    const total = points.reduce((s, p) => s + p.count, 0);
    return { granularity, from, to, total, points };
  }

  /**
   * Gasto DIÁRIO com geração de conteúdo (Claude). Lê os registros diários de uso
   * (AppSetting `content.usage.YYYY-MM-DD` = { items, costUsd }) no intervalo
   * [from, to] e devolve uma série contínua (dias sem gasto vêm com cost 0).
   * Sem from/to assume o mês atual (dia 1 → hoje).
   */
  async spendSeries(fromRaw?: string, toRaw?: string): Promise<SpendSeries> {
    const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const to = isDate(toRaw) ? toRaw : today;
    const from = isDate(fromRaw) ? fromRaw : `${to.slice(0, 8)}01`;

    const PREFIX = 'content.usage.';
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { startsWith: PREFIX } },
    });
    const byDay = new Map<string, { cost: number; items: number }>();
    for (const r of rows) {
      const date = r.key.slice(PREFIX.length); // YYYY-MM-DD
      if (date < from || date > to) continue;
      const v = (r.value as { costUsd?: number; items?: number } | null) ?? {};
      byDay.set(date, { cost: Number(v.costUsd ?? 0), items: Number(v.items ?? 0) });
    }

    const parse = (s: string) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    };
    const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
    const end = parse(to);
    const points: { bucket: string; cost: number; items: number }[] = [];
    for (let d = parse(from); d <= end; d = new Date(d.getTime() + 86400000)) {
      const k = fmt(d);
      const e = byDay.get(k);
      points.push({ bucket: k, cost: e?.cost ?? 0, items: e?.items ?? 0 });
    }
    const total = points.reduce((s, p) => s + p.cost, 0);
    const items = points.reduce((s, p) => s + p.items, 0);
    return { from, to, total, items, points };
  }

  /** Sequência contínua de buckets (em datas UTC, formatadas) que casa com o
   * date_trunc do Postgres: hora a hora; dia a dia; semana começa na segunda;
   * mês no dia 1. Hora usa 'YYYY-MM-DD HH:00'; os demais 'YYYY-MM-DD'. */
  private bucketKeys(
    from: string,
    to: string,
    granularity: SeriesGranularity,
  ): string[] {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const parse = (s: string) => new Date(`${s}T00:00:00Z`);
    const end = parse(to);
    const keys: string[] = [];
    if (granularity === 'hour') {
      const fmtHour = (d: Date) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
      const endExclusive = new Date(end.getTime() + 86400000); // fim do dia "to"
      for (let d = parse(from); d < endExclusive; d = new Date(d.getTime() + 3600000)) {
        keys.push(fmtHour(d));
      }
      return keys;
    }
    if (granularity === 'month') {
      let d = parse(`${from.slice(0, 8)}01`);
      while (d <= end) {
        keys.push(fmt(d));
        d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      }
    } else {
      let d = parse(from);
      if (granularity === 'week') {
        // recua até a segunda-feira (date_trunc('week') do Postgres é ISO/segunda)
        const dow = d.getUTCDay(); // 0=Dom..6=Sáb
        d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
      }
      const step = granularity === 'week' ? 7 : 1;
      while (d <= end) {
        keys.push(fmt(d));
        d = new Date(d.getTime() + step * 86400000);
      }
    }
    return keys;
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
