import { TeamType } from '@prisma/client';
import { IsBooleanString, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryTeamsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TeamType)
  type?: TeamType;

  @IsOptional()
  @IsString()
  continent?: string;

  @IsOptional()
  @IsString()
  country?: string;

  /** name (default) | country | recent (last updated) */
  @IsOptional()
  @IsIn(['name', 'country', 'recent'])
  sort?: 'name' | 'country' | 'recent';

  /** 'true' = only teams with a crest, 'false' = only without. */
  @IsOptional()
  @IsBooleanString()
  hasLogo?: string;
}
