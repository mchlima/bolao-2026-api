import {
  Body,
  Controller,
  Get,
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
import type { SafeUser } from './user.types';
import { QueryUsersDto } from './dto/query-users.dto';
import { SetActiveDto } from './dto/set-active.dto';
import { SetRoleDto } from './dto/set-role.dto';
import { UsersService } from './users.service';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: QueryUsersDto): Promise<Paginated<SafeUser>> {
    return this.users.findAllPaginated(query);
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
}
