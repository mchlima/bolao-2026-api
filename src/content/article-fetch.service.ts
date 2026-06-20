import { Injectable, Logger } from '@nestjs/common';
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

const MAX_CHARS = 12_000; // cap on what we feed the LLM
const TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (compatible; CraveiBot/1.0; +https://cravei.app)';

/**
 * Fetches a news page and extracts its main article text (Mozilla Readability).
 * RSS feeds usually carry only a short teaser; pulling the full body gives the
 * extraction step real material, so the rewrite isn't starved into a stub.
 * Best-effort: any failure returns null and the pipeline falls back to the RSS
 * summary. JSDOM runs no scripts and loads no subresources (safe + fast).
 */
@Injectable()
export class ArticleFetchService {
  private readonly logger = new Logger(ArticleFetchService.name);

  async fetch(
    url: string,
  ): Promise<{ title?: string; text: string; publishedAt: Date | null } | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let html: string;
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
          redirect: 'follow',
        });
        if (!res.ok) return null;
        html = await res.text();
      } finally {
        clearTimeout(timer);
      }

      // Bare VirtualConsole swallows jsdom's CSS/parse noise.
      const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
      const publishedAt = extractPublishedAt(dom.window.document);
      const article = new Readability(dom.window.document).parse();
      const text = (article?.textContent ?? '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (text.length < 200) return null; // not a real article body
      return { title: article?.title ?? undefined, text: text.slice(0, MAX_CHARS), publishedAt };
    } catch (err) {
      this.logger.debug(`fetch de artigo falhou (${url}): ${(err as Error).message}`);
      return null;
    }
  }
}

type JsdomDocument = JSDOM['window']['document'];

/** Best-effort publish date from page metadata (meta tags → <time> → JSON-LD). */
function extractPublishedAt(doc: JsdomDocument): Date | null {
  const metas = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[itemprop="datePublished"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
  ];
  for (const sel of metas) {
    const d = parseDate(doc.querySelector(sel)?.getAttribute('content'));
    if (d) return d;
  }
  const t = parseDate(doc.querySelector('time[datetime]')?.getAttribute('datetime'));
  if (t) return t;
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const d = parseDate(findDatePublished(JSON.parse(s.textContent || 'null')));
      if (d) return d;
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return null;
}

function findDatePublished(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const d = findDatePublished(n);
      if (d) return d;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.datePublished === 'string') return obj.datePublished;
  for (const v of Object.values(obj)) {
    const d = findDatePublished(v);
    if (d) return d;
  }
  return null;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
