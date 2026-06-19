import { Injectable } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PushService } from './push.service';

export interface NotificationPayload {
  title: string;
  body: string;
  url?: string | null;
}

/**
 * In-app notifications (and, later, Web Push). Writes land in the notifications
 * table and ping the per-user SSE room `user:{id}` so an open client refetches.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly push: PushService,
  ) {}

  list(userId: string, limit = 30): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /**
   * Create one (type, matchId) notification for each user that doesn't already
   * have it — idempotent, so a re-running job never duplicates or re-alerts.
   * Pings each newly-notified user's SSE room. Returns the user ids that were
   * freshly notified (Phase 4 will also Web Push to these).
   */
  async createMissing(
    type: string,
    matchId: string,
    payload: NotificationPayload,
    userIds: string[],
  ): Promise<string[]> {
    if (!userIds.length) return [];
    const existing = await this.prisma.notification.findMany({
      where: { type, matchId, userId: { in: userIds } },
      select: { userId: true },
    });
    const have = new Set(existing.map((e) => e.userId));
    const fresh = userIds.filter((u) => !have.has(u));
    if (!fresh.length) return [];

    await this.prisma.notification.createMany({
      data: fresh.map((userId) => ({
        userId,
        type,
        matchId,
        title: payload.title,
        body: payload.body,
        url: payload.url ?? null,
      })),
      skipDuplicates: true,
    });
    for (const u of fresh) {
      this.events.emit(`user:${u}`); // live in-app badge
      void this.push.sendToUser(u, { title: payload.title, body: payload.body, url: payload.url }); // web push
    }
    return fresh;
  }
}
