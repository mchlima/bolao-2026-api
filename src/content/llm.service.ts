import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  EXTRACT_SCHEMA,
  EXTRACT_SYSTEM,
  buildExtractContents,
  buildGenerateContents,
  buildGenerateSystem,
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

export interface ExtractResult {
  isSportsNews: boolean;
  relevanceScore: number; // 0..1
  reason: string;
  facts: Record<string, unknown>;
  usage: Usage;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage: Usage;
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
  ): Promise<ExtractResult> {
    const client = this.assertClient();
    const res = await client.messages.create({
      model: MODEL_EXTRACT,
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
      facts: parsed.facts ?? {},
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model: MODEL_EXTRACT },
    };
  }

  /** Write an original article from facts only, in the given tom (optionally steered). */
  async generateArticle(
    facts: Record<string, unknown>,
    tonePrompt: string,
    guidance?: string | null,
    model: string = MODEL_GENERATE,
  ): Promise<GenerateResult> {
    const client = this.assertClient();
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      system: buildGenerateSystem(tonePrompt),
      messages: [{ role: 'user', content: buildGenerateContents(facts, guidance) }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error(`Resposta vazia do modelo ${model}.`);
    return {
      text,
      model,
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
