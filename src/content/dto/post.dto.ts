import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const POST_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

class PostFaqEntryDto {
  @IsString() @MaxLength(300) question!: string;
  @IsString() @MaxLength(1000) answer!: string;
}

/** Pacote SEO/GEO do artigo (sem slug/dek/categoria/tags — esses são colunas/relações do Post). */
export class PostSeoDto {
  @IsOptional() @IsString() @MaxLength(120) metaTitle?: string;
  @IsOptional() @IsString() @MaxLength(320) metaDescription?: string;
  @IsOptional() @IsString() @MaxLength(120) focusKeyword?: string;
  @IsOptional() @IsString() @MaxLength(300) imageAlt?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) keywords?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) keyTakeaways?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => PostFaqEntryDto)
  faq?: PostFaqEntryDto[];
}

/** Liga/desliga o destaque editorial (manchete). Escreve a coluna direto — fora do overlay draft. */
export class ToggleFeaturedDto {
  @IsBoolean() featured!: boolean;
}

export class ListPostsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(POST_STATUSES)
  status?: string;
  // `search` (busca por título) vem da PaginationQueryDto base.
}

/** Criação manual de post no CMS (nasce como rascunho). Só o título é obrigatório. */
export class CreatePostDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(300) slug?: string;
  @IsOptional() @IsString() @MaxLength(400) dek?: string;
  @IsOptional() @IsString() body?: string;

  @IsOptional()
  @ValidateIf((o) => o.categoryId !== null)
  @IsString()
  categoryId?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tagIds?: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PostSeoDto)
  seo?: PostSeoDto;
}

/**
 * Edição do post no CMS. Todos os campos são opcionais (só os enviados mudam). Para
 * um post PUBLISHED, salvar grava num overlay `draft` e NÃO afeta a cópia no ar —
 * só Publicar aplica. Para rascunho/arquivado, grava direto.
 */
export class UpdatePostDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(300) slug?: string;
  @IsOptional() @ValidateIf((o) => o.dek !== null) @IsString() @MaxLength(400) dek?: string | null;
  @IsOptional() @IsString() body?: string;

  @IsOptional()
  @ValidateIf((o) => o.categoryId !== null)
  @IsString()
  categoryId?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tagIds?: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PostSeoDto)
  seo?: PostSeoDto;
}
