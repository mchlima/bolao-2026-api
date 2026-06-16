import { Module } from '@nestjs/common';
import { AdminMatchesController } from './admin-matches.controller';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { LineupService } from './lineup.service';
import { StructureModule } from '../structure/structure.module';

// StructureModule provides SlotResolverService (re-resolve brackets on result change).
// LineupService serves the persisted lineup from our DB (no ESPN at request time).
@Module({
  imports: [StructureModule],
  controllers: [MatchesController, AdminMatchesController],
  providers: [MatchesService, LineupService],
  exports: [MatchesService],
})
export class MatchesModule {}
