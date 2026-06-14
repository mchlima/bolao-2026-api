import { Module } from '@nestjs/common';
import { SeasonRefreshService } from './season-refresh.service';

// PrismaModule is @Global; EventsService is globally available; ScheduleModule is
// registered in AppModule. Daily job that refreshes fixture dates from ge.globo.
@Module({
  providers: [SeasonRefreshService],
})
export class SeasonRefreshModule {}
