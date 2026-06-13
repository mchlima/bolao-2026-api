import { Module } from '@nestjs/common';
import { StructureController } from './structure.controller';
import { StructureService } from './structure.service';
import { StandingsService } from './standings.service';
import { SlotResolverService } from './slot-resolver.service';
import { AdminStructureController } from './admin-structure.controller';
import { AdminStructureService } from './admin-structure.service';

@Module({
  controllers: [StructureController, AdminStructureController],
  providers: [
    StructureService,
    StandingsService,
    SlotResolverService,
    AdminStructureService,
  ],
  // Exported so the live robot / admin can trigger slot resolution and standings.
  exports: [StandingsService, SlotResolverService, StructureService],
})
export class StructureModule {}
