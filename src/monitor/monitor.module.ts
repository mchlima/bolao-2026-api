import { Global, Module } from '@nestjs/common';
import { MonitorService } from './monitor.service';

// Global so the ingestion robots can inject MonitorService to report heartbeats
// without re-importing the module (mirrors AlertsModule).
@Global()
@Module({
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
