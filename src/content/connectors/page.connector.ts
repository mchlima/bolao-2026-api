import { Injectable } from '@nestjs/common';
import { JSDOM, VirtualConsole } from 'jsdom';
import { NewsFeed } from '@prisma/client';
import { DiscoveredItem, SourceConnector } from './types';
import { FETCH_UA, fetchTimeout } from './util';

interface PageConfig {
  linkPattern?: string; // regex; only hrefs matching are treated as articles
  limit?: number; // max links to take (default 25)
}

/**
 * Page/crawl connector. Fetches a section/listing page and harvests article
 * links (same host, matching an optional pattern, with non-trivial anchor text).
 * Bodies and publish dates are filled later by ArticleFetchService when each
 * item is processed — listings rarely carry either.
 */
@Injectable()
export class PageConnector implements SourceConnector {
  readonly type = 'PAGE';

  async discover(feed: NewsFeed): Promise<DiscoveredItem[]> {
    const cfg = (feed.config ?? {}) as PageConfig;
    const res = await fetch(feed.url, {
      headers: { 'user-agent': FETCH_UA, accept: 'text/html' },
      signal: fetchTimeout(15_000),
    });
    if (!res.ok) throw new Error(`Página respondeu ${res.status}`);
    const html = await res.text();

    const dom = new JSDOM(html, { url: feed.url, virtualConsole: new VirtualConsole() });
    const base = new URL(feed.url);
    const pattern = cfg.linkPattern ? new RegExp(cfg.linkPattern) : null;
    const limit = cfg.limit ?? 25;

    const seen = new Set<string>();
    const items: DiscoveredItem[] = [];
    for (const a of dom.window.document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      let abs: URL;
      try {
        abs = new URL(href, base);
      } catch {
        continue;
      }
      abs.hash = '';
      const url = abs.toString();
      if (abs.hostname !== base.hostname) continue; // same site only
      if (pattern ? !pattern.test(url) : !looksLikeArticle(abs)) continue;
      const title = (a.textContent || '').trim().replace(/\s+/g, ' ');
      if (title.length < 15) continue; // skip nav/teaser-less links
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({
        sourceGuid: url,
        sourceUrl: url,
        sourceTitle: title,
        sourceSummary: null,
        sourceText: null,
        publishedAt: null,
      });
      if (items.length >= limit) break;
    }
    return items;
  }
}

/** Heuristic for "this href is probably an article" when no pattern is set. */
function looksLikeArticle(u: URL): boolean {
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 2) return false;
  const last = segs[segs.length - 1];
  return last.length > 20 || /\.(s?html?)$/.test(last) || /\d/.test(last);
}
