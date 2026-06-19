import { Module } from '@nestjs/common';
import { FollowsController } from './follows.controller';
import { MatchFollowsController } from './match-follows.controller';
import { FollowsService } from './follows.service';

@Module({
  controllers: [FollowsController, MatchFollowsController],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
