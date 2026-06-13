import { MatchStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateMatchDto {
  @IsString()
  seasonId!: string;

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

  @Type(() => Date)
  @IsDate()
  kickoffAt!: Date;

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

  // Structure links (admin builds the bracket/groups).
  @IsOptional()
  @IsString()
  stageId?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  roundId?: string;

  @IsOptional()
  @IsString()
  tieId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  leg?: number;
}
