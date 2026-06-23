import { Module } from '@nestjs/common';
import { MatchSummaryService } from './match-summary.service';
import { OddsService } from './odds.service';
import { LiveIngestModule } from '../live-ingest/live-ingest.module';
import { StructureModule } from '../structure/structure.module';
import { NotificationsModule } from '../notifications/notifications.module';

// LiveIngestModule provides EspnService. ScheduleModule is registered in AppModule.
// StructureModule provides SlotResolverService (re-resolve brackets on FINISH).
// NotificationsModule provides NotificationsService (lineup-published alert).
// OddsService is a separate low-frequency robot for pre-match betting probabilities.
@Module({
  imports: [LiveIngestModule, StructureModule, NotificationsModule],
  providers: [MatchSummaryService, OddsService],
  exports: [MatchSummaryService, OddsService],
})
export class MatchSummaryModule {}
