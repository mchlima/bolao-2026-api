import { Module } from '@nestjs/common';
import { EspnService } from './espn.service';
import { LiveIngestService } from './live-ingest.service';

// PrismaModule is @Global; ScheduleModule is registered in AppModule.
@Module({
  providers: [EspnService, LiveIngestService],
})
export class LiveIngestModule {}
