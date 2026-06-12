import { PoolMemberRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateMemberRoleDto {
  // Only ADMIN or MEMBER may be set here; OWNER changes go through transfer.
  @IsEnum(PoolMemberRole)
  role!: PoolMemberRole;
}
