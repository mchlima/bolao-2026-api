import { CompetitionType } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCompetitionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  // Stable internal key, e.g. "fifa.world", "bra.1", "conmebol.libertadores".
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  // Mirrors the ESPN league slug, which can contain underscores (e.g.
  // "bra.copa_do_brazil"), so allow them alongside dot and hyphen.
  @Matches(/^[a-z0-9._\-]+$/, {
    message: 'slug deve conter apenas minúsculas, números, ponto, underscore e hífen.',
  })
  slug!: string;

  @IsEnum(CompetitionType)
  type!: CompetitionType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  confederation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  // Artigo gramatical do nome p/ conteúdo SSR: 'o' | 'a' | 'os' | 'as' (ou null).
  @IsOptional()
  @IsIn(['o', 'a', 'os', 'as'])
  article?: string | null;

  // ESPN league slug used by the live robot, e.g. "fifa.world".
  @IsOptional()
  @IsString()
  @MaxLength(80)
  espnLeagueSlug?: string;

  // Sport this competition belongs to. Defaults to Futebol when omitted.
  @IsOptional()
  @IsString()
  sportId?: string;
}
