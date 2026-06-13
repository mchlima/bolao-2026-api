import { CompetitionType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryCompetitionsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CompetitionType)
  type?: CompetitionType;
}
