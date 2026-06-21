import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NewsItem, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchFactPackService, PackBlocks } from './match-fact-pack.service';
import { ContentProcessService } from './content-process.service';

interface MatchReportConfig {
  seasonIds?: string[];
  blocks?: Partial<PackBlocks>;
  notableCap?: number;
}

/**
 * Geração sob demanda da matéria de um jogo (botão "Gerar matéria" da narração).
 * Monta o fact-pack do jogo (que já inclui os comentariosDoEditor) e gera na hora,
 * caindo em Revisão — reaproveita a fonte MATCH_REPORT (tom/blocks) e o pipeline.
 */
@Injectable()
export class MatchReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pack: MatchFactPackService,
    private readonly process: ContentProcessService,
  ) {}

  async generateForMatch(matchId: string, force = false): Promise<NewsItem> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, seasonId: true, status: true },
    });
    if (!match) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Partida não encontrada.' });
    if (match.status !== 'FINISHED') {
      throw new BadRequestException({
        code: 'NOT_FINISHED',
        message: 'A matéria só pode ser gerada após o apito (jogo encerrado).',
      });
    }

    // Fonte MATCH_REPORT: prefere uma que cubra a temporada (p/ tom/blocks); senão a 1ª ativa.
    const feeds = await this.prisma.newsFeed.findMany({ where: { type: 'MATCH_REPORT', isActive: true } });
    const covering = feeds.find((f) => {
      const ids = (f.config as MatchReportConfig | null)?.seasonIds;
      return Array.isArray(ids) && ids.includes(match.seasonId);
    });
    const feed = covering ?? feeds[0];
    if (!feed) {
      throw new BadRequestException({
        code: 'NO_FEED',
        message: 'Configure uma fonte de Resumo de Jogo (MATCH_REPORT) com um tom para gerar a matéria.',
      });
    }

    const cfg = (feed.config as MatchReportConfig | null) ?? {};
    const built = await this.pack.build(matchId, { blocks: cfg.blocks, notableCap: cfg.notableCap });
    if (!built) throw new BadRequestException({ code: 'NO_FACTS', message: 'Não foi possível montar os fatos do jogo.' });

    // Idempotente por (feed, jogo): reusa o item existente (atualiza os fatos) ou cria.
    const sourceGuid = `match:${matchId}`;
    const existing = await this.prisma.newsItem.findFirst({ where: { feedId: feed.id, sourceGuid } });
    const facts = built.facts as Prisma.InputJsonValue;
    const item = existing
      ? await this.prisma.newsItem.update({
          where: { id: existing.id },
          data: { facts, sourceTitle: built.title },
        })
      : await this.prisma.newsItem.create({
          data: {
            feedId: feed.id,
            matchId,
            sourceGuid,
            sourceUrl: sourceGuid,
            sourceTitle: built.title,
            facts,
            toneId: feed.defaultToneId,
            status: 'DISCOVERED',
          },
        });

    // Gera já: item generativo → reprocess gera dos fatos e cai em PENDING_REVIEW.
    await this.process.reprocess(item.id, null, null, force);
    return this.prisma.newsItem.findUniqueOrThrow({ where: { id: item.id } });
  }
}
