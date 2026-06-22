import { TeamType } from '@prisma/client';
import { IsBooleanString, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryTeamsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TeamType)
  type?: TeamType;

  /** Resolve um time pelo slug (página pública /futebol/selecoes/:slug). */
  @IsOptional()
  @IsString()
  slug?: string;

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

  /**
   * Search scope. 'all' (default) also matches the country (admin filtering);
   * 'name' restricts to team name/short name/code so picking a team by name
   * isn't drowned by every club from that country (e.g. the "Brasil" national
   * team vs. 60 Brazilian clubs).
   */
  @IsOptional()
  @IsIn(['all', 'name'])
  match?: 'all' | 'name';
}
