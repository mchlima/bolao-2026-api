import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NewsTone, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService, costUsd } from './llm.service';
import { ArticleFetchService } from './article-fetch.service';
import { ContentSettingsService, ContentConfig } from './content-settings.service';
import { isGenerativeFeedType } from './dto/news-feed.dto';

// Small per-tick batch keeps load gentle and respects provider rate limits.
const BATCH = 4;
// Default freshness window in hours — overridable per feed via NewsFeed.maxAgeHours.
const DEFAULT_MAX_AGE_HOURS = 48;
// Cross-source dedup lookback (by ingest time, not article age) — fixed.
const DEDUP_WINDOW_MS = 48 * 3_600_000;
// Abaixo disto, o corpo é menu/teaser — sem matéria pra apurar (evita gerar do título).
const MIN_BODY_CHARS = 400;

/** Normalized set of entities (teams/people/competition) from the extracted facts. */
function factEntities(facts: unknown): Set<string> {
  const set = new Set<string>();
  if (!facts || typeof facts !== 'object') return set;
  const f = facts as Record<string, unknown>;
  const add = (v: unknown) => {
    if (typeof v !== 'string') return;
    const n = v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    if (n) set.add(n);
  };
  for (const key of ['teams', 'people']) {
    const arr = f[key];
    if (Array.isArray(arr)) arr.forEach(add);
  }
  add(f['competition']);
  return set;
}

/**
 * The pipeline engine. A minute cron claims DISCOVERED items (atomically, so it
 * never double-processes) and runs each through extract→generate. Items land in
 * PENDING_REVIEW for a human (Gate 2), or FILTERED if the auto-filter rejects them.
 * reprocess() re-runs ONLY generation with an editor steer, appending a revision.
 */
