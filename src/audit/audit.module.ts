import { Global, Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller';
import { AuditService } from './audit.service';
import { AuditRetentionService } from './audit-retention.service';

// Global so any module (users, matches) can inject AuditService to log sensitive actions.
@Global()
@Module({
  controllers: [AdminAuditController],
  providers: [AuditService, AuditRetentionService],
  exports: [AuditService],
})
export class AuditModule {}
