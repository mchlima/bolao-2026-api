import { SeasonFormat, SeasonStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BroadcasterDto } from './broadcaster.dto';

export class UpdateSeasonDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  competitionId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  seasonLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  location?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @IsOptional()
  @IsEnum(SeasonStatus)
  status?: SeasonStatus;

  @IsOptional()
  @IsEnum(SeasonFormat)
  format?: SeasonFormat;

  // Curated "onde assistir" rights holders (display-only). Send [] to clear.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BroadcasterDto)
  broadcasters?: BroadcasterDto[];
}
