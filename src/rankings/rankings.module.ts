import { Module } from '@nestjs/common';
import { CompetitionsModule } from '../competitions/competitions.module';
import { AdminEngagementController } from './admin-engagement.controller';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';

@Module({
  imports: [CompetitionsModule],
  controllers: [RankingsController, AdminEngagementController],
  providers: [RankingsService],
  exports: [RankingsService],
})
export class RankingsModule {}
