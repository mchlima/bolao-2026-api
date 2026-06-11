import { Module } from '@nestjs/common';
import { AdminEngagementController } from './admin-engagement.controller';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';

@Module({
  controllers: [RankingsController, AdminEngagementController],
  providers: [RankingsService],
  exports: [RankingsService],
})
export class RankingsModule {}
