import { NewsFeed } from '@prisma/client';

/** A source-agnostic news item produced by a connector. */
export interface DiscoveredItem {
  sourceGuid: string; // stable dedup key within a source
  sourceUrl: string;
  sourceTitle: string;
  sourceSummary: string | null;
  sourceText: string | null; // full body when the connector already has it (else fetched later)
  publishedAt: Date | null;
  // Generative sources (ex.: MATCH_REPORT) já entregam os fatos estruturados e o
  // id da partida — o processamento pula a extração e gera direto destes.
  facts?: Record<string, unknown> | null;
  matchId?: string | null;
}

/** One input-type adapter. The engine downstream is identical for every type. */
export interface SourceConnector {
  readonly type: string; // RSS | NEWS_API | PAGE
  discover(feed: NewsFeed): Promise<DiscoveredItem[]>;
}

/** Result of the admin "testar" probe on an RSS URL. */
export interface FeedPreview {
  title: string;
  items: { title: string; link: string; isoDate: string | null }[];
}
