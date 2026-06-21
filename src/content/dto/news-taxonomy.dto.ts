import { IsOptional, IsString, IsNotEmpty, MaxLength, ValidateIf } from 'class-validator';
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

  /** Categoria-pai na árvore (até 3 níveis). Só faz sentido p/ categorias. */
  @IsOptional()
  @IsString()
  parentId?: string;
}

/** Edita nome/descrição (o slug é estável — não muda a URL pública). parentId move na árvore. */
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

  /** Mover na árvore: id do novo pai, ou null para virar raiz. */
  @ValidateIf((o) => o.parentId !== undefined && o.parentId !== null)
  @IsString({ message: 'parentId deve ser texto ou null.' })
  parentId?: string | null;
}
