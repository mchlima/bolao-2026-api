import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScheduledNotification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Admin-authored notifications delivered on a schedule. A minute cron picks up
 * rows whose sendAt has passed and that aren't delivered yet, sends them
 * (in-app + web push) and stamps sentAt. "Enviar agora" is just a row with
 * sendAt = now, so it goes out on the next tick (≤1 min) through this same path.
 */
@Injectable()
export class ScheduledNotificationService {
  private readonly logger = new Logger(ScheduledNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Create a scheduled (or immediate) custom notification for a user. */
  async schedule(
    userId: string,
    data: { title: string; body: string; url?: string | null; sendAt: Date },
    createdById?: string,
  ): Promise<ScheduledNotification> {
    return this.prisma.scheduledNotification.create({
      data: {
        userId,
        title: data.title,
        body: data.body,
        url: data.url ?? null,
        sendAt: data.sendAt,
        createdById: createdById ?? null,
      },
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    const due = await this.prisma.scheduledNotification.findMany({
      where: { sentAt: null, sendAt: { lte: new Date() } },
      orderBy: { sendAt: 'asc' },
      take: 200,
    });
    if (!due.length) return;

    for (const n of due) {
      try {
        await this.notifications.deliver(n.userId, {
          title: n.title,
          body: n.body,
          url: n.url,
        });
        await this.prisma.scheduledNotification.update({
          where: { id: n.id },
          data: { sentAt: new Date() },
        });
      } catch (err) {
        this.logger.error(`Falha ao entregar notificação ${n.id}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`${due.length} notificação(ões) agendada(s) entregue(s).`);
  }
}
