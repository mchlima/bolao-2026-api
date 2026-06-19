import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { ReminderService } from './reminder.service';
import { ScheduledNotificationService } from './scheduled-notification.service';

@Module({
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, PushService, ReminderService, ScheduledNotificationService],
  exports: [NotificationsService, PushService, ScheduledNotificationService],
})
export class NotificationsModule {}
