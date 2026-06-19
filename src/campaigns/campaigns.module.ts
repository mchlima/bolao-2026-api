import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminCampaignsController } from './admin-campaigns.controller';
import { AudienceService } from './audience.service';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [NotificationsModule], // PushService for the dispatch fan-out
  controllers: [AdminCampaignsController],
  providers: [CampaignsService, CampaignDispatchService, AudienceService],
})
export class CampaignsModule {}
