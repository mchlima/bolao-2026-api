import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const FEED_TYPES = ['RSS', 'NEWS_API', 'PAGE'] as const;

export class CreateNewsFeedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsUrl()
  @MaxLength(500)
  url!: string;

  @IsOptional()
  @IsIn(FEED_TYPES)
  type?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  focus?: string;

  @IsOptional()
  @IsString()
  defaultToneId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  fetchIntervalMin?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateNewsFeedDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsIn(FEED_TYPES)
  type?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  focus?: string | null;

  @IsOptional()
  @IsString()
  defaultToneId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  fetchIntervalMin?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PreviewFeedDto {
  @IsUrl()
  @MaxLength(500)
  url!: string;
}
