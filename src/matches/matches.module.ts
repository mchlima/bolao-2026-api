import { Module } from '@nestjs/common';
import { AdminMatchesController } from './admin-matches.controller';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { LineupService } from './lineup.service';
import { StructureModule } from '../structure/structure.module';
import { LiveIngestModule } from '../live-ingest/live-ingest.module';

// StructureModule provides SlotResolverService (re-resolve brackets on result change).
// LiveIngestModule provides EspnService (lineups from the ESPN summary feed).
@Module({
  imports: [StructureModule, LiveIngestModule],
  controllers: [MatchesController, AdminMatchesController],
  providers: [MatchesService, LineupService],
  exports: [MatchesService],
})
export class MatchesModule {}
