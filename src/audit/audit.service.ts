import { Injectable } from '@nestjs/common';
import { AuditActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Paginated, paginated } from '../common/pagination';
import { getRequestContext } from '../common/request-context';

export interface RecordAuditParams {
  actorUserId: string | null;
  actorType?: AuditActorType;
  action: string; // UPPER_SNAKE, e.g. USER_SET_ROLE, MATCH_UPDATE
  entityType: string;
  entityId?: string;
  diff?: unknown; // { field: { before, after } }
}

export interface QueryAuditParams extends PaginationQueryDto {
  entityType?: string;
  action?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Append an immutable audit entry (no update/delete is ever exposed). The
   * request's IP/UA/geo is pulled from AsyncLocalStorage, so call sites don't
   * pass it; outside a request (cron/system) these are simply null. */
  async record(params: RecordAuditParams): Promise<void> {
    const ctx = getRequestContext();
    await this.prisma.auditLog.create({
      data: {
        actorType:
          params.actorType ??
          (params.actorUserId ? AuditActorType.USER : AuditActorType.SYSTEM),
        actorUserId: params.actorUserId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        diff:
          params.diff === undefined
            ? undefined
            : (params.diff as Prisma.InputJsonValue),
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        country: ctx?.country ?? null,
        region: ctx?.region ?? null,
        city: ctx?.city ?? null,
      },
    });
  }

  async findAll(query: QueryAuditParams): Promise<Paginated<unknown>> {
    const { page, pageSize, entityType, action } = query;
    const where: Prisma.AuditLogWhereInput = {
      ...(entityType && { entityType }),
      ...(action && { action }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginated(data, total, page, pageSize);
  }
}
