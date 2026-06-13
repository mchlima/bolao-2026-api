import { Global, Module } from '@nestjs/common';
import { PhaseWeightService } from './phase-weight.service';
import { ScoringService } from './scoring.service';

// Global so every consumer (predictions, rankings, engagement) shares ONE instance.
@Global()
@Module({
  providers: [ScoringService, PhaseWeightService],
  exports: [ScoringService, PhaseWeightService],
})
export class ScoringModule {}
