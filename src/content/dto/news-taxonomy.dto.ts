import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsArray,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Lista admin de tags/categorias (paginada, com busca opcional por nome). */
export class ListTaxonomyQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string;
}

/** Uma pergunta/resposta da FAQ da página do termo (GEO + FAQPage). */
export class TermFaqDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  question!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(600)
  answer!: string;
}

/**
 * Metadados SEO/GEO da página de uma categoria/tag. Diferente do conteúdo, NÃO são
 * preenchidos por modelo — é trabalho manual do admin para rankear o hub e ser citado
 * por buscadores de IA. Todos opcionais; vazios caem nos defaults (nome/descrição).
 */
export class TermSeoDto {
  @IsOptional()
  @IsString()
  @MaxLength(90)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  metaDescription?: string;

  /** Override do H1 visível (default: o nome do termo). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  heading?: string;

  /** Parágrafo de introdução (resposta direta — GEO) exibido no topo do hub. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  intro?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermFaqDto)
  faq?: TermFaqDto[];
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

  @IsOptional()
  @ValidateNested()
  @Type(() => TermSeoDto)
  seo?: TermSeoDto;
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

  /** Pacote SEO/GEO do termo (manual). Enviar {} ou null limpa. */
  @ValidateIf((o) => o.seo !== undefined && o.seo !== null)
  @ValidateNested()
  @Type(() => TermSeoDto)
  seo?: TermSeoDto | null;
}
