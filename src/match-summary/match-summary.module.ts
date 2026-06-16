import { Module } from '@nestjs/common';
import { MatchSummaryService } from './match-summary.service';
import { LiveIngestModule } from '../live-ingest/live-ingest.module';

// LiveIngestModule provides EspnService. ScheduleModule is registered in AppModule.
@Module({
  imports: [LiveIngestModule],
  providers: [MatchSummaryService],
  exports: [MatchSummaryService],
})
export class MatchSummaryModule {}
