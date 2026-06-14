import { CompetitionType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryCompetitionsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CompetitionType)
  type?: CompetitionType;

  // Filter to one sport (e.g. the public hub listing football tournaments).
  @IsOptional()
  @IsString()
  sportId?: string;
}
