import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Lista admin de tags/categorias (paginada, com busca opcional por nome). */
export class ListTaxonomyQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string;
}

/** Cria uma tag ou categoria. slug é derivado do nome (estável); pode ser informado. */
export class CreateTaxonomyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

/** Edita nome/descrição (o slug é estável — não muda a URL pública). */
export class UpdateTaxonomyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}
