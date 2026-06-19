import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { ReminderService } from './reminder.service';

@Module({
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, PushService, ReminderService],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
