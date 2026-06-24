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

export class UpdateCompetitionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(/^[a-z0-9.\-]+$/, {
    message: 'slug deve conter apenas minúsculas, números, ponto e hífen.',
  })
  slug?: string;

  @IsOptional()
  @IsEnum(CompetitionType)
  type?: CompetitionType;

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

  // Artigo gramatical do nome p/ conteúdo SSR: 'o' | 'a' | 'os' | 'as' (null limpa).
  @IsOptional()
  @IsIn(['o', 'a', 'os', 'as'])
  article?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  espnLeagueSlug?: string;

  @IsOptional()
  @IsString()
  sportId?: string;
}
