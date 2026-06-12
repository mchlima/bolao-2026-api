import { TeamType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10)
  shortName!: string;

  @IsEnum(TeamType)
  type!: TeamType;

  // NATIONAL_TEAM
  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  continent?: string;

  // CLUB
  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoDarkUrl?: string;

  // Brand colors (hex without #), e.g. "D80518".
  @IsOptional()
  @IsString()
  @MaxLength(12)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  colorAlt?: string;
}
