import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PushService } from '../notifications/push.service';
import { AudienceService } from './audience.service';
import { AudienceSpec } from './audience.types';

const BATCH = 500;

/**
 * Fans a campaign out to its audience over the selected channels. A minute cron
 * sends due scheduled campaigns; kick() runs it right away for immediate sends.
 * Claiming is atomic (SCHEDULED → SENDING) so the cron and an immediate kick
 * never double-send. Adding e-mail later = one more channel branch here.
 */
@Injectable()
export class CampaignDispatchService {
  private readonly logger = new Logger(CampaignDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceService,
    private readonly push: PushService,
    private readonly events: EventsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    const due = await this.prisma.notificationCampaign.findMany({
      where: { status: 'SCHEDULED', sendAt: { lte: new Date() } },
      select: { id: true },
      take: 20,
    });
    for (const c of due) await this.process(c.id);
  }

  /** Fire-and-forget trigger for immediate dispatch. */
  kick(id: string): void {
    this.process(id).catch((err) =>
      this.logger.error(`Falha ao disparar campanha ${id}: ${(err as Error).message}`),
    );
  }

  async process(id: string): Promise<void> {
    // Claim atomically so only one runner proceeds.
    const claim = await this.prisma.notificationCampaign.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: { status: 'SENDING', startedAt: new Date() },
    });
    if (!claim.count) return;

    const camp = await this.prisma.notificationCampaign.findUnique({ where: { id } });
    if (!camp) return;

    try {
      const spec: AudienceSpec = {
        all: camp.audienceAll,
        filter: (camp.filter as AudienceSpec['filter']) ?? null,
      };
      const userIds = await this.audience.resolveUserIds(spec);
      await this.prisma.notificationCampaign.update({
        where: { id },
        data: { totalRecipients: userIds.length },
      });

      const channels = camp.channels;
      const payload = { title: camp.title, body: camp.body, url: camp.url };
      let delivered = 0;

      for (const batch of chunk(userIds, BATCH)) {
        if (channels.includes('inapp')) {
          await this.prisma.notification.createMany({
            data: batch.map((userId) => ({
              userId,
              type: 'ADMIN_BROADCAST',
              title: camp.title,
              body: camp.body,
              url: camp.url ?? null,
            })),
          });
          for (const uid of batch) this.events.emit(`user:${uid}`);
        }
        if (channels.includes('push')) {
          for (const uid of batch) void this.push.sendToUser(uid, payload);
        }
        delivered += batch.length;
        await this.prisma.notificationCampaign.update({
          where: { id },
          data: { deliveredCount: delivered },
        });
      }

      await this.prisma.notificationCampaign.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date(), deliveredCount: delivered },
      });
      this.logger.log(`Campanha ${id} enviada para ${delivered} usuário(s).`);
    } catch (err) {
      await this.prisma.notificationCampaign.update({ where: { id }, data: { status: 'FAILED' } });
      this.logger.error(`Campanha ${id} falhou: ${(err as Error).message}`);
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
