import { Module } from '@nestjs/common';
import { RankingsModule } from '../rankings/rankings.module';
import { PoolsController } from './pools.controller';
import { PoolsService } from './pools.service';

@Module({
  imports: [RankingsModule], // reuses RankingsService for member-scoped rankings
  controllers: [PoolsController],
  providers: [PoolsService],
  exports: [PoolsService],
})
export class PoolsModule {}
