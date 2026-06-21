import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// TOPIC = pauta por busca na web (sem URL fixa; o assunto vai na config).
// MATCH_REPORT = fonte GENERATIVA: não busca na web, lê o nosso banco (partidas
// encerradas) e monta os fatos direto — pula a extração, vai direto pra geração.
export const FEED_TYPES = ['RSS', 'NEWS_API', 'PAGE', 'TOPIC', 'MATCH_REPORT'] as const;

// Fontes cujos fatos já vêm prontos do conector (lendo o banco): o processamento
// pula fetch/extração/dedup-por-IA e gera a partir de NewsItem.facts.
export const GENERATIVE_FEED_TYPES = ['MATCH_REPORT'] as const;
export function isGenerativeFeedType(type: string | null | undefined): boolean {
  return !!type && (GENERATIVE_FEED_TYPES as readonly string[]).includes(type);
}

export class CreateNewsFeedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  // URL do feed/página/API, ou um id sintético "pauta:<slug>" no caso de TOPIC.
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url!: string;

  @IsOptional()
  @IsIn(FEED_TYPES)
  type?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  focus?: string;

  @IsOptional()
  @IsString()
  defaultToneId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  fetchIntervalMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8760)
  maxAgeHours?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateNewsFeedDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsIn(FEED_TYPES)
  type?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  focus?: string | null;

  @IsOptional()
  @IsString()
  defaultToneId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  fetchIntervalMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8760)
  maxAgeHours?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PreviewFeedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url!: string;
}
