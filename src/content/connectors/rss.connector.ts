import { Injectable } from '@nestjs/common';
import Parser from 'rss-parser';
import { NewsFeed } from '@prisma/client';
import { DiscoveredItem, FeedPreview, SourceConnector } from './types';
import { htmlToText } from './util';

/**
 * RSS/Atom connector. Prefers <content:encoded> (full body, common on WordPress
 * feeds) over the short <description> teaser, so feeds that carry the whole
 * article need no page fetch downstream.
 */
@Injectable()
export class RssConnector implements SourceConnector {
  readonly type = 'RSS';
  private readonly parser = new Parser({
    timeout: 15_000,
    customFields: { item: ['content:encoded'] },
  });

  async discover(feed: NewsFeed): Promise<DiscoveredItem[]> {
    const parsed = await this.parser.parseURL(feed.url);
    return (parsed.items ?? [])
      .filter((it) => it.title && (it.link || it.guid))
      .map((it) => {
        const encoded = (it as { 'content:encoded'?: unknown })['content:encoded'];
        const full = typeof encoded === 'string' ? htmlToText(encoded) : '';
        return {
          sourceGuid: (it.guid || it.link) as string,
          sourceUrl: (it.link || it.guid) as string,
          sourceTitle: it.title!.trim(),
          sourceSummary: (it.contentSnippet || it.content || '').trim() || null,
          sourceText: full.length > 200 ? full : null,
          publishedAt: it.isoDate ? new Date(it.isoDate) : null,
        };
      });
  }

  /** Quick validity/preview probe for the admin "testar" button. */
  async preview(url: string): Promise<FeedPreview> {
    const parsed = await this.parser.parseURL(url);
    return {
      title: parsed.title ?? '(sem título)',
      items: (parsed.items ?? []).slice(0, 8).map((it) => ({
        title: it.title ?? '(sem título)',
        link: it.link ?? '',
        isoDate: it.isoDate ?? null,
      })),
    };
  }
}
