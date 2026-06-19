import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Paginated } from '../common/pagination';
import { ScheduledNotificationService } from '../notifications/scheduled-notification.service';
import type { SafeUser } from './user.types';
import { QueryUsersDto } from './dto/query-users.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SetActiveDto } from './dto/set-active.dto';
import { SetRoleDto } from './dto/set-role.dto';
import { AdminUserListItem, UsersService } from './users.service';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly scheduled: ScheduledNotificationService,
  ) {}

  @Get()
  list(@Query() query: QueryUsersDto): Promise<Paginated<AdminUserListItem>> {
    return this.users.findAllPaginated(query);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<SafeUser> {
    return this.users.findOneSafe(id);
  }

  @Patch(':id/role')
  setRole(
    @Param('id') id: string,
    @Body() dto: SetRoleDto,
    @CurrentUser() admin: SafeUser,
  ): Promise<SafeUser> {
    return this.users.setRole(id, dto.role, admin.id);
  }

  @Patch(':id/active')
  setActive(
    @Param('id') id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() admin: SafeUser,
  ): Promise<SafeUser> {
    return this.users.setActive(id, dto.isActive, admin.id);
  }

  @Post(':id/reset-password')
  resetPassword(
    @Param('id') id: string,
    @CurrentUser() admin: SafeUser,
  ): Promise<{ user: SafeUser; temporaryPassword: string }> {
    return this.users.resetPassword(id, admin.id);
  }

  /**
   * Send a custom notification to a user — now or scheduled. sendAt absent or in
   * the past = "agora" (delivered on the next minute tick of the robot).
   */
  @Post(':id/notifications')
  @HttpCode(201)
  async sendNotification(
    @Param('id') id: string,
    @Body() dto: SendNotificationDto,
    @CurrentUser() admin: SafeUser,
  ): Promise<{ sendAt: string; immediate: boolean }> {
    await this.users.findOneSafe(id); // 404 se o usuário não existir
    const now = Date.now();
    const requested = dto.sendAt ? new Date(dto.sendAt).getTime() : now;
    const immediate = requested <= now;
    const sendAt = new Date(immediate ? now : requested);
    const row = await this.scheduled.schedule(
      id,
      {
        title: dto.title.trim(),
        body: dto.body.trim(),
        url: dto.url?.trim() || null,
        sendAt,
      },
      admin.id,
    );
    return { sendAt: row.sendAt.toISOString(), immediate };
  }
}
