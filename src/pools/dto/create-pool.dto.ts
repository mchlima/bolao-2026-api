import { PoolVisibility } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePoolDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsString()
  tournamentId!: string;

  // MVP only uses PRIVATE; accepted for forward-compatibility.
  @IsOptional()
  @IsEnum(PoolVisibility)
  visibility?: PoolVisibility;
}
