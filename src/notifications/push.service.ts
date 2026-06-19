import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { SaveSubscriptionDto } from './dto/save-subscription.dto';

export interface PushPayload {
  title: string;
  body: string;
  url?: string | null;
}

/**
 * Web Push delivery (VAPID). Subscriptions are per device/browser; we encrypt to
 * each and prune any the push service reports gone (404/410). No-op when the
 * VAPID keys aren't configured, so the app runs fine without push set up.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;

  constructor(private readonly prisma: PrismaService) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:contato@cravei.app';
    this.enabled = !!(pub && priv);
    if (this.enabled) {
      webpush.setVapidDetails(subject, pub!, priv!);
    } else {
      this.logger.warn('VAPID keys ausentes — Web Push desabilitado.');
    }
  }

  async saveSubscription(userId: string, dto: SaveSubscriptionDto, userAgent?: string): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: userAgent ?? null,
      },
      // re-subscribing (same endpoint) may belong to the same user with rotated
      // keys — keep it pointed at the current user.
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: userAgent ?? null },
    });
  }

  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /** Best-effort push to all of a user's devices. Never throws. */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return;
    const data = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            data,
          );
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`push falhou (${code ?? '?'}): ${(err as Error).message}`);
          }
        }
      }),
    );
  }
}
