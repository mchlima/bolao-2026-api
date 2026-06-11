import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Paginated } from '../common/pagination';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';

@Controller('admin/audit-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: QueryAuditDto): Promise<Paginated<unknown>> {
    return this.audit.findAll(query);
  }
}
