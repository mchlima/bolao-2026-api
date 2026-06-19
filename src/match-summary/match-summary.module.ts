import { Module } from '@nestjs/common';
import { MatchSummaryService } from './match-summary.service';
import { LiveIngestModule } from '../live-ingest/live-ingest.module';
import { StructureModule } from '../structure/structure.module';
import { NotificationsModule } from '../notifications/notifications.module';

// LiveIngestModule provides EspnService. ScheduleModule is registered in AppModule.
// StructureModule provides SlotResolverService (re-resolve brackets on FINISH).
// NotificationsModule provides NotificationsService (lineup-published alert).
@Module({
  imports: [LiveIngestModule, StructureModule, NotificationsModule],
  providers: [MatchSummaryService],
  exports: [MatchSummaryService],
})
export class MatchSummaryModule {}
