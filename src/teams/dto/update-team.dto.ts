import { TeamType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** All fields optional — partial update. */
export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  shortName?: string;

  @IsOptional()
  @IsEnum(TeamType)
  type?: TeamType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  continent?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(12)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  colorAlt?: string;
}
