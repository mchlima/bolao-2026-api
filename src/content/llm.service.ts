import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  EXTRACT_SCHEMA,
  EXTRACT_SYSTEM,
  GENERATE_SCHEMA,
  SEARCH_SYSTEM,
  VERIFY_SCHEMA,
  VERIFY_SYSTEM,
  VERIFY_FACTS_SCHEMA,
  VERIFY_FACTS_SYSTEM,
  buildExtractContents,
  buildGenerateContents,
  buildGenerateSystem,
  buildSearchPrompt,
  buildVerifyContents,
  buildVerifyFactsContents,
} from './content.prompts';

// Cheap/fast model classifies + extracts; a stronger one writes the article.
// Swap these two strings to move tiers (e.g. generation → 'claude-opus-4-8').
const MODEL_EXTRACT = 'claude-haiku-4-5';
const MODEL_GENERATE = 'claude-sonnet-4-6';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// Cheap model also drives topic discovery (web search results are token-heavy).
const MODEL_SEARCH = 'claude-haiku-4-5';
// Anthropic web search: US$ per search request (billed on top of tokens).
const WEB_SEARCH_PRICE = 0.01;

// USD per 1M tokens (input/output) — keep in sync with the model strings above.
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
};

/** Real cost of one call from its token usage. */
export function costUsd(u: Usage): number {
  const p = PRICES[u.model] ?? { in: 3, out: 15 };
  return (u.inputTokens / 1_000_000) * p.in + (u.outputTokens / 1_000_000) * p.out;
}

/** Cost of a topic-discovery call: tokens + the web-search fee. */
export function searchCostUsd(u: Usage, searchRequests: number): number {
  return costUsd(u) + Math.max(0, searchRequests) * WEB_SEARCH_PRICE;
}

export interface TopicHit {
  title: string;
  url: string;
  pageAge: string | null; // "April 30, 2025" from web_search_result
}

export interface ExtractResult {
  isSportsNews: boolean;
  relevanceScore: number; // 0..1
  reason: string;
  eventKey: string; // normalized cross-source dedup key ('' = couldn't define)
  facts: Record<string, unknown>;
  usage: Usage;
}

/** Defensive normalization so two sources' keys actually collide (accents/case/spaces). */
export function normalizeEventKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // anything else → hyphen
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** SEO/GEO/taxonomy package generated alongside the article body. */
export interface ArticleSeo {
  dek: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  keywords: string[];
  category: string;
  tags: string[];
  keyTakeaways: string[];
  faq: { question: string; answer: string }[];
  imageAlt: string;
}

