import { MatchStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

/** All fields optional — partial update (scores/status included for live control). */
export class UpdateMatchDto {
  @IsOptional()
  @IsString()
  homeTeamId?: string;

  @IsOptional()
  @IsString()
  awayTeamId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  homeSourceLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  awaySourceLabel?: string;

  @IsOptional()
  @IsString()
  stadiumId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  kickoffAt?: Date;

  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  homeScore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  awayScore?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  phaseLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  groupName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  matchNumber?: number;

  // Manual prediction-window override: true/false force open/closed, null resets
  // to the automatic rule. @IsOptional() lets null through to clear the override.
  @IsOptional()
  @IsBoolean()
  predictionsOpen?: boolean | null;

  // false = admin took over score/status; the ESPN robot skips this match.
  @IsOptional()
  @IsBoolean()
  autoManaged?: boolean;
}
