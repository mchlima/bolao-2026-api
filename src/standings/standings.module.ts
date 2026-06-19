import { Module } from '@nestjs/common';
import { RankingsModule } from '../rankings/rankings.module';
import { StandingsController } from './standings.controller';
import { StandingsService } from './standings.service';

@Module({
  imports: [RankingsModule],
  controllers: [StandingsController],
  providers: [StandingsService],
})
export class StandingsModule {}
