import { Module } from '@nestjs/common';
import { AdminMatchesController } from './admin-matches.controller';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { StructureModule } from '../structure/structure.module';

// StructureModule provides SlotResolverService (re-resolve brackets on result change).
@Module({
  imports: [StructureModule],
  controllers: [MatchesController, AdminMatchesController],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
