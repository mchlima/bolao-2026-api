import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// IP/UA/city/region are personal data (LGPD). We keep the audit trail (action,
// actor, country) indefinitely but strip the identifying request details after
// this window so we don't retain PII longer than its purpose requires.
const RETENTION_DAYS = 180;

@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { timeZone: 'America/Sao_Paulo' })
  async anonymizeOldEntries(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.auditLog.updateMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [
          { ip: { not: null } },
          { userAgent: { not: null } },
          { city: { not: null } },
          { region: { not: null } },
        ],
      },
      data: { ip: null, userAgent: null, city: null, region: null },
    });
    if (count > 0) {
      this.logger.log(
        `Anonymized ${count} audit log(s) older than ${RETENTION_DAYS}d (kept action/actor/country).`,
      );
    }
  }
}
