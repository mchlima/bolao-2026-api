import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SourceConnector, FeedPreview } from './connectors/types';
import { RssConnector } from './connectors/rss.connector';
import { NewsApiConnector } from './connectors/news-api.connector';
import { PageConnector } from './connectors/page.connector';
import { TopicConnector } from './connectors/topic.connector';
import { ContentSettingsService } from './content-settings.service';

export type { FeedPreview } from './connectors/types';

/** Resultado de uma coleta: inseridos, achados (após conector) e descartados por idade. */
export interface FetchResult {
  inserted: number;
  found: number;
  stale: number;
}
const ZERO: FetchResult = { inserted: 0, found: 0, stale: 0 };

// Ignore items older than this at ingest (only when the source carries a date;
// undated items are date-checked later, after the article fetch resolves a date).
const MAX_AGE_HOURS = 48;

/**
 * Polls active sources and drops fresh items onto the pipeline as DISCOVERED.
 * Each source has a `type`; the matching connector normalizes its items, so the
 * engine downstream is identical for RSS, news APIs, and crawled pages. Dedup is
 * at the DB level (@@unique([feedId, sourceGuid]) + skipDuplicates).
 */
@Injectable()
export class ContentIngestService {
  private readonly logger = new Logger(ContentIngestService.name);
  private readonly connectors: Record<string, SourceConnector>;
  private readonly rss: RssConnector;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentSettingsService,
    rss: RssConnector,
    newsApi: NewsApiConnector,
    page: PageConnector,
    topic: TopicConnector,
  ) {
    this.rss = rss;
    this.connectors = {
      [rss.type]: rss,
      [newsApi.type]: newsApi,
      [page.type]: page,
      [topic.type]: topic,
    };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (await this.settings.isPaused()) return; // master switch (admin)
    const now = Date.now();
    const feeds = await this.prisma.newsFeed.findMany({ where: { isActive: true } });
    for (const feed of feeds) {
      const dueAt = feed.lastFetchedAt
        ? feed.lastFetchedAt.getTime() + feed.fetchIntervalMin * 60_000
        : 0;
      if (dueAt <= now) await this.fetchFeed(feed.id).catch(() => undefined);
    }
  }

  /** Fetch one source now via its connector, insert fresh items, stamp health. */
  async fetchFeed(feedId: string): Promise<FetchResult> {
    const feed = await this.prisma.newsFeed.findUnique({ where: { id: feedId } });
    if (!feed) return ZERO;
    const connector = this.connectors[feed.type];
    if (!connector) {
      await this.stampError(feed.id, `Tipo de fonte desconhecido: ${feed.type}`);
      return ZERO;
    }
    // Pauta gasta US$ ao buscar (web search). Se o teto do dia já estourou, não
    // busca e avisa claramente — em vez de retornar "0" silencioso. (No cron este
    // throw é engolido pelo .catch; no "Buscar agora" vira mensagem pro usuário.)
    if (feed.type === 'TOPIC') {
      const cap = await this.settings.capStatus();
      if (cap.over) {
        throw new BadRequestException({
          code: 'CAP_EXCEEDED',
          message:
            'Pauta não buscou: teto do dia atingido. Aumente o teto em Configurações ou aguarde o reset (meia-noite UTC).',
        });
      }
    }
    try {
      const items = await connector.discover(feed);
      const cutoff = Date.now() - MAX_AGE_HOURS * 3_600_000;
      const valid = items.filter((it) => it.sourceTitle && (it.sourceUrl || it.sourceGuid));
      // drop items already known to be stale; keep undated ones (dated at processing)
      const fresh = valid.filter((it) => !it.publishedAt || it.publishedAt.getTime() >= cutoff);
      const stale = valid.length - fresh.length;
      const rows = fresh.map((it) => ({
        feedId: feed.id,
        sourceGuid: it.sourceGuid,
        sourceUrl: it.sourceUrl || it.sourceGuid,
        sourceTitle: it.sourceTitle.slice(0, 500),
        sourceSummary: it.sourceSummary,
        sourceText: it.sourceText,
        publishedAt: it.publishedAt,
      }));
      const res = await this.prisma.newsItem.createMany({ data: rows, skipDuplicates: true });
      await this.prisma.newsFeed.update({
        where: { id: feed.id },
        data: { lastFetchedAt: new Date(), lastStatus: 'OK', lastError: null },
      });
      if (res.count) {
        this.logger.log(`Fonte "${feed.name}" (${feed.type}): ${res.count} novo(s) item(ns).`);
      }
      return { inserted: res.count, found: valid.length, stale };
    } catch (err) {
      await this.stampError(feed.id, (err as Error).message ?? 'erro desconhecido');
      return ZERO;
    }
  }

  /** Validate/preview an RSS URL before saving (admin "testar"). */
  async preview(url: string): Promise<FeedPreview> {
    return this.rss.preview(url);
  }

  private async stampError(feedId: string, message: string): Promise<void> {
    await this.prisma.newsFeed.update({
      where: { id: feedId },
      data: { lastFetchedAt: new Date(), lastStatus: 'ERROR', lastError: message.slice(0, 500) },
    });
    this.logger.warn(`Fonte ${feedId} falhou: ${message.slice(0, 200)}`);
  }
}
