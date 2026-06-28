import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NUDGE_TYPE = 'FIRST_PREDICTION_NUDGE';

/**
 * Nudge de ativação: o usuário se cadastrou mas nunca cravou um palpite. Uma vez,
 * entre 24h e 7 dias após o cadastro, manda um lembrete (in-app + Web Push) pra
 * fazer o primeiro palpite — o ponto exato onde a ativação vazava (cria conta e
 * não chega ao "aha").
 *
 * - Idempotente: o filtro `notifications: none of FIRST_PREDICTION_NUDGE` garante
 *   um único nudge por pessoa (reusa NotificationsService.deliver, que não dedup).
 * - Janela alta de 7d é o limite anti-"back-blast": ao subir a feature não cutuca
 *   contas antigas em massa, só as recentes que ainda não palpitaram.
 * - Só dispara em horário diurno de Brasília (9h–21h) pra não acordar ninguém.
 */
@Injectable()
export class OnboardingNudgeService {
  private readonly logger = new Logger(OnboardingNudgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    const hourSP = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    if (hourSP < 9 || hourSP >= 21) return;

    const now = Date.now();
    try {
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          createdAt: {
            gte: new Date(now - 7 * DAY_MS),
            lte: new Date(now - DAY_MS),
          },
          predictions: { none: {} },
          notifications: { none: { type: NUDGE_TYPE } },
        },
        select: { id: true },
      });
      if (!users.length) return;

      for (const u of users) {
        await this.notifications.deliver(u.id, {
          type: NUDGE_TYPE,
          title: 'Faça seu primeiro palpite 🏆',
          body: 'A Copa está rolando — crave os placares e dispute com a galera.',
          url: '/comecar',
        });
      }
      this.logger.log(
        `${NUDGE_TYPE}: ${users.length} usuário(s) sem palpite cutucado(s).`,
      );
    } catch (err) {
      this.logger.error(
        `Falha no nudge de onboarding: ${(err as Error).message}`,
      );
    }
  }
}
