import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const NEWS_ITEM_STATUSES = [
  'DISCOVERED',
  'FILTERED',
  'PROCESSING',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'FAILED',
] as const;

export class ListItemsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(NEWS_ITEM_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  feedId?: string;
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
