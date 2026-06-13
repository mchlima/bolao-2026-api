import { PoolVisibility } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePoolDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  // Internal — shown to members inside the pool.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // Shown on the invite-accept page (reachable by anyone with the link).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  inviteDescription?: string;

  @IsString()
  seasonId!: string;

  // MVP only uses PRIVATE; accepted for forward-compatibility.
  @IsOptional()
  @IsEnum(PoolVisibility)
  visibility?: PoolVisibility;
}
