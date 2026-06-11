import { UserRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class SetRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}