export interface GenerateResult {
  /** title + body joined ("manchete\n\ncorpo") — stored in generatedText for the review UI. */
  text: string;
  title: string;
  body: string;
  seo: ArticleSeo;
  model: string;
  usage: Usage;
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [];

/**
 * Texto auditável de uma geração: corpo + as superfícies GEO que também podem
 * inventar fato (dek, takeaways, respostas do FAQ). A verificação de fidelidade
 * roda sobre TUDO isto, não só o corpo.
 */
export function articleAuditText(gen: GenerateResult): string {
  const parts = [gen.text, gen.seo.dek, ...gen.seo.keyTakeaways, ...gen.seo.faq.map((q) => q.answer)];
  return parts.map((s) => s?.trim()).filter(Boolean).join('\n');
}

/**
 * Provider-neutral seam over the LLM (Claude under the hood). The pipeline talks
 * only to these two methods. Boots fine without a key (configured=false) so the
 * rest of the app is unaffected; the cron simply idles until the key is set.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: Anthropic | null;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY ausente — motor de conteúdo desligado (sobe normal).');
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /** One cheap call: is this relevant sports news, and what are the facts. */
  async extractAndClassify(
    title: string,
    body: string | null,
    focus?: string | null,
    model: string = MODEL_EXTRACT,
  ): Promise<ExtractResult> {
    const client = this.assertClient();
    const res = await client.messages.create({
      model,
      max_tokens: 2048,
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: buildExtractContents(title, body, focus) }],
      tools: [
        {
          name: 'record_facts',
          description: 'Registra a classificação e os fatos extraídos da notícia.',
          input_schema: EXTRACT_SCHEMA as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: 'record_facts' },
    });
    const tool = res.content.find((b) => b.type === 'tool_use');
    if (!tool || tool.type !== 'tool_use') {
      throw new Error('Modelo não retornou os fatos estruturados.');
    }
    const parsed = tool.input as Partial<ExtractResult> & { facts?: Record<string, unknown> };
    return {
      isSportsNews: parsed.isSportsNews === true,
      relevanceScore:
        typeof parsed.relevanceScore === 'number'
          ? Math.max(0, Math.min(1, parsed.relevanceScore))
          : 0,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      eventKey: normalizeEventKey(parsed.eventKey),
      facts: parsed.facts ?? {},
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model },
    };
  }

  /**
   * Topic discovery via Anthropic web search. Returns the REAL articles found
   * (url/title/date) — we don't use Claude's prose, only the search results, so
   * the rest of the pipeline (fetch body → extract facts → generate) stays the
   * single source of truth. Cost = tokens + web-search fee (see searchCostUsd).
   */
  async searchTopic(
    query: string,
    opts: { allowedDomains?: string[]; maxSearches?: number } = {},
  ): Promise<{ results: TopicHit[]; usage: Usage; searchRequests: number }> {
    const client = this.assertClient();
    const tool: Record<string, unknown> = {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: Math.min(Math.max(opts.maxSearches ?? 3, 1), 10),
    };
    if (opts.allowedDomains?.length) tool.allowed_domains = opts.allowedDomains;

    const res = await client.messages.create({
      model: MODEL_SEARCH,
      max_tokens: 1024,
      system: SEARCH_SYSTEM,
      messages: [{ role: 'user', content: buildSearchPrompt(query) }],
      tools: [tool] as unknown as Anthropic.MessageCreateParams['tools'],
    });

    const results: TopicHit[] = [];
    const seen = new Set<string>();
    for (const block of res.content as unknown as Array<Record<string, unknown>>) {
      if (block.type !== 'web_search_tool_result') continue;
      const inner = block.content;
      if (!Array.isArray(inner)) continue; // error object → skip
      for (const r of inner as Array<Record<string, unknown>>) {
        if (r.type !== 'web_search_result') continue;
        const url = typeof r.url === 'string' ? r.url : '';
        if (!url || seen.has(url)) continue;
        seen.add(url);
        results.push({
          url,
          title: typeof r.title === 'string' ? r.title.trim() : '',
          pageAge: typeof r.page_age === 'string' ? r.page_age : null,
        });
      }
    }
    const serverUse = (res.usage as { server_tool_use?: { web_search_requests?: number } })
      .server_tool_use;
    return {
      results,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model: MODEL_SEARCH },
      searchRequests: serverUse?.web_search_requests ?? 0,
    };
  }

  /**
   * Write an original article from facts only, in the given tom (optionally steered).
   * Returns a structured package: body + SEO/GEO/taxonomy, so the article is ready to
   * publish for organic discovery. Forced tool use keeps the shape reliable.
   */
  async generateArticle(
    facts: Record<string, unknown>,
    tonePrompt: string,
    guidance?: string | null,
    model: string = MODEL_GENERATE,
  ): Promise<GenerateResult> {
    const client = this.assertClient();
    const res = await client.messages.create({
      model,
      max_tokens: 6144,
      system: buildGenerateSystem(tonePrompt),
      messages: [{ role: 'user', content: buildGenerateContents(facts, guidance) }],
      tools: [
        {
          name: 'record_article',
          description: 'Registra a matéria pronta para publicar (corpo + SEO + GEO + taxonomia).',
          input_schema: GENERATE_SCHEMA as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: 'record_article' },
    });
    const tool = res.content.find((b) => b.type === 'tool_use');
    if (!tool || tool.type !== 'tool_use') {
      throw new Error(`Modelo ${model} não retornou o artigo estruturado.`);
    }
    const p = tool.input as Record<string, unknown>;
    const title = asStr(p.title);
    const body = asStr(p.body);
    if (!title || !body) throw new Error(`Resposta incompleta do modelo ${model} (sem título/corpo).`);
    const faq = Array.isArray(p.faq)
      ? (p.faq as unknown[])
          .map((q) => {
            const o = (q ?? {}) as Record<string, unknown>;
            return { question: asStr(o.question), answer: asStr(o.answer) };
          })
          .filter((q) => q.question && q.answer)
      : [];
    const seo: ArticleSeo = {
      dek: asStr(p.dek),
      slug: normalizeEventKey(p.slug), // reusa o normalizador de slug (sem acento, [a-z0-9-])
      metaTitle: asStr(p.metaTitle) || title,
      metaDescription: asStr(p.metaDescription),
      focusKeyword: asStr(p.focusKeyword),
      keywords: asStrArr(p.keywords),
      category: asStr(p.category),
      tags: asStrArr(p.tags),
      keyTakeaways: asStrArr(p.keyTakeaways),
      faq,
      imageAlt: asStr(p.imageAlt),
    };
    return {
      text: `${title}\n\n${body}`,
      title,
      body,
      seo,
      model,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model },
    };
  }

  /**
   * Audit the generated text against the SOURCE (the ground truth). Catches both
   * factual problems (incl. errors that came from extraction) and derivation
   * (text too close to the source). Returns ok + a human-readable notes string.
   */
  async verifyArticle(
    source: string,
    text: string,
    model: string = MODEL_EXTRACT,
  ): Promise<{ ok: boolean; notes: string | null; usage: Usage }> {
    const client = this.assertClient();
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: VERIFY_SYSTEM,
      messages: [{ role: 'user', content: buildVerifyContents(source, text) }],
      tools: [
        {
          name: 'record_check',
          description: 'Registra o resultado da auditoria (fidelidade + derivação).',
          input_schema: VERIFY_SCHEMA as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: 'record_check' },
    });
    const tool = res.content.find((b) => b.type === 'tool_use');
    const parsed =
      tool && tool.type === 'tool_use'
        ? (tool.input as { issues?: unknown; derivative?: boolean; derivativeReason?: unknown })
        : {};
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((i): i is string => typeof i === 'string')
      : [];
    const derivative = parsed.derivative === true;
    const reason = typeof parsed.derivativeReason === 'string' ? parsed.derivativeReason.trim() : '';
    const lines = [...issues];
    if (derivative) lines.push(`⚠ Possível derivação da fonte${reason ? `: ${reason}` : ''}`);
    return {
      ok: issues.length === 0 && !derivative,
      notes: lines.length ? lines.join('\n') : null,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model },
    };
  }

  /**
   * Audit a generated article against our OWN structured FACTS (não há prosa-fonte).
   * Só fidelidade — invenção/contradição/dedução sem lastro. Reusar os fatos é o
   * esperado, então NÃO há checagem de derivação. Usado por fontes generativas.
   */
  async verifyAgainstFacts(
    factsJson: string,
    text: string,
    model: string = MODEL_EXTRACT,
  ): Promise<{ ok: boolean; notes: string | null; usage: Usage }> {
    const client = this.assertClient();
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: VERIFY_FACTS_SYSTEM,
      messages: [{ role: 'user', content: buildVerifyFactsContents(factsJson, text) }],
      tools: [
        {
          name: 'record_check',
          description: 'Registra a auditoria de fidelidade aos fatos.',
          input_schema: VERIFY_FACTS_SCHEMA as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: 'record_check' },
    });
    const tool = res.content.find((b) => b.type === 'tool_use');
    const parsed =
      tool && tool.type === 'tool_use' ? (tool.input as { issues?: unknown }) : {};
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((i): i is string => typeof i === 'string')
      : [];
    return {
      ok: issues.length === 0,
      notes: issues.length ? issues.join('\n') : null,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model },
    };
  }

  private assertClient(): Anthropic {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: 'LLM_NOT_CONFIGURED',
        message: 'ANTHROPIC_API_KEY não configurada.',
      });
    }
    return this.client;
  }
}