@Injectable()
export class ContentProcessService {
  private readonly logger = new Logger(ContentProcessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly articleFetch: ArticleFetchService,
    private readonly settings: ContentSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.llm.configured) return;
    const cfg = await this.settings.getConfig();
    if (cfg.paused) return; // master switch
    if (await this.capReached(cfg)) return; // já bateu algum teto hoje
    const pending = await this.prisma.newsItem.findMany({
      where: { status: 'DISCOVERED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of pending) {
      // Re-checa ANTES de cada item: senão o lote inteiro (BATCH) passaria de uma vez
      // e estouraria o teto (ex.: maxPerDay=1 gerava até BATCH matérias num tick só).
      if (await this.capReached(cfg)) break;
      await this.processItem(id, cfg);
    }
  }

  /** Algum teto diário batido (gasto OU volume)? Lê o uso fresco a cada chamada. */
  private async capReached(cfg: ContentConfig): Promise<boolean> {
    const u = await this.settings.getTodayUsage();
    if (cfg.dailyBudgetUsd > 0 && u.costUsd >= cfg.dailyBudgetUsd) return true;
    if (cfg.maxPerDay > 0 && u.items >= cfg.maxPerDay) return true;
    return false;
  }

  async processItem(id: string, cfg?: ContentConfig): Promise<void> {
    const conf = cfg ?? (await this.settings.getConfig());
    // Claim atomically so only one runner proceeds.
    const claim = await this.prisma.newsItem.updateMany({
      where: { id, status: 'DISCOVERED' },
      data: { status: 'PROCESSING', error: null },
    });
    if (!claim.count) return;

    const item = await this.prisma.newsItem.findUnique({
      where: { id },
      include: { feed: true },
    });
    if (!item) return;

    try {
      // Fonte generativa (ex.: MATCH_REPORT): os fatos já vieram prontos do conector
      // (lendo o nosso banco). Pula fetch/extração/dedup e gera direto, auditando
      // contra os próprios fatos estruturados — não há prosa-fonte de terceiro.
      if (isGenerativeFeedType(item.feed?.type)) {
        await this.generateFromFacts(item, conf);
        return;
      }

      // Prefer the connector's full body (RSS content:encoded, API content);
      // otherwise fetch the article page (RSS teaser, crawled pages).
      let body = item.sourceText;
      let fetchedDate: Date | null = null;
      if (!body) {
        const article = await this.articleFetch.fetch(item.sourceUrl);
        if (article?.text) {
          body = article.text;
          await this.prisma.newsItem.update({ where: { id }, data: { sourceText: article.text } });
        }
        fetchedDate = article?.publishedAt ?? null;
      }

      // Freshness guard — never rewrite old news (janela da fonte, ou 48h padrão).
      const maxAgeMs = (item.feed?.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 3_600_000;
      const publishedAt = item.publishedAt ?? fetchedDate;
      if (publishedAt && Date.now() - publishedAt.getTime() > maxAgeMs) {
        await this.prisma.newsItem.update({
          where: { id },
          data: { status: 'FILTERED', relevanceReason: 'Notícia antiga (mais de 48h).', publishedAt },
        });
        return;
      }
      if (publishedAt && !item.publishedAt) {
        await this.prisma.newsItem.update({ where: { id }, data: { publishedAt } });
      }

      // Corpo magro = não recuperamos a matéria (ex.: página de placar/app JS que só
      // devolve o menu). Apurar a partir do TÍTULO leva o gerador a inventar — então
      // filtramos ANTES de gastar extração/geração. Resgatável se o editor discordar.
      const effectiveBody = (body ?? item.sourceSummary ?? '').trim();
      if (effectiveBody.length < MIN_BODY_CHARS) {
        await this.prisma.newsItem.update({
          where: { id },
          data: {
            status: 'FILTERED',
            relevanceReason:
              'Corpo da matéria não recuperado (página sem conteúdo de notícia — ex.: placar/app). Sem texto não dá para apurar fatos.',
          },
        });
        return;
      }

      const extracted = await this.llm.extractAndClassify(
        item.sourceTitle,
        body ?? item.sourceSummary,
        item.feed?.focus ?? null,
        conf.extractModel,
      );

      // Gate 1: auto-filter. Irrelevant items park as FILTERED (rescuable).
      if (!extracted.isSportsNews || extracted.relevanceScore < conf.relevanceMin) {
        await this.prisma.newsItem.update({
          where: { id },
          data: {
            status: 'FILTERED',
            facts: extracted.facts as Prisma.InputJsonValue,
            relevanceScore: extracted.relevanceScore,
            relevanceReason: extracted.reason,
          },
        });
        // Filtrada: custou (extração), mas NÃO é matéria gerada → não conta no volume.
        await this.settings.addUsage(costUsd(extracted.usage), false);
        return;
      }

      // Dedup entre fontes: se este MESMO acontecimento já virou matéria há pouco,
      // suprime esta (DUPLICATE) e pula a geração — a extração já foi paga, mas
      // economizamos o Sonnet. Resgatável depois se o editor quiser gerar mesmo assim.
      if (extracted.eventKey) {
        const primary = await this.prisma.newsItem.findFirst({
          where: {
            eventKey: extracted.eventKey,
            id: { not: id },
            status: { in: ['PENDING_REVIEW', 'APPROVED'] },
            createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, sourceTitle: true, facts: true },
        });
        // Rede de segurança: a chave pode colidir por engano do modelo. Só trata como
        // duplicata se as duas notícias compartilharem ao menos uma entidade (time/
        // pessoa/competição) — senão segue e gera normalmente.
        const sharesEntity =
          primary &&
          (() => {
            const a = factEntities(extracted.facts);
            const b = factEntities(primary.facts);
            for (const e of a) if (b.has(e)) return true;
            return false;
          })();
        if (primary && sharesEntity) {
          await this.prisma.newsItem.update({
            where: { id },
            data: {
              status: 'DUPLICATE',
              eventKey: extracted.eventKey,
              duplicateOfId: primary.id,
              facts: extracted.facts as Prisma.InputJsonValue,
              relevanceScore: extracted.relevanceScore,
              relevanceReason: `Mesmo assunto de: "${primary.sourceTitle}"`,
            },
          });
          await this.settings.addUsage(costUsd(extracted.usage), false);
          this.logger.log(`Item ${id} é duplicata de ${primary.id} (${extracted.eventKey}).`);
          return;
        }
      }

      const tone = await this.resolveTone(item.toneId, item.feed?.defaultToneId ?? null);
      if (!tone) throw new Error('Nenhum tom ativo configurado para gerar o texto.');

      const gen = await this.llm.generateArticle(extracted.facts, tone.promptText, null, conf.generateModel);
      // Auditoria contra a FONTE (fidelidade + derivação): vai pra revisão de qualquer
      // jeito, mas com o alerta. A fonte é a verdade — pega até erro vindo da extração.
      const verify = await this.llm.verifyArticle(effectiveBody, gen.text, conf.extractModel);
      await this.prisma.$transaction([
        this.prisma.newsItem.update({
          where: { id },
          data: {
            status: 'PENDING_REVIEW',
            eventKey: extracted.eventKey || null,
            facts: extracted.facts as Prisma.InputJsonValue,
            relevanceScore: extracted.relevanceScore,
            relevanceReason: extracted.reason,
            toneId: tone.id,
            toneSnapshot: tone.promptText,
            toneVersion: tone.version,
            generatedText: gen.text,
            model: gen.model,
            verifyOk: verify.ok,
            verifyNotes: verify.notes,
          },
        }),
        this.prisma.newsRevision.create({
          data: {
            itemId: id,
            attempt: 1,
            guidance: null,
            generatedText: gen.text,
            toneSnapshot: tone.promptText,
            model: gen.model,
          },
        }),
      ]);
      // Matéria gerada: soma custo (extração + geração + verificação) e conta no volume.
      await this.settings.addUsage(
        costUsd(extracted.usage) + costUsd(gen.usage) + costUsd(verify.usage),
        true,
      );
      this.logger.log(`Item ${id} gerado (tom "${tone.name}").`);
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'erro';
      await this.prisma.newsItem.update({ where: { id }, data: { status: 'FAILED', error: message } });
      this.logger.warn(`Item ${id} falhou: ${message}`);
    }
  }

  /**
   * Geração de fonte generativa: os fatos já estão no item (montados pelo conector a
   * partir do banco). Sem extração nem fetch — só gera no tom e audita contra os
   * próprios fatos (pega invenção; não há "derivação" pois não existe prosa-fonte).
   */
  private async generateFromFacts(
    item: {
      id: string;
      facts: Prisma.JsonValue | null;
      toneId: string | null;
      feed: { defaultToneId: string | null } | null;
    },
    conf: ContentConfig,
  ): Promise<void> {
    const facts = item.facts as Record<string, unknown> | null;
    if (!facts || !Object.keys(facts).length) {
      throw new Error('Fonte generativa sem fatos no item.');
    }
    const tone = await this.resolveTone(item.toneId, item.feed?.defaultToneId ?? null);
    if (!tone) throw new Error('Nenhum tom ativo configurado para gerar o texto.');

    const gen = await this.llm.generateArticle(facts, tone.promptText, null, conf.generateModel);
    const verify = await this.llm.verifyAgainstFacts(
      JSON.stringify(facts, null, 2),
      gen.text,
      conf.extractModel,
    );
    await this.prisma.$transaction([
      this.prisma.newsItem.update({
        where: { id: item.id },
        data: {
          status: 'PENDING_REVIEW',
          toneId: tone.id,
          toneSnapshot: tone.promptText,
          toneVersion: tone.version,
          generatedText: gen.text,
          model: gen.model,
          verifyOk: verify.ok,
          verifyNotes: verify.notes,
        },
      }),
      this.prisma.newsRevision.create({
        data: {
          itemId: item.id,
          attempt: 1,
          guidance: null,
          generatedText: gen.text,
          toneSnapshot: tone.promptText,
          model: gen.model,
        },
      }),
    ]);
    await this.settings.addUsage(costUsd(gen.usage) + costUsd(verify.usage), true);
    this.logger.log(`Item ${item.id} gerado do banco (tom "${tone.name}").`);
  }

  /** Re-run ONLY generation with an optional editor steer; appends a revision. */
  async reprocess(
    id: string,
    guidance: string | null,
    toneId?: string | null,
    force = false,
  ): Promise<void> {
    const item = await this.prisma.newsItem.findUnique({
      where: { id },
      include: { feed: true },
    });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item não encontrado.' });
    if (!item.facts) {
      throw new BadRequestException({ code: 'NO_FACTS', message: 'Item ainda não tem fatos extraídos.' });
    }
    if (!force) {
      const cap = await this.settings.capStatus();
      if (cap.over) throw new BadRequestException({ code: 'CAP_EXCEEDED', message: cap.message });
    }

    await this.prisma.newsItem.update({ where: { id }, data: { status: 'PROCESSING', error: null } });
    try {
      const tone = await this.resolveTone(toneId ?? item.toneId, item.feed?.defaultToneId ?? null);
      if (!tone) throw new Error('Nenhum tom ativo configurado.');

      const cfg = await this.settings.getConfig();
      const gen = await this.llm.generateArticle(
        item.facts as Record<string, unknown>,
        tone.promptText,
        guidance,
        cfg.generateModel,
      );
      const verify = await this.llm.verifyArticle(item.sourceText ?? '', gen.text, cfg.extractModel);
      // Regeração de matéria já existente: soma custo (geração + verificação), sem contar nova matéria.
      await this.settings.addUsage(costUsd(gen.usage) + costUsd(verify.usage), false);
      const last = await this.prisma.newsRevision.aggregate({
        where: { itemId: id },
        _max: { attempt: true },
      });
      const attempt = (last._max.attempt ?? 0) + 1;

      await this.prisma.$transaction([
        this.prisma.newsItem.update({
          where: { id },
          data: {
            status: 'PENDING_REVIEW',
            toneId: tone.id,
            toneSnapshot: tone.promptText,
            toneVersion: tone.version,
            generatedText: gen.text,
            model: gen.model,
            verifyOk: verify.ok,
            verifyNotes: verify.notes,
          },
        }),
        this.prisma.newsRevision.create({
          data: {
            itemId: id,
            attempt,
            guidance: guidance?.trim() || null,
            generatedText: gen.text,
            toneSnapshot: tone.promptText,
            model: gen.model,
          },
        }),
      ]);
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'erro';
      await this.prisma.newsItem.update({ where: { id }, data: { status: 'FAILED', error: message } });
      throw err;
    }
  }

  /** Item override → feed default → oldest active tone. */
  private async resolveTone(
    preferredId: string | null | undefined,
    feedDefaultId: string | null,
  ): Promise<NewsTone | null> {
    const id = preferredId ?? feedDefaultId;
    if (id) {
      const tone = await this.prisma.newsTone.findFirst({ where: { id, isActive: true } });
      if (tone) return tone;
    }
    return this.prisma.newsTone.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
