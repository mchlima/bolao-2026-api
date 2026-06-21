import { Injectable } from '@nestjs/common';
import { NewsFeed } from '@prisma/client';
import { DiscoveredItem, SourceConnector } from './types';
import { LlmService, searchCostUsd } from '../llm.service';
import { ContentSettingsService } from '../content-settings.service';

interface TopicConfig {
  query?: string; // o assunto da pauta (também pode vir de feed.focus)
  allowedDomains?: string[]; // lista branca de domínios confiáveis
  maxSearches?: number; // buscas por rodada (custo)
  maxResults?: number; // máx. de artigos por rodada
}

/**
 * Topic/pauta connector. Instead of a fixed URL, it takes a subject and uses
 * Anthropic web search to DISCOVER real, dated articles about it. The articles
 * then flow through the exact same pipeline (fetch body → freshness → extract →
 * dedup → generate), so provenance and the anti-hallucination guarantee hold.
 * The web-search cost is recorded against the daily budget right here.
 */
@Injectable()
export class TopicConnector implements SourceConnector {
  readonly type = 'TOPIC';

  constructor(
    private readonly llm: LlmService,
    private readonly settings: ContentSettingsService,
  ) {}

  async discover(feed: NewsFeed): Promise<DiscoveredItem[]> {
    const cfg = (feed.config ?? {}) as TopicConfig;
    const query = (cfg.query || feed.focus || '').trim();
    if (!query) throw new Error('Pauta sem assunto: defina "query" na config.');

    // Busca custa US$ — não descobre nada se o teto diário já estourou.
    const cap = await this.settings.capStatus();
    if (cap.over) return [];

    const { results, usage, searchRequests } = await this.llm.searchTopic(query, {
      allowedDomains: cfg.allowedDomains?.filter(Boolean),
      maxSearches: cfg.maxSearches,
    });
    // Custo da descoberta (tokens + buscas) entra no teto de gasto do dia.
    await this.settings.addUsage(searchCostUsd(usage, searchRequests), false);

    // Só passa o que parece MATÉRIA (índice/tabela/hub/agregador caem fora) —
    // economiza extração; a relevância ainda é a rede de segurança final.
    const articles = results.filter((r) => looksLikeArticle(r.url));

    const limit = Math.min(Math.max(cfg.maxResults ?? 15, 1), 30);
    return articles.slice(0, limit).map(
      (r): DiscoveredItem => ({
        sourceGuid: r.url,
        sourceUrl: r.url,
        sourceTitle: r.title || r.url,
        sourceSummary: null,
        sourceText: null,
        publishedAt: parsePageAge(r.pageAge),
      }),
    );
  }
}

/**
 * web_search_result.page_age is a human string — absolute ("April 30, 2025") OR
 * relative ("14 hours ago", "3 weeks ago"). Parse both so the 48h freshness guard
 * works already at discovery (avoids fetching/extracting clearly-stale pages).
 */
// Domínios que são dado bruto/agregador/verbete — quase nunca matéria.
const NON_NEWS_DOMAINS = [
  'wikipedia.org', 'sofascore.com', 'flashscore', '365scores', 'fbref.com',
  'whoscored.com', 'fotmob.com', 'besoccer.com', 'footystats', 'oddspedia',
];
// Pedaços no caminho que denunciam página-índice (tabela/resultados/fixtures/agenda…).
// Comparados como SUBSTRING do path — pegam "/tabela/" e "-tabela-classificacao-" no slug.
const NON_NEWS_HINTS = [
  'tabela', 'classificacao', 'classificação', 'estatistica', 'estatística',
  'standings', 'scores-fixtures', 'fixtures', '/resultados', '/scores', '/table',
  '/stats', 'calendario', 'calendário', '/agenda', '/elenco',
];
// Caminhos que marcam matéria de verdade.
const ARTICLE_HINTS = /\/(noticia|noticias|materia|matéria|artigo|article|news|post|reportagem|coluna)\b/;
const DATED_PATH = /\/(19|20)\d{2}\//; // .../2026/06/...

/**
 * Heurística "parece matéria jornalística?": bloqueia domínio/índice e exige um
 * sinal POSITIVO de artigo (caminho de notícia, caminho datado, ou slug longo).
 * Páginas-hub (lance.com.br/copa-do-mundo) e índices (.../resultados, /scores-fixtures)
 * caem fora. A relevância na extração continua como rede de segurança final.
 */
function looksLikeArticle(url: string): boolean {
  const u = url.toLowerCase();
  if (NON_NEWS_DOMAINS.some((d) => u.includes(d))) return false;
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (NON_NEWS_HINTS.some((h) => path.includes(h))) return false;
  const segs = path.split('/').filter(Boolean);
  if (segs.length < 2) return false; // home / seção
  if (ARTICLE_HINTS.test(path) || DATED_PATH.test(path)) return true;
  const last = segs[segs.length - 1];
  return last.length >= 25 && last.includes('-'); // slug longo de matéria
}

const REL_MS: Record<string, number> = {
  second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
  week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000,
};
function parsePageAge(s: string | null): Date | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  const rel = t.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (rel) return new Date(Date.now() - parseInt(rel[1], 10) * REL_MS[rel[2]]);
  if (t === 'today' || t === 'just now') return new Date();
  if (t === 'yesterday') return new Date(Date.now() - REL_MS.day);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
