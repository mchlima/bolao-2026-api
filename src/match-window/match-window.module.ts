import { Module } from '@nestjs/common';
import { MatchWindowService } from './match-window.service';

// PrismaModule and EventsModule are @Global; ScheduleModule is in AppModule.
@Module({
  providers: [MatchWindowService],
})
export class MatchWindowModule {}
