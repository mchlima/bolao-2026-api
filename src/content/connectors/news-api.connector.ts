import { Injectable } from '@nestjs/common';
import { NewsFeed } from '@prisma/client';
import { DiscoveredItem, SourceConnector } from './types';
import { FETCH_UA, fetchTimeout, getPath } from './util';

interface NewsApiConfig {
  apiKey?: string;
  apiKeyParam?: string; // query param carrying the key (e.g. "apikey", "token")
  apiKeyHeader?: string; // header carrying the key (e.g. "x-api-key")
  query?: Record<string, string>; // extra query params appended to the request
  itemsPath?: string; // dot-path to the array of items (default "articles")
  map?: {
    title?: string;
    url?: string;
    publishedAt?: string;
    summary?: string;
    content?: string;
  };
}

/**
 * Generic news-API connector — works with both paid/closed providers and
 * open/free ones. The provider's quirks live entirely in feed.config (request
 * URL, auth, and a field mapping), so a new API is a config entry, not code.
 * When the API returns full article content, no page fetch is needed downstream.
 */
@Injectable()
export class NewsApiConnector implements SourceConnector {
  readonly type = 'NEWS_API';

  async discover(feed: NewsFeed): Promise<DiscoveredItem[]> {
    const cfg = (feed.config ?? {}) as NewsApiConfig;
    const url = new URL(feed.url);
    for (const [k, v] of Object.entries(cfg.query ?? {})) url.searchParams.set(k, v);
    if (cfg.apiKeyParam && cfg.apiKey) url.searchParams.set(cfg.apiKeyParam, cfg.apiKey);

    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': FETCH_UA };
    if (cfg.apiKeyHeader && cfg.apiKey) headers[cfg.apiKeyHeader] = cfg.apiKey;

    const res = await fetch(url.toString(), { headers, signal: fetchTimeout(15_000) });
    if (!res.ok) throw new Error(`API respondeu ${res.status}`);
    const json: unknown = await res.json();

    const items = getPath(json, cfg.itemsPath ?? 'articles');
    if (!Array.isArray(items)) {
      throw new Error(`itemsPath "${cfg.itemsPath ?? 'articles'}" não aponta para uma lista`);
    }
    const m = cfg.map ?? {};
    return items
      .map((raw): DiscoveredItem => {
        const sourceUrl = String(getPath(raw, m.url ?? 'url') ?? '');
        const sourceTitle = String(getPath(raw, m.title ?? 'title') ?? '').trim();
        const pub = getPath(raw, m.publishedAt ?? 'publishedAt');
        const summary = getPath(raw, m.summary ?? 'description');
        const content = getPath(raw, m.content ?? 'content');
        const publishedAt = pub ? new Date(String(pub)) : null;
        return {
          sourceGuid: sourceUrl || sourceTitle,
          sourceUrl,
          sourceTitle,
          sourceSummary: summary ? String(summary).trim() : null,
          sourceText: content ? String(content).trim() : null,
          publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        };
      })
      .filter((i) => i.sourceUrl && i.sourceTitle);
  }
}
