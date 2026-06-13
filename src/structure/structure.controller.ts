import { Controller, Get, Param } from '@nestjs/common';
import { StageStandings } from './standings.types';
import { StructureService } from './structure.service';

// Public read endpoints for a season's competition structure.
@Controller('seasons/:seasonId')
export class StructureController {
  constructor(private readonly structure: StructureService) {}

  @Get('structure')
  getStructure(@Param('seasonId') seasonId: string) {
    return this.structure.getStructure(seasonId);
  }

  @Get('standings')
  getStandings(@Param('seasonId') seasonId: string): Promise<StageStandings[]> {
    return this.structure.getStandings(seasonId);
  }

  @Get('bracket')
  getBracket(@Param('seasonId') seasonId: string) {
    return this.structure.getBracket(seasonId);
  }
}
