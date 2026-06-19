import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../users/user.types';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: SafeUser): Promise<Notification[]> {
    return this.notifications.list(user.id);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: SafeUser): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: SafeUser, @Param('id') id: string): Promise<void> {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentUser() user: SafeUser): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }
}
