import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const NEWS_ITEM_STATUSES = [
  'DISCOVERED',
  'FILTERED',
  'PROCESSING',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'FAILED',
  'DUPLICATE',
] as const;

export class ListItemsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(NEWS_ITEM_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  feedId?: string;
}

class FaqEntryDto {
  @IsString()
  @MaxLength(300)
  question!: string;

  @IsString()
  @MaxLength(1000)
  answer!: string;
}

/**
 * Editor polish of the generated SEO/GEO package before publishing. Every field is
 * optional — only the ones sent are overwritten (merged onto the generated seo).
 */
export class UpdateItemSeoDto {
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsOptional() @IsString() @MaxLength(120) metaTitle?: string;
  @IsOptional() @IsString() @MaxLength(320) metaDescription?: string;
  @IsOptional() @IsString() @MaxLength(400) dek?: string;
  @IsOptional() @IsString() @MaxLength(120) focusKeyword?: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MaxLength(300) imageAlt?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) keywords?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(16) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) keyTakeaways?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => FaqEntryDto)
  faq?: FaqEntryDto[];
}

export class ReprocessItemDto {
  /** Editor steer fed into the next generation (e.g. "menos ironia, cita o placar"). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  guidance?: string;

  /** Optionally switch the tom for this regeneration. */
  @IsOptional()
  @IsString()
  toneId?: string;

  /** Bypass the daily cost/volume cap (user confirmed in the UI). */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
