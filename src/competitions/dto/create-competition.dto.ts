import { CompetitionType } from '@prisma/client';
import {
  IsEnum,
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
  @Matches(/^[a-z0-9.\-]+$/, {
    message: 'slug deve conter apenas minúsculas, números, ponto e hífen.',
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

  // ESPN league slug used by the live robot, e.g. "fifa.world".
  @IsOptional()
  @IsString()
  @MaxLength(80)
  espnLeagueSlug?: string;
}
