import { Module } from '@nestjs/common';
import { EspnService } from './espn.service';
import { LiveIngestService } from './live-ingest.service';
import { StructureModule } from '../structure/structure.module';

// PrismaModule is @Global; ScheduleModule is registered in AppModule.
// StructureModule provides SlotResolverService (auto-advance brackets on FINISH).
@Module({
  imports: [StructureModule],
  providers: [EspnService, LiveIngestService],
})
export class LiveIngestModule {}
