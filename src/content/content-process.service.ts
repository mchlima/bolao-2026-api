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

// Small per-tick batch keeps load gentle and respects provider rate limits.
const BATCH = 4;
// Freshness guard: never rewrite news older than this (the user's hard rule).
const MAX_AGE_MS = 48 * 3_600_000;

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
    const used = await this.settings.getTodayUsage();
    if (cfg.dailyBudgetUsd > 0 && used.costUsd >= cfg.dailyBudgetUsd) return; // teto de gasto/dia
    if (cfg.maxPerDay > 0 && used.items >= cfg.maxPerDay) return; // teto de volume/dia
    const pending = await this.prisma.newsItem.findMany({
      where: { status: 'DISCOVERED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of pending) await this.processItem(id, cfg);
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

      // Freshness guard — never rewrite old news (the user's hard rule).
      const publishedAt = item.publishedAt ?? fetchedDate;
      if (publishedAt && Date.now() - publishedAt.getTime() > MAX_AGE_MS) {
        await this.prisma.newsItem.update({
          where: { id },
          data: { status: 'FILTERED', relevanceReason: 'Notícia antiga (mais de 48h).', publishedAt },
        });
        return;
      }
      if (publishedAt && !item.publishedAt) {
        await this.prisma.newsItem.update({ where: { id }, data: { publishedAt } });
      }

      const extracted = await this.llm.extractAndClassify(
        item.sourceTitle,
        body ?? item.sourceSummary,
        item.feed?.focus ?? null,
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
            createdAt: { gte: new Date(Date.now() - MAX_AGE_MS) },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, sourceTitle: true },
        });
        if (primary) {
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
      // Matéria gerada: soma custo (extração + geração) e conta no volume do dia.
      await this.settings.addUsage(costUsd(extracted.usage) + costUsd(gen.usage), true);
      this.logger.log(`Item ${id} gerado (tom "${tone.name}").`);
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'erro';
      await this.prisma.newsItem.update({ where: { id }, data: { status: 'FAILED', error: message } });
      this.logger.warn(`Item ${id} falhou: ${message}`);
    }
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

      const gen = await this.llm.generateArticle(
        item.facts as Record<string, unknown>,
        tone.promptText,
        guidance,
        (await this.settings.getConfig()).generateModel,
      );
      // Regeração de matéria já existente: soma custo, mas não conta como nova matéria.
      await this.settings.addUsage(costUsd(gen.usage), false);
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
