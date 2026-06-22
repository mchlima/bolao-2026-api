import { SeasonStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QuerySeasonsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(SeasonStatus)
  status?: SeasonStatus;

  /** Resolve um torneio pelo slug (rota pública /futebol/torneios/:slug). */
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  competitionId?: string;
}
