import { Module } from '@nestjs/common';
import { AdminMatchesController } from './admin-matches.controller';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { LineupService } from './lineup.service';
import { TimelineService } from './timeline.service';
import { StructureModule } from '../structure/structure.module';

// StructureModule provides SlotResolverService (re-resolve brackets on result change).
// LineupService/TimelineService serve persisted lineup + events from our DB.
@Module({
  imports: [StructureModule],
  controllers: [MatchesController, AdminMatchesController],
  providers: [MatchesService, LineupService, TimelineService],
  exports: [MatchesService],
})
export class MatchesModule {}
