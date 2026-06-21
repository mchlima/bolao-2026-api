import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SourceConnector, FeedPreview } from './connectors/types';
import { RssConnector } from './connectors/rss.connector';
import { NewsApiConnector } from './connectors/news-api.connector';
import { PageConnector } from './connectors/page.connector';
import { TopicConnector } from './connectors/topic.connector';
import { ContentSettingsService } from './content-settings.service';

export type { FeedPreview } from './connectors/types';

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
  async fetchFeed(feedId: string): Promise<number> {
    const feed = await this.prisma.newsFeed.findUnique({ where: { id: feedId } });
    if (!feed) return 0;
    const connector = this.connectors[feed.type];
    if (!connector) {
      await this.stampError(feed.id, `Tipo de fonte desconhecido: ${feed.type}`);
      return 0;
    }
    try {
      const items = await connector.discover(feed);
      const cutoff = Date.now() - MAX_AGE_HOURS * 3_600_000;
      const rows = items
        .filter((it) => it.sourceTitle && (it.sourceUrl || it.sourceGuid))
        // drop items already known to be stale; keep undated ones (dated at processing)
        .filter((it) => !it.publishedAt || it.publishedAt.getTime() >= cutoff)
        .map((it) => ({
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
      return res.count;
    } catch (err) {
      await this.stampError(feed.id, (err as Error).message ?? 'erro desconhecido');
      return 0;
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
