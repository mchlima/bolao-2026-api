import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';

// ScheduleModule is registered in AppModule. Daily off-site DB backup to R2.
@Module({
  providers: [BackupService],
})
export class BackupModule {}
