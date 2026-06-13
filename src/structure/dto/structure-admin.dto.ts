import { StageFormat, TiebreakPreset } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

// ── Stage ──
export class CreateStageDto {
  @IsString() @MinLength(1) seasonId!: string;
  @IsString() @MinLength(1) name!: string;
  @IsEnum(StageFormat) format!: StageFormat;
  @IsInt() @Min(0) order!: number;
  @IsOptional() @IsEnum(TiebreakPreset) tiebreakPreset?: TiebreakPreset;
  @IsOptional() @IsBoolean() hasThirdPlace?: boolean;
}

export class UpdateStageDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsEnum(StageFormat) format?: StageFormat;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsEnum(TiebreakPreset) tiebreakPreset?: TiebreakPreset;
  @IsOptional() @IsBoolean() hasThirdPlace?: boolean;
}

// ── Group ──
export class CreateGroupDto {
  @IsString() @MinLength(1) stageId!: string;
  @IsString() @MinLength(1) name!: string;
  @IsInt() @Min(0) order!: number;
}

export class UpdateGroupDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
}

// Replace a group's team roster wholesale (idempotent set).
export class SetGroupTeamsDto {
  @IsArray() @IsString({ each: true }) teamIds!: string[];
}

// ── Round ──
export class CreateRoundDto {
  @IsString() @MinLength(1) stageId!: string;
  @IsOptional() @IsInt() @Min(0) number?: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() @Min(1) legs?: number;
  @IsInt() @Min(0) order!: number;
}

export class UpdateRoundDto {
  @IsOptional() @IsInt() @Min(0) number?: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() @Min(1) legs?: number;
  @IsOptional() @IsInt() @Min(0) order?: number;
}

// ── Tie (bracket node) ──
export class CreateTieDto {
  @IsString() @MinLength(1) roundId!: string;
  @IsInt() @Min(0) order!: number;
  @IsOptional() @IsString() homeTeamId?: string;
  @IsOptional() @IsString() awayTeamId?: string;
  @IsOptional() @IsObject() homeSource?: Record<string, unknown>;
  @IsOptional() @IsObject() awaySource?: Record<string, unknown>;
  @IsOptional() @IsString() homeSourceLabel?: string;
  @IsOptional() @IsString() awaySourceLabel?: string;
}

export class UpdateTieDto {
  @IsOptional() @IsInt() @Min(0) order?: number;
  // null clears a resolved team back to TBD; admin override of the resolver.
  @IsOptional() @IsString() homeTeamId?: string | null;
  @IsOptional() @IsString() awayTeamId?: string | null;
  @IsOptional() @IsObject() homeSource?: Record<string, unknown> | null;
  @IsOptional() @IsObject() awaySource?: Record<string, unknown> | null;
  @IsOptional() @IsString() homeSourceLabel?: string;
  @IsOptional() @IsString() awaySourceLabel?: string;
}
